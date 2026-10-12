from pathlib import Path
import os,subprocess,tempfile,shutil
from urllib.parse import urlsplit
from dotenv import dotenv_values
r=Path(__file__).resolve().parents[2];work=r/'.work/backend-v020';work.mkdir(parents=True,exist_ok=True);env=dotenv_values(r/'backend/.env')
u=urlsplit(env.get('DATABASE_URL',''))
if u.hostname!='127.0.0.1' or u.port!=55432 or u.username!='cloudheron' or u.path!='/cloudheron': raise SystemExit('本机脚本仅用于 127.0.0.1:55432/cloudheron 的专用开发配置')
located=shutil.which('pg_ctl');fallback='/opt/homebrew/opt/postgresql@17/bin'
pgbin=Path(os.getenv('CLOUDHERON_PG_BIN',str(Path(located).parent) if located else fallback));data=work/'postgres-data'
if not data.exists():
    fd,pw=tempfile.mkstemp(prefix='cloudheron-pg-',dir=work);os.fchmod(fd,0o600)
    with os.fdopen(fd,'w') as f:f.write(env['POSTGRES_PASSWORD'])
    try:subprocess.run([pgbin/'initdb','-D',data,'-U','cloudheron','--pwfile',pw,'--auth-local','trust','--auth-host','scram-sha-256','--encoding','UTF8','--locale','C'],check=True,stdout=subprocess.DEVNULL)
    finally:os.unlink(pw)
status=subprocess.run([pgbin/'pg_ctl','-D',data,'status'],capture_output=True)
if status.returncode:subprocess.run([pgbin/'pg_ctl','-D',data,'-l',work/'postgres.log','-o','-h 127.0.0.1 -p 55432 -k '+str(work),'-w','start'],check=True)
clientenv={**os.environ,'PGPASSWORD':env['POSTGRES_PASSWORD']}
for db in ('cloudheron','cloudheron_test'):
    check=subprocess.run([pgbin/'psql','-h','127.0.0.1','-p','55432','-U','cloudheron','-d','postgres','-tAc',"SELECT 1 FROM pg_database WHERE datname='"+db+"'"],env=clientenv,capture_output=True,text=True,check=True)
    if not check.stdout.strip():subprocess.run([pgbin/'createdb','-h','127.0.0.1','-p','55432','-U','cloudheron',db],env=clientenv,check=True)
print('项目专用 PostgreSQL 已启动：127.0.0.1:55432；未启用系统自启动服务。')
