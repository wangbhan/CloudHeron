from pathlib import Path
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg import sql

TABLES={'creations','meta','users','sessions','projects','workflows','chats','assets','models','skills','experts','proposals','publications','jobs','workflow_versions','workflow_templates','project_test_cases','request_keys'}
JSON_COLUMNS={'acl','document','messages','metadata','spec','skill_ids','snapshot','steps','outputs','definition','value'}
def now():
    from datetime import datetime,timezone
    return datetime.now(timezone.utc)
class DB:
    def __init__(self,conn): self.conn=conn
    def one(self,q,*args): return self.conn.execute(q,args).fetchone()
    def all(self,q,*args): return self.conn.execute(q,args).fetchall()
    def run(self,q,*args): return self.conn.execute(q,args)
    def tx(self): return self.conn.transaction()
    def insert(self,table,record):
        if table not in TABLES: raise ValueError('未知数据表')
        keys=list(record);values=[Jsonb(v) if isinstance(v,(dict,list)) else v for v in record.values()]
        return self.conn.execute(sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,keys)),sql.SQL(',').join(sql.Placeholder() for _ in keys)),values)
class Database:
    def __init__(self,url):
        self.pool=ConnectionPool(url,kwargs={'autocommit':True,'row_factory':dict_row},min_size=2,max_size=32,open=True,timeout=10)
        self.pool.wait(15)
    def connection(self): return self.pool.connection()
    def migrate(self):
        source=Path(__file__).resolve().parents[1]/'migrations'
        with self.connection() as conn:
            with conn.transaction():
                conn.execute('SELECT pg_advisory_xact_lock(91401701)')
                conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
                for file in sorted(source.glob('*.sql')):
                    if not conn.execute('SELECT version FROM schema_migrations WHERE version=%s',(file.name,)).fetchone():
                        conn.execute(file.read_text());conn.execute('INSERT INTO schema_migrations(version) VALUES(%s)',(file.name,))
    def close(self): self.pool.close()
