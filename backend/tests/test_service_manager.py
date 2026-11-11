import json,os,socket,subprocess,sys,time,signal
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import httpx,psycopg
from psycopg import sql
from cloudheron.config import Settings,ROOT

MANAGER=ROOT/'backend/scripts/manage.py'
def free_port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]

def invoke(action,env):
    r=subprocess.run([sys.executable,str(MANAGER),action,'--json'],env=env,cwd=ROOT/'backend',capture_output=True,text=True,timeout=40)
    return r,json.loads(r.stdout)

def test_background_start_duplicate_restart_preserves_login_and_stops(tmp_path):
    s=Settings();u=urlsplit(s.database_url);name='cloudheron_service_'+os.urandom(4).hex()+'_test'
    admin=urlunsplit((u.scheme,u.netloc,'/postgres',u.query,''));target=urlunsplit((u.scheme,u.netloc,'/'+name,u.query,''));port=free_port()
    with psycopg.connect(admin,autocommit=True) as conn:conn.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    env={**os.environ,'DATABASE_URL':target,'DEV_STORAGE':'moto','PORT':str(port),'CLOUDHERON_RUN_DIR':str(tmp_path/'runtime'),'S3_BUCKET':'cloudheron-service-qa-'+os.urandom(4).hex(),'S3_CREATE_BUCKET':'true'}
    try:
        r,first=invoke('start',env);assert r.returncode==0,(r.stdout,r.stderr);assert first['status']=='ready';assert first['version']=='0.3.3'
        r,again=invoke('start',env);assert r.returncode==0;assert again['pid']==first['pid']
        with httpx.Client(base_url=f'http://127.0.0.1:{port}',headers={'X-CloudHeron':'1'},trust_env=False) as c:
            assert c.get('/').status_code==200;assert c.get('/docs').status_code==200;assert c.get('/openapi.json').json()['info']['version']=='0.3.3'
            assert c.post('/api/setup',json={'team':'服务测试','name':'QA','email':'service@fixture.test','password':'fixture-password-123'}).status_code==201
            user=c.get('/api/me').json()['user']['id']
        r,reloaded=invoke('reload',env);assert r.returncode==0;assert reloaded['storage_pid']==first['storage_pid']
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            r,recovered=invoke('status',env)
            if recovered.get('status')=='ready' and recovered.get('api_pid')!=first['api_pid']:break
            time.sleep(.2)
        else:raise AssertionError('后台API未恢复')
        assert recovered['pid']==first['pid'];assert recovered['restarts']>=1
        r,stopped=invoke('stop',env);assert r.returncode==0;assert stopped['status']=='stopped'
        r,second=invoke('start',env);assert r.returncode==0;assert second['pid']!=first['pid']
        with httpx.Client(base_url=f'http://127.0.0.1:{port}',headers={'X-CloudHeron':'1'},trust_env=False) as c:
            login=c.post('/api/login',json={'email':'service@fixture.test','password':'fixture-password-123'});assert login.status_code==200;assert login.json()['user']['id']==user
    finally:
        invoke('stop',env)
        with psycopg.connect(admin,autocommit=True) as conn:conn.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))

def test_manager_refuses_unrelated_port_without_stopping_it(tmp_path):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));sock.listen();port=sock.getsockname()[1]
        env={**os.environ,'PORT':str(port),'CLOUDHERON_RUN_DIR':str(tmp_path/'unrelated')}
        r,state=invoke('start',env);assert r.returncode==1;assert state['status']=='port_in_use'
        # Manager never spawned a supervisor or closed the unrelated listener.
        assert sock.fileno()>=0;assert not (tmp_path/'unrelated/service.json').exists()
