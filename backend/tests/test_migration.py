import base64,importlib.util,json,os,sqlite3,subprocess
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from cloudheron.config import Settings,ROOT
from cloudheron.main import create_app
from cloudheron.security import verify
from cloudheron.db import Database,DB

def test_sqlite_password_secret_and_object_migration(tmp_path):
    settings=Settings();u=urlsplit(settings.database_url);name='cloudheron_migrate_'+os.urandom(4).hex()+'_test'
    postgres_url=urlunsplit((u.scheme,u.netloc,'/postgres',u.query,''));target_url=urlunsplit((u.scheme,u.netloc,'/'+name,u.query,''))
    with psycopg.connect(postgres_url,autocommit=True) as conn: conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    settings=settings.model_copy(update={'database_url':target_url,'s3_bucket':'cloudheron-migrate-qa-'+os.urandom(5).hex(),'s3_create_bucket':True})
    source=tmp_path/'legacy';source.mkdir()
    code='''import {database} from './app/lib/database.mjs';import {password,vault} from './app/lib/security.mjs';import {writeFileSync} from 'node:fs';import {join} from 'node:path';
const d=database(process.env.QA_SQLITE_SOURCE),stamp=new Date().toISOString();d.run('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)','legacy-user','Legacy','legacy@fixture.test',password('fixture-password-123'),'admin',stamp);d.run('INSERT INTO meta VALUES(?,?)','team','Migration fixture');d.run('INSERT INTO projects(id,name,owner_id,visibility,created_at) VALUES(?,?,?,?,?)','legacy-project','Legacy project','legacy-user','team',stamp);d.run('INSERT INTO models(id,name,spec,secret,updated_at) VALUES(?,?,?,?,?)','legacy-model','Legacy model',JSON.stringify({protocol:'OpenAI',base_url:'http://127.0.0.1:9/v1',model:'fixture',capabilities:['image']}),vault(d.key).encrypt('fixture-legacy-secret'),stamp);const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKwAAAABJRU5ErkJggg==','base64');writeFileSync(join(d.dir,'media','legacy.png'),bytes);d.run('INSERT INTO assets(id,project_id,owner_id,name,kind,visibility,mime,file,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)','legacy-asset','legacy-project','legacy-user','Legacy asset','image','team','image/png','legacy.png','{}',stamp);d.db.close();'''
    subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,env={**os.environ,'QA_SQLITE_SOURCE':str(source)},check=True,capture_output=True)
    module_spec=importlib.util.spec_from_file_location('migration_script',ROOT/'backend/scripts/migrate_sqlite.py');module=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(module)
    try:
        report=module.migrate(source,settings);assert report['counts']['users']==1;assert report['objects_uploaded']==1;assert report['object_bytes_verified']
        with TestClient(create_app(settings)) as c:
            c.headers['X-CloudHeron']='1';login=c.post('/api/login',json={'email':'legacy@fixture.test','password':'fixture-password-123'});assert login.status_code==200,login.text
            a=c.get('/api/assets').json()[0];assert c.get(a['url']).content==(source/'media/legacy.png').read_bytes()
            with c.app.state.ctx.database.connection() as conn:
                row=conn.execute('SELECT secret FROM models WHERE id=%s',('legacy-model',)).fetchone();assert c.app.state.ctx.vault.decrypt(row['secret'])=='fixture-legacy-secret'
                legacydb=sqlite3.connect(source/'cloudheron.sqlite');old=legacydb.execute('SELECT password FROM users').fetchone()[0];legacydb.close();new=conn.execute('SELECT password FROM users').fetchone()['password'];assert new==old
            c.app.state.ctx.storage.delete('assets/legacy-asset.png');c.app.state.ctx.storage.client.delete_bucket(Bucket=settings.s3_bucket)
        try:module.migrate(source,settings)
        except ValueError as e:assert '目标已有业务数据' in str(e)
        else:raise AssertionError('应拒绝重复导入非空目标')
    finally:
        from cloudheron.storage import Storage
        from botocore.exceptions import ClientError
        store=Storage(settings)
        try:
            for o in store.client.list_objects_v2(Bucket=store.bucket).get('Contents',[]):store.delete(o['Key'])
            store.client.delete_bucket(Bucket=store.bucket)
        except ClientError as e:
            if e.response['Error']['Code']!='NoSuchBucket':raise
        with psycopg.connect(postgres_url,autocommit=True) as conn:conn.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
