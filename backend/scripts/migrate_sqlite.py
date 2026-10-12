"""Explicit, read-only source import. Production target must be empty of user data."""
import argparse,base64,json,sqlite3,tempfile
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from botocore.exceptions import ClientError
from psycopg.types.json import Jsonb
from cloudheron.config import Settings
from cloudheron.db import Database,DB,TABLES
from cloudheron.security import Vault
from cloudheron.storage import Storage,sniff

ORDER=['meta','users','sessions','projects','workflows','chats','assets','models','skills','experts','proposals','publications','jobs','workflow_versions','workflow_templates','project_test_cases','request_keys']
JSON_FIELDS={'meta':{'value'},'projects':{'acl'},'workflows':{'document'},'chats':{'messages'},'assets':{'acl','metadata'},'models':{'spec'},'experts':{'skill_ids'},'proposals':{'document'},'publications':{'document'},'jobs':{'snapshot','steps','outputs'},'workflow_versions':{'document'},'workflow_templates':{'document'},'project_test_cases':{'definition'}}
BOOL_FIELDS={'users':['active'],'models':['enabled'],'skills':['builtin'],'experts':['builtin'],'publications':['enabled']}
def migrate(source_dir,settings):
    source_dir=Path(source_dir).resolve();source=sqlite3.connect('file:'+str(source_dir/'cloudheron.sqlite')+'?mode=ro',uri=True);source.row_factory=sqlite3.Row
    # Freeze a consistent source snapshot without modifying the live SQLite database.
    snapshot=sqlite3.connect(':memory:');source.backup(snapshot);source.close();snapshot.row_factory=sqlite3.Row
    present={x[0] for x in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")};records={t:[dict(row) for row in snapshot.execute('SELECT * FROM '+t)] for t in ORDER if t in present}
    if any(j['status'] in ('queued','running') for j in records.get('jobs',[])): raise ValueError('请完成现有任务再迁移，不自动复制活跃任务')
    legacy=Vault(base64.b64encode((source_dir/'vault.key').read_bytes()).decode());vault=Vault(settings.vault_key_b64);storage=Storage(settings);storage.check();db=Database(settings.database_url);db.migrate();uploaded=[]
    try:
        with db.connection() as conn:
            d=DB(conn)
            with d.tx():
                d.run('SELECT pg_advisory_xact_lock(91401703)')
                if any(d.one('SELECT count(*) n FROM '+t)['n'] for t in ('users','projects','assets','jobs')): raise ValueError('目标已有业务数据，请使用空 PostgreSQL 数据库')
                for t in ORDER:
                    for raw in records.get(t,[]):
                        row=raw.copy()
                        for field in JSON_FIELDS.get(t,set()):
                            try: row[field]=json.loads(row[field])
                            except (ValueError,TypeError):
                                if t!='meta': raise
                                row[field]=raw[field]
                        for field in BOOL_FIELDS.get(t,[]): row[field]=bool(row[field])
                        if t=='models': row['secret']=vault.encrypt(legacy.decrypt(row['secret']))
                        if t=='assets':
                            oldpath=(source_dir/'media'/row['file']).resolve()
                            if not oldpath.is_relative_to(source_dir/'media'): raise ValueError('源媒体路径有误')
                            data=oldpath.read_bytes();sniff(data,row['mime']);row['file']='assets/'+row['id']+'.'+row['mime'].split('/')[1]
                            try:
                                storage.client.head_object(Bucket=storage.bucket,Key=row['file'])
                                if storage.read(row['file'])!=data: raise ValueError('目标对象已存在且内容不同，请使用独立桶或清理冲突')
                            except ClientError as e:
                                if str(e.response['Error']['Code']) not in ('404','NoSuchKey','NotFound'): raise
                                storage.put(row['file'],data,row['mime']);uploaded.append(row['file'])
                            if storage.read(row['file'])!=data: raise ValueError('对象字节验证失败')
                        if t in ('skills','experts'): d.run('DELETE FROM '+t+' WHERE id=%s',row['id'])
                        for field in JSON_FIELDS.get(t,set()): row[field]=Jsonb(row[field])
                        d.insert(t,row)
                d.run("INSERT INTO workflow_versions(workflow_id,revision,document,action,saved_at) SELECT id,revision,document,'baseline',updated_at FROM workflows ON CONFLICT DO NOTHING")
                counts={t:d.one('SELECT count(*) n FROM '+t)['n'] for t in ORDER}
                for t,rows in records.items():
                    if counts[t]!=len(rows): raise ValueError('记录数量不匹配：'+t)
        return {'source':'SQLite read-only snapshot','target':'PostgreSQL + S3','counts':counts,'objects_uploaded':len(uploaded),'object_bytes_verified':True,'credentials_reencrypted':True,'password_hashes_preserved':True}
    except Exception:
        for key in uploaded: storage.delete(key)
        raise
    finally: snapshot.close();db.close()
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--report',type=Path,required=True);args=parser.parse_args();result=migrate(args.source,Settings());args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('迁移完成，记录和对象字节验证通过。')
