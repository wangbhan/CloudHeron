import base64,copy,email,json,os,threading,time,subprocess
from email import policy
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import pytest,httpx,psycopg
from contextlib import ExitStack
from concurrent.futures import ThreadPoolExecutor
from psycopg import sql
from fastapi.testclient import TestClient
from cloudheron.main import create_app
from cloudheron.config import Settings,ROOT
from cloudheron.db import Database,TABLES,DB
from cloudheron.domain import TEMPLATES
from cloudheron.security import verify

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKwAAAABJRU5ErkJggg==');VIDEO=b'\x00\x00\x00\x18ftypisom000000000000'
def wait(fn):
    until=time.monotonic()+8
    while time.monotonic()<until:
        value=fn()
        if value:return value
        time.sleep(.02)
    raise AssertionError('等待集成状态超时')

@pytest.fixture(scope='module')
def env():
    settings=Settings();u=urlsplit(settings.database_url);test_url=os.getenv('CLOUDHERON_TEST_DATABASE_URL',urlunsplit((u.scheme,u.netloc,'/cloudheron_test',u.query,u.fragment)))
    if not urlsplit(test_url).path.endswith('_test'): raise RuntimeError('集成验证数据库名须以 _test 结尾，拒绝重置日常数据库')
    settings=settings.model_copy(update={'database_url':test_url,'s3_bucket':'cloudheron-qa-'+os.urandom(5).hex(),'s3_create_bucket':True,'poll_seconds':.01,'workers':1,'max_pending_per_user':3})
    database=Database(test_url);database.migrate()
    with database.connection() as conn: conn.execute(sql.SQL('TRUNCATE {} CASCADE').format(sql.SQL(',').join(sql.Identifier(t) for t in TABLES)))
    database.close();state={'received':[],'proposal':None,'hold':None}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def output(self,data,status=200,mime='application/json'):
            self.send_response(status);self.send_header('Content-Type',mime);self.end_headers();self.wfile.write(data if isinstance(data,bytes) else json.dumps(data).encode())
        def do_GET(self):
            if self.path=='/v1/models':return self.output({'data':[{'id':'fixture'}]})
            if self.path=='/v1/videos/fixture-video':return self.output({'id':'fixture-video','status':'completed'})
            if self.path=='/v1/videos/fixture-video/content':return self.output(VIDEO,mime='video/mp4')
            return self.output({},404)
        def do_POST(self):
            raw=self.rfile.read(int(self.headers['Content-Length']));body={};files={}
            if self.headers.get('Content-Type','').startswith('multipart'):
                message=email.message_from_bytes(b'Content-Type: '+self.headers['Content-Type'].encode()+b'\r\nMIME-Version: 1.0\r\n\r\n'+raw,policy=policy.default)
                for part in message.iter_parts():
                    key=part.get_param('name',header='content-disposition');data=part.get_payload(decode=True)
                    if part.get_filename():files[key]=data
                    else:body[key]=data.decode()
            else:body=json.loads(raw)
            state['received'].append({'path':self.path,'body':body,'files':files})
            if state['hold']:state['hold'].wait(10)
            if self.path=='/v1/chat/completions':return self.output({'choices':[{'message':{'content':json.dumps({'explanation':'雨夜改晨光','document':state['proposal']}) if 'explanation' in body['messages'][0]['content'] else '夹具晨光提示词'}}]})
            if body.get('fixture_fail'):return self.output({'error':'unsupported fixture_fail Bearer fixture-secret'},422)
            if self.path.startswith('/v1/images/'):return self.output({'data':[{'b64_json':base64.b64encode(PNG).decode()} for _ in range(int(body.get('n',1)))]})
            if self.path=='/v1/videos':return self.output({'id':'fixture-video','status':'queued'})
            return self.output({},404)
    fixture=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=fixture.serve_forever,daemon=True);thread.start()
    app=create_app(settings)
    stack=ExitStack()
    with stack:
        c=stack.enter_context(TestClient(app,raise_server_exceptions=False))
        c.headers['X-CloudHeron']='1';r=c.post('/api/setup',json={'name':'QA','team':'PostgreSQL QA','email':'admin@fixture.test','password':'fixture-password-123'});assert r.status_code==201,r.text
        ctx={'settings':settings,'app':app,'client':c,'state':state,'fixture':fixture,'clients':[],'stack':stack}
        for role in ('editor','viewer'):
            invited=c.post('/api/users',json={'name':role,'email':role+'@fixture.test','role':role});assert invited.status_code==201
            other=TestClient(app,raise_server_exceptions=False);other.headers['X-CloudHeron']='1';joined=other.post('/api/join',json={'token':invited.json()['invite_path'].split('/')[-1],'password':'fixture-password-123'});assert joined.status_code==200
            ctx[role]=other;ctx[role+'_id']=joined.json()['user']['id'];ctx['clients'].append(other)
        p=c.post('/api/projects',json={'name':'集成项目','visibility':'team'});assert p.status_code==201;ctx['project']=p.json()
        spec={'protocol':'OpenAI','base_url':f'http://127.0.0.1:{fixture.server_port}/v1','model':'fixture','capabilities':['image','image_edit','video','video_reference','text'],'extra':{'watermark':True}}
        m=c.post('/api/models',json={'name':'本机 API 夹具','api_key':'fixture-secret','spec':spec});assert m.status_code==201,m.text;ctx['model']=m.json();ctx['spec']=spec
        doc=copy.deepcopy(TEMPLATES[0]['document']);doc['nodes'][1]['params']['model_id']=ctx['model']['id'];doc['nodes'][0]['params']['prompt']='测试晨光';w=c.post('/api/workflows',json={'project_id':ctx['project']['id'],'name':'集成流程','document':doc});assert w.status_code==201,w.text;ctx['workflow']=w.json()
        yield ctx
        if state['hold']:state['hold'].set()
        for other in ctx['clients']:other.close()
        # Remove only the dedicated test bucket.
        store=app.state.ctx.storage;objects=store.client.list_objects_v2(Bucket=store.bucket).get('Contents',[])
        for o in objects:store.delete(o['Key'])
        store.client.delete_bucket(Bucket=store.bucket)
        ctx['stack'].close()
    fixture.shutdown();fixture.server_close()

def call_job(env,job):
    c=env['client']
    return wait(lambda:(j if j.get('status') in ('completed','failed') else None) if (j:=c.get('/api/jobs/'+job).json()) else None)
def chat(env,title='test'):
    r=env['client'].post('/api/chats',json={'project_id':env['project']['id'],'title':title});assert r.status_code==201;return r.json()['id']
def config(env,agent='image',**kwargs):return {'agent':agent,'model_id':env['model']['id'],**kwargs}

def test_health_auth_and_pg_jsonb(env):
    c=env['client'];assert c.get('/api/ready').json()['database']=='postgresql';assert c.get('/api/ready').json()['storage']=='s3'
    assert env['viewer'].get('/api/system/status').status_code==403
    unsigned=TestClient(env['app'],raise_server_exceptions=False);assert unsigned.get('/api/me').status_code==401;unsigned.close()
    with env['app'].state.ctx.database.connection() as conn:assert conn.execute("SELECT pg_typeof(document)::text t FROM workflows LIMIT 1").fetchone()['t']=='jsonb'

def test_project_permissions_and_last_admin(env):
    c=env['client'];p=c.post('/api/projects',json={'name':'私有','visibility':'private'}).json()
    assert env['editor'].get('/api/projects/'+p['id']+'/contents').status_code==403
    assert env['viewer'].post('/api/projects',json={'name':'bad','visibility':'team'}).status_code==403
    me=c.get('/api/me').json()['user'];assert c.patch('/api/users/'+me['id'],json={'name':me['name'],'role':'viewer','active':True}).status_code==400
    assert 'password' not in me

def test_model_encrypted_and_hidden(env):
    c=env['client'];assert c.post('/api/models/'+env['model']['id']+'/check',json={}).status_code==200
    disabled=c.post('/api/models',json={'name':'已停用夹具','spec':env['spec'],'enabled':False});assert disabled.status_code==201;assert disabled.json()['enabled'] is False
    assert 'secret' not in c.get('/api/models').json()[0]
    assert 'base_url' not in env['viewer'].get('/api/models').json()[0]['spec']
    with env['app'].state.ctx.database.connection() as conn:
        secret=conn.execute('SELECT secret FROM models WHERE id=%s',(env['model']['id'],)).fetchone()['secret'];assert 'fixture-secret' not in secret;assert env['app'].state.ctx.vault.decrypt(secret)=='fixture-secret'

def test_asset_bucket_range_and_signed(env):
    c=env['client'];r=c.post('/api/assets',json={'project_id':env['project']['id'],'name':'参考','kind':'character','visibility':'team','mime':'image/png','filename':'ref.png','base64':base64.b64encode(PNG).decode()});assert r.status_code==201,r.text;a=r.json();env['asset']=a
    assert 'file' not in a;assert c.get(a['url']).content==PNG
    partial=c.get(a['url'],headers={'Range':'bytes=0-7'});assert partial.status_code==206;assert partial.content==PNG[:8]
    assert c.get(a['url'],headers={'Range':'bad'}).status_code==416
    signed=c.post('/api/assets/'+a['id']+'/download-url',json={}).json();assert signed['expires_in']==300;assert httpx.get(signed['url']).content==PNG
    parent=c.post('/api/assets',json={'parent_id':a['id'],'project_id':env['project']['id'],'name':'参考 v2','kind':'character','visibility':'team','mime':'image/png','filename':'ref.png','base64':base64.b64encode(PNG).decode()});assert parent.status_code==201;assert parent.json()['version']==2;assert parent.json()['metadata']['family_id']==a['id']
    assert c.post('/api/assets',json={'name':'bad','kind':'image','visibility':'team','mime':'image/png','filename':'bad.png','base64':'YWRmbm90aW1hZ2U='}).status_code==400

def test_workflow_revision_template_restore_and_validation(env):
    c=env['client'];w=env['workflow'];doc=copy.deepcopy(w['document']);doc['nodes'][0]['params']['prompt']='雨夜'
    assert c.post('/api/workflows/validate',json={'project_id':w['project_id'],'document':doc}).status_code==200
    saved=c.put('/api/workflows/'+w['id'],json={'revision':w['revision'],'document':doc});assert saved.status_code==200;assert 'can_edit' not in saved.json();assert 'job' not in saved.json();w=saved.json()
    assert c.put('/api/workflows/'+w['id'],json={'revision':1,'document':doc}).status_code==409
    t=c.post('/api/workflow-templates',json={'workflow_id':w['id'],'revision':w['revision'],'name':'快照'});assert t.status_code==201,t.text
    clone=c.post('/api/workflow-templates/'+t.json()['id']+'/instantiate',json={'project_id':w['project_id'],'revision':1,'name':'副本'});assert clone.status_code==201;assert clone.json()['document']['nodes'][1]['params']['model_id']==''
    restored=c.post('/api/workflows/'+w['id']+'/restore',json={'revision':w['revision'],'source_revision':1});assert restored.status_code==200;env['workflow']=restored.json()
    assert len(c.get('/api/workflows/'+w['id']+'/versions').json())==3

def test_image_chat_options_reference_and_history(env):
    c=env['client'];cid=chat(env);cfg=config(env,n=2,quality='high',guidance_scale=0,seed=0,api_params={'watermark':False,'nested':{'weights':[0,.5]}})
    r=c.post('/api/chats/'+cid+'/messages',json={'prompt':'双图','config':cfg});assert r.status_code==202,r.text;j=call_job(env,r.json()['id']);assert j['status']=='completed',j;assert len(j['outputs'])==2
    body=env['state']['received'][-1]['body'];assert body['n']==2;assert body['watermark'] is False;assert body['guidance_scale']==0;assert body['seed']==0
    history=c.get('/api/chats/'+cid).json()['messages'];assert history[0]['config']['n']==2
    cid=chat(env);r=c.post('/api/chats/'+cid+'/messages',json={'prompt':'参考','config':config(env,asset_ids=[env['asset']['id']],n=2,api_params={'watermark':False})});assert call_job(env,r.json()['id'])['status']=='completed'
    received=env['state']['received'][-1];assert received['files']['image']==PNG;assert received['body']['watermark']=='false';assert received['body']['n']=='2'

def test_text_auxiliary_and_video_json_multipart(env):
    c=env['client'];cid=chat(env);r=c.post('/api/chats/'+cid+'/messages',json={'prompt':'整理','config':config(env,'prompt',temperature=0,max_tokens=64,stop=['END'])});assert call_job(env,r.json()['id'])['status']=='completed'
    assert env['state']['received'][-1]['body']['temperature']==0
    cid=chat(env);r=c.post('/api/chats/'+cid+'/messages',json={'prompt':'理解','config':config(env,text_model_id=env['model']['id'],text_options={'temperature':.3,'max_tokens':40},quality='medium')});assert call_job(env,r.json()['id'])['status']=='completed'
    assert env['state']['received'][-2]['body']['max_tokens']==40;assert 'quality' not in env['state']['received'][-2]['body']
    cid=chat(env);r=c.post('/api/chats/'+cid+'/messages',json={'prompt':'视频','config':config(env,'video',asset_ids=[env['asset']['id']],fps=24,api_params={'watermark':False})});assert call_job(env,r.json()['id'])['status']=='completed'
    received=next(x for x in reversed(env['state']['received']) if x['path']=='/v1/videos');assert received['files']['input_reference']==PNG;assert received['body']['fps']=='24'
    spec={**env['spec'],'video_format':'json'};assert c.put('/api/models/'+env['model']['id'],json={'name':'夹具','spec':spec}).status_code==200
    cid=chat(env);r=c.post('/api/chats/'+cid+'/messages',json={'prompt':'JSON 视频','config':config(env,'video',asset_ids=[env['asset']['id']],fps=24,api_params={'watermark':False})});assert call_job(env,r.json()['id'])['status']=='completed'
    received=next(x for x in reversed(env['state']['received']) if x['path']=='/v1/videos');assert received['body']['watermark'] is False;assert received['body']['input_reference'].endswith(base64.b64encode(PNG).decode())

def test_ai_proposal_confirm_once_no_execution(env):
    c=env['client'];w=env['workflow'];doc=copy.deepcopy(w['document']);doc['nodes'][0]['params']['prompt']='晨光';env['state']['proposal']=doc
    before=c.get('/api/system/status').json();analysis=c.post('/api/workflows/'+w['id']+'/assist',json={'mode':'analyze','model_id':env['model']['id'],'prompt':'检查','params':{'temperature':0}});assert analysis.status_code==200,analysis.text
    proposal=c.post('/api/workflows/'+w['id']+'/assist',json={'mode':'modify','model_id':env['model']['id'],'prompt':'改晨光'});assert proposal.status_code==200,proposal.text
    p=proposal.json();assert c.get('/api/workflows/'+w['id']).json()['revision']==w['revision']
    confirmed=c.post('/api/proposals/'+p['id']+'/confirm',json={});assert confirmed.status_code==200;env['workflow']=confirmed.json();assert c.post('/api/proposals/'+p['id']+'/confirm',json={}).status_code==409
    after=c.get('/api/system/status').json();assert (before['queued'],before['running'])==(after['queued'],after['running'])

def test_idempotency_concurrency_conflict_and_published_api(env):
    c=env['client'];w=env['workflow'];key='integration-key';r=c.post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']},headers={'Idempotency-Key':key});assert r.status_code==202
    j=call_job(env,r.json()['id']);assert j['status']=='completed',j;count=len(env['state']['received'])
    again=c.post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']},headers={'Idempotency-Key':key});assert again.json()['id']==j['id'];assert again.headers['Idempotency-Replayed']=='true';assert len(env['state']['received'])==count
    assert c.post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']+1},headers={'Idempotency-Key':key}).status_code==409
    pub=c.post('/api/publications',json={'workflow_id':w['id'],'name':'API','version':'1'}).json();headers={'Authorization':'Bearer '+pub['token'],'Idempotency-Key':'endpoint-key'}
    r=c.post(pub['path'],json={'prompt':'API 图片'},headers=headers);assert r.status_code==202,r.text;assert call_job(env,r.json()['id'])['status']=='completed'
    public=c.get('/api/v1/runs/'+r.json()['id'],headers=headers);assert public.status_code==200;assert c.get(public.json()['outputs'][0]['url'],headers=headers).content==PNG
    assert c.patch('/api/publications/'+pub['id'],json={}).status_code==200;assert c.post(pub['path'],json={'prompt':'API 图片'},headers=headers).status_code==401

def test_error_no_job_and_redacted_upstream(env):
    c=env['client'];cid=chat(env)
    for raw in [{'n':5},{'api_params':[]},{'api_params':{'model':'bad'}}]:assert c.post('/api/chats/'+cid+'/messages',json={'prompt':'错误','config':config(env,**raw)}).status_code==400
    assert c.get('/api/chats/'+cid).json()['messages']==[]
    r=c.post('/api/chats/'+cid+'/messages',json={'prompt':'上游错误','config':config(env,api_params={'fixture_fail':True})});j=call_job(env,r.json()['id']);assert j['status']=='failed';assert 'HTTP 422' in j['error'];assert 'fixture-secret' not in j['error'];assert j['steps']['agent']['status']=='failed'

def test_skills_expert_manual_seed_and_frontend(env):
    c=env['client'];s=c.post('/api/skills',json={'name':'自建','task':'all','template':'测试 {{prompt}}'});assert s.status_code==201
    e=c.post('/api/experts',json={'name':'组合','task':'all','skill_ids':['skill_visual',s.json()['id']]});assert e.status_code==201
    assert c.post('/api/experts',json={'name':'重复','task':'all','skill_ids':['skill_visual','skill_visual']}).status_code==400
    ws=c.post('/api/test-workspace',json={});assert ws.status_code==200,ws.text;again=c.post('/api/test-workspace',json={});assert ws.json()==again.json()
    assert len(c.get('/api/projects/'+ws.json()['project_id']+'/test-cases').json())==len(json.loads((env['settings'].frontend_dir/'test-cases.json').read_text()))
    assert c.get('/').status_code==200;assert 'apiOptionFields' in c.get('/app.js').text
    for path in ('projects','models','assets','skills','users','workflows','chats','publications','agents','experts','test-workspace','workflow-templates','task-options'):assert c.get('/api/'+path).status_code==200,path



def test_parallel_idempotency_limits_and_account_isolation(env):
    c=env['client'];w=env['workflow'];gate=threading.Event();env['state']['hold']=gate;before=len(env['state']['received'])
    try:
        def submit():return c.post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']},headers={'Idempotency-Key':'parallel-key'})
        with ThreadPoolExecutor(2) as pool:r=list(pool.map(lambda _:submit(),range(2)))
        assert all(x.status_code==202 for x in r);assert r[0].json()['id']==r[1].json()['id']
        wait(lambda:len(env['state']['received'])==before+1)
        others=[c.post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']},headers={'Idempotency-Key':f'cap-{i}'}) for i in range(2)]
        status=c.get('/api/system/status').json();assert status['running']==1;assert status['queued']==2;assert status['workers']['active']==1
        assert c.post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']},headers={'Idempotency-Key':'cap-extra'}).status_code==429
        assert submit().json()['id']==r[0].json()['id']
    finally:env['state']['hold']=None;gate.set()
    for item in [r[0],*others]:assert call_job(env,item.json()['id'])['status']=='completed'
    count=len(env['state']['received']);other=env['editor'].post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']},headers={'Idempotency-Key':'parallel-key'});assert other.status_code==202;assert other.json()['id']!=r[0].json()['id'];assert call_job(env,other.json()['id'])['status']=='completed';assert len(env['state']['received'])==count+1

def test_request_and_completion_transactions(env):
    c=env['client'];cid=chat(env,'故障事务');ctx=env['app'].state.ctx
    with ctx.database.connection() as conn:
        before=conn.execute('SELECT count(*) n FROM jobs').fetchone()['n']
        conn.execute("CREATE FUNCTION fixture_reject_key() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture request rollback'; END $$; CREATE TRIGGER fixture_key BEFORE INSERT ON request_keys FOR EACH ROW EXECUTE FUNCTION fixture_reject_key();")
    try:
        response=c.post('/api/chats/'+cid+'/messages',json={'prompt':'事务','config':config(env)},headers={'Idempotency-Key':'txn-fail'});assert response.status_code==500
        assert c.get('/api/chats/'+cid).json()['messages']==[]
        with ctx.database.connection() as conn:assert conn.execute('SELECT count(*) n FROM jobs').fetchone()['n']==before
    finally:
        with ctx.database.connection() as conn:conn.execute('DROP TRIGGER fixture_key ON request_keys;DROP FUNCTION fixture_reject_key();')
    with ctx.database.connection() as conn:conn.execute("CREATE FUNCTION fixture_reject_terminal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture terminal rollback'; END $$; CREATE TRIGGER fixture_terminal BEFORE UPDATE OF status ON jobs FOR EACH ROW WHEN (NEW.status='completed') EXECUTE FUNCTION fixture_reject_terminal();")
    try:
        response=c.post('/api/chats/'+cid+'/messages',json={'prompt':'终态','config':config(env)},headers={'Idempotency-Key':'terminal-fail'});j=call_job(env,response.json()['id']);assert j['status']=='failed'
        messages=c.get('/api/chats/'+cid).json()['messages'];assert len([m for m in messages if m['role']=='assistant'])==1;assert messages[-1]['text'].startswith('生成失败')
        count=len(env['state']['received']);again=c.post('/api/chats/'+cid+'/messages',json={'prompt':'终态','config':config(env)},headers={'Idempotency-Key':'terminal-fail'});assert again.json()['id']==j['id'];assert len(env['state']['received'])==count
    finally:
        with ctx.database.connection() as conn:conn.execute('DROP TRIGGER fixture_terminal ON jobs;DROP FUNCTION fixture_reject_terminal();')

def test_pg_single_executor_and_restart_queue(env):
    with pytest.raises(RuntimeError,match='已有云鹭执行器'):
        with TestClient(create_app(env['settings'])):pass
    c=env['client'];w=env['workflow'];gate=threading.Event();env['state']['hold']=gate
    a=c.post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']},headers={'Idempotency-Key':'restart-active'});wait(lambda:c.get('/api/jobs/'+a.json()['id']).json()['status']=='running')
    b=c.post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']},headers={'Idempotency-Key':'restart-queued'})
    closed=threading.Event();failure=[]
    def close():
        try:env['stack'].close()
        except Exception as e:failure.append(e)
        finally:closed.set()
    closer=threading.Thread(target=close);closer.start();wait(lambda:env['app'].state.ctx.worker.stop_event.is_set());assert not closed.is_set()
    env['state']['hold']=None;gate.set();closer.join(8);assert closed.is_set();assert not failure
    with psycopg.connect(env['settings'].database_url) as conn:
        assert conn.execute('SELECT status FROM jobs WHERE id=%s',(a.json()['id'],)).fetchone()[0]=='completed';assert conn.execute('SELECT status FROM jobs WHERE id=%s',(b.json()['id'],)).fetchone()[0]=='queued'
    cookies=c.cookies;stack=ExitStack();new=stack.enter_context(TestClient(env['app'],raise_server_exceptions=False));new.cookies.update(cookies);new.headers['X-CloudHeron']='1';env.update(client=new,stack=stack)
    assert call_job(env,b.json()['id'])['status']=='completed'
    cid=chat(env,'中断');ctx=env['app'].state.ctx
    with ctx.database.connection() as conn:
        d=DB(conn);d.insert('jobs',{'id':'interrupted-qa','project_id':env['project']['id'],'owner_id':new.get('/api/me').json()['user']['id'],'source':'chat','source_id':cid,'snapshot':{},'status':'running','steps':{'done':{'status':'completed'},'agent':{'status':'running'}}})
    cookies=new.cookies;stack.close();stack=ExitStack();new=stack.enter_context(TestClient(env['app'],raise_server_exceptions=False));new.cookies.update(cookies);new.headers['X-CloudHeron']='1';env.update(client=new,stack=stack)
    j=call_job(env,'interrupted-qa');assert j['status']=='failed';assert j['steps']['done']['status']=='completed';assert j['steps']['agent']['status']=='failed';assert len(new.get('/api/chats/'+cid).json()['messages'])==1

    # Losing the connection that owns the PG advisory lock stops new execution.
    ctx=env['app'].state.ctx
    with ctx.database.connection() as conn:conn.execute('SELECT pg_terminate_backend(%s)',(ctx.owner.info.backend_pid,))
    wait(lambda:ctx.closing and ctx.worker.stop_event.is_set())
    assert new.get('/api/ready').status_code==503
    assert new.post('/api/workflows/'+w['id']+'/run',json={'revision':w['revision']},headers={'Idempotency-Key':'after-lock-loss'}).status_code==503
