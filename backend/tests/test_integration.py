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
    database.close();state={'received':[],'proposal':None,'hold':None,'probe':'success','probes':[]}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def output(self,data,status=200,mime='application/json'):
            self.send_response(status);self.send_header('Content-Type',mime);self.end_headers()
            try:self.wfile.write(data if isinstance(data,bytes) else json.dumps(data).encode())
            except (BrokenPipeError,ConnectionResetError):pass
        def do_GET(self):
            if self.path=='/v1/models':
                state['probes'].append(dict(self.headers))
                if state['probe']=='fail':return self.output({'error':'x-api-key fixture-secret'},401)
                if state['probe']=='slow':time.sleep(.25)
                if state['probe']=='invalid':return self.output({'other':[]})
                return self.output({'data':[{'id':'fixture'}]})
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
            state['received'].append({'path':self.path,'body':body,'files':files,'headers':dict(self.headers)})
            if state['hold']:state['hold'].wait(10)
            if self.path in ('/v1/chat/completions','/v1/responses'):
                messages=body.get('messages',body.get('input',[]))
                if messages and 'cards' in messages[0]['content'] and '画面' in messages[0]['content']:
                    result=state.get('plan_response',json.dumps({'cards':[{'title':'画面'+str(i),'prompt':'云海中的白鹭'+str(i)} for i in range(1,4)]}))
                    if self.path=='/v1/responses':return self.output({'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':result}]}]})
                    return self.output({'choices':[{'message':{'content':result}}]})
            if self.path.startswith('/v1/images/') and 'FAIL_THIS_FRAME' in body.get('prompt',''):return self.output({'error':'fixture frame failure'},422)
            if self.path=='/v1/messages':return self.output({'content':[{'type':'thinking','thinking':'hidden'},{'type':'text','text':'Claude 夹具提示词'}]})
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
        c.headers['X-CloudHeron']='1'
        r=c.post('/api/register',json={'name':'QA','email':'admin@fixture.test','password':'fixture-password-123'})
        assert r.status_code==201,r.text
        assert not r.json()['user']['team_member']
        assert c.get('/api/projects').status_code==403
        r=c.post('/api/team',json={'name':'PostgreSQL QA'})
        assert r.status_code==200,r.text
        assert r.json()['user']['team_member']
        assert c.post('/api/team',json={'name':'second team'}).status_code==409
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

def test_public_account_registration_and_invitation_isolation(env):
    app = env['app']
    admin = env['client']
    newcomer = TestClient(app, raise_server_exceptions=False)
    env['clients'].append(newcomer)
    newcomer.headers['X-CloudHeron'] = '1'
    payload = {'email':'personal@fixture.test','name':'个人账号','password':'personal-password-123'}
    assert newcomer.post('/api/register', json={**payload, 'role':'admin'}).status_code == 422
    registered = newcomer.post('/api/register', json=payload)
    assert registered.status_code == 201, registered.text
    user = registered.json()['user']
    assert user['active'] and not user['team_member'] and user['role'] == 'viewer'
    assert newcomer.get('/api/me').json()['user']['id'] == user['id']
    for path in ('/api/projects','/api/models','/api/workflows','/api/assets','/api/users','/api/skills'):
        assert newcomer.get(path).status_code == 403, path
    assert newcomer.post('/api/team', json={'name':'another'}).status_code == 403
    assert newcomer.post('/api/register', json=payload).status_code == 409
    assert all(u['id'] != user['id'] for u in admin.get('/api/users').json())

    invite = admin.post('/api/users', json={'name':user['name'],'email':payload['email'],'role':'editor'})
    assert invite.status_code == 201, invite.text
    token = invite.json()['invite_path'].split('/')[-1]
    assert newcomer.get('/api/invitations/'+token).json()['registered'] is True
    assert not newcomer.get('/api/me').json()['user']['team_member']
    assert env['editor'].post('/api/team/join', json={'token':token}).status_code == 403
    assert newcomer.post('/api/join', json={'token':token,'password':'overwritten-password'}).status_code == 409

    joined = newcomer.post('/api/team/join', json={'token':token})
    assert joined.status_code == 200, joined.text
    assert joined.json()['user']['id'] == user['id']
    assert joined.json()['user']['role'] == 'editor'
    assert joined.json()['user']['team_member']
    assert newcomer.get('/api/projects').status_code == 200
    assert newcomer.get('/api/models').status_code == 200
    assert newcomer.post('/api/team/join', json={'token':token}).status_code == 400
    assert newcomer.post('/api/team', json={'name':'another'}).status_code == 403
    assert newcomer.post('/api/logout', json={}).status_code == 200
    login = newcomer.post('/api/login', json={'email':payload['email'],'password':payload['password']})
    assert login.status_code == 200 and login.json()['user']['id'] == user['id']

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
    signed=c.post('/api/assets/'+a['id']+'/download-url',json={}).json();assert signed['expires_in']==300;assert httpx.get(signed['url'],trust_env=False).content==PNG
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

def test_ai_missing_layout_proposal_normalized_before_confirmation(env):
    c=env['client'];w=c.get('/api/workflows/'+env['workflow']['id']).json();doc=copy.deepcopy(w['document'])
    for n in doc['nodes']:n.pop('position',None)
    doc['nodes'][0].pop('params',None);env['state']['proposal']=doc
    before=c.get('/api/system/status').json()
    p=c.post('/api/workflows/'+w['id']+'/assist',json={'mode':'modify','model_id':env['model']['id'],'prompt':'示例调整'})
    assert p.status_code==200,p.text
    assert p.json()['after']['nodes'][0]['params']==w['document']['nodes'][0]['params']
    assert c.get('/api/workflows/'+w['id']).json()['revision']==w['revision']
    saved=c.post('/api/proposals/'+p.json()['id']+'/confirm',json={});assert saved.status_code==200,saved.text
    env['workflow']=saved.json();after=c.get('/api/system/status').json()
    assert (before['queued'],before['running'])==(after['queued'],after['running'])
    bad=copy.deepcopy(doc);bad['nodes'][0]['position']={'x':'invalid','y':0};env['state']['proposal']=bad
    failed=c.post('/api/workflows/'+w['id']+'/assist',json={'mode':'modify','model_id':env['model']['id'],'prompt':'错误格式'})
    assert failed.status_code==422 and bad['nodes'][0]['id'] in failed.text
    assert c.get('/api/workflows/'+w['id']).json()['revision']==saved.json()['revision']

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

def test_worker_returns_connections_during_provider_and_storage_io(env, monkeypatch):
    client = env['client']
    ctx = env['app'].state.ctx
    chat_id = chat(env, '外部 IO 等待')
    provider_gate = threading.Event()
    storage_gate = threading.Event()
    storage_started = threading.Event()
    requests_before = len(env['state']['received'])
    put = ctx.storage.put

    def blocking_put(key, data, mime):
        storage_started.set()
        if not storage_gate.wait(10):
            raise RuntimeError('测试对象存储等待超时')
        put(key, data, mime)

    def pool_idle():
        stats = ctx.database.pool.get_stats()
        return stats['pool_available'] == stats['pool_size']

    monkeypatch.setattr(ctx.storage, 'put', blocking_put)
    env['state']['hold'] = provider_gate
    try:
        response = client.post(f'/api/chats/{chat_id}/messages', json={
            'prompt': '连接池回归', 'config': config(env),
        })
        assert response.status_code == 202, response.text
        job_id = response.json()['id']
        wait(lambda: len(env['state']['received']) == requests_before + 1)
        assert client.get(f'/api/jobs/{job_id}').json()['status'] == 'running'
        wait(pool_idle)

        provider_gate.set()
        assert storage_started.wait(8)
        assert client.get(f'/api/jobs/{job_id}').json()['status'] == 'running'
        wait(pool_idle)
    finally:
        env['state']['hold'] = None
        provider_gate.set()
        storage_gate.set()
    job = call_job(env, job_id)
    assert job['status'] == 'completed', job
    assert len(job['outputs']) == 1
    assert client.get(f"/api/assets/{job['outputs'][0]}/media").content == PNG


def test_worker_removes_uploaded_object_if_metadata_write_fails(env, monkeypatch):
    client = env['client']
    ctx = env['app'].state.ctx
    chat_id = chat(env, '对象存储补偿')
    put = ctx.storage.put
    uploaded_keys = []

    def record_put(key, data, mime):
        put(key, data, mime)
        uploaded_keys.append(key)

    monkeypatch.setattr(ctx.storage, 'put', record_put)
    with ctx.database.connection() as conn:
        conn.execute("""
            CREATE FUNCTION fixture_reject_asset() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'fixture asset rollback'; END $$;
            CREATE TRIGGER fixture_asset BEFORE INSERT ON assets
            FOR EACH ROW EXECUTE FUNCTION fixture_reject_asset();
        """)
    try:
        response = client.post(f'/api/chats/{chat_id}/messages', json={
            'prompt': '补偿回归', 'config': config(env),
        })
        assert response.status_code == 202, response.text
        job = call_job(env, response.json()['id'])
        assert job['status'] == 'failed'
        assert job['steps']['agent']['status'] == 'failed'
        assert job['outputs'] == []
        assert len(uploaded_keys) == 1
        with ctx.database.connection() as conn:
            assert conn.execute('SELECT id FROM assets WHERE file=%s', (uploaded_keys[0],)).fetchone() is None
        objects = ctx.storage.client.list_objects_v2(Bucket=ctx.storage.bucket, Prefix=uploaded_keys[0])
        assert objects['KeyCount'] == 0
    finally:
        with ctx.database.connection() as conn:
            conn.execute('DROP TRIGGER fixture_asset ON assets; DROP FUNCTION fixture_reject_asset();')


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

def test_connection_result_success_warning_failure_and_timeout(env):
    c=env['client'];ctx=env['app'].state.ctx;mid=env['model']['id']
    r=c.post('/api/models/'+mid+'/check',json={});assert r.status_code==200;assert r.json()['status']=='success';assert r.json()['model_available'] is True;assert 'elapsed_ms' in r.json()
    assert env['viewer'].post('/api/models/'+mid+'/check',json={}).status_code==403
    old=ctx.settings.model_check_timeout
    try:
        for mode in ('fail','invalid','slow'):
            env['state']['probe']=mode;ctx.settings.model_check_timeout=.05 if mode=='slow' else old
            start=time.monotonic();r=c.post('/api/models/'+mid+'/check',json={});assert r.status_code==200;assert r.json()['ok'] is False;assert r.json()['status']=='failed';assert 'fixture-secret' not in r.text
            if mode=='slow':assert time.monotonic()-start<1
        env['state']['probe']='success';ctx.settings.model_check_timeout=old
        changed={**env['spec'],'model':'not-in-list'};model=c.post('/api/models',json={'name':'列表警告','spec':changed}).json()
        r=c.post('/api/models/'+model['id']+'/check',json={});assert r.json()['status']=='warning';assert r.json()['model_available'] is False
    finally:env['state']['probe']='success';ctx.settings.model_check_timeout=old

def test_claude_messages_auth_system_options_and_agent(env):
    c=env['client'];spec={**env['spec'],'capabilities':['text'],'text_format':'claude'}
    r=c.post('/api/models',json={'name':'Claude 夹具','spec':spec,'api_key':'fixture-secret'});assert r.status_code==201;mid=r.json()['id']
    checked=c.post('/api/models/'+mid+'/check',json={});assert checked.json()['status']=='success';headers=env['state']['probes'][-1];assert headers['x-api-key']=='fixture-secret';assert headers['anthropic-version']=='2023-06-01';assert 'Authorization' not in headers
    cid=chat(env,'Claude');r=c.post('/api/chats/'+cid+'/messages',json={'prompt':'测试Claude','config':{'agent':'prompt','model_id':mid,'max_tokens':64,'temperature':0,'stop':['END']}});assert r.status_code==202;assert call_job(env,r.json()['id'])['status']=='completed'
    received=env['state']['received'][-1];body=received['body'];assert received['path']=='/v1/messages';assert body['system'];assert all(m['role']!='system' for m in body['messages']);assert body['max_tokens']==64;assert body['temperature']==0;assert body['stop_sequences']==['END'];assert 'stop' not in body
    assert c.get('/api/chats/'+cid).json()['messages'][-1]['text']=='Claude 夹具提示词'
    from cloudheron.provider import Provider
    with env['app'].state.ctx.database.connection() as conn:
        from cloudheron.service import Service
        s=Service(DB(conn),env['app'].state.ctx,c.get('/api/me').json()['user']);model=s.model(mid)
        adapter=Provider(env['settings'],s.context.vault,s.context.storage,None)
        assert adapter.chat(model,[{'role':'user','content':'default'}])=='Claude 夹具提示词';assert env['state']['received'][-1]['body']['max_tokens']==1024
        with pytest.raises(ValueError,match='不支持'):adapter.chat(model,[{'role':'user','content':'bad'}],{'presence_penalty':1})
        assert adapter.chat(env['model']|{'secret':s.context.vault.encrypt('fixture-secret')},[{'role':'user','content':'OpenAI'}])=='夹具晨光提示词'

def test_vllm_omni_video_frames_reference_and_extensions(env):
    c=env['client'];spec={**env['spec'],'protocol':'vLLM-Omni','video_style':'vllm_omni','video_format':'multipart','capabilities':['video','video_reference']}
    r=c.post('/api/models',json={'name':'Omni 视频夹具','spec':spec,'api_key':'fixture-secret'});assert r.status_code==201;mid=r.json()['id']
    assert c.post('/api/models',json={'name':'错误JSON','spec':{**spec,'video_format':'json'}}).status_code==400
    cfg={'agent':'video','model_id':mid,'asset_ids':[env['asset']['id']],'size':'832x480','seconds':4,'num_frames':81,'fps':16,'guidance_scale_2':4,'boundary_ratio':.875,'flow_shift':5,'api_params':{'extra_params':{'sample_solver':'euler'},'custom_flag':False}}
    for reference in ('image','video'):
        if reference=='video':
            a=c.post('/api/assets',json={'project_id':env['project']['id'],'name':'视频参考','kind':'video','visibility':'team','mime':'video/mp4','filename':'ref.mp4','base64':base64.b64encode(VIDEO).decode()});assert a.status_code==201;cfg['asset_ids']=[a.json()['id']]
        cid=chat(env,'Omni '+reference);r=c.post('/api/chats/'+cid+'/messages',json={'prompt':'视频测试','config':cfg});assert r.status_code==202;assert call_job(env,r.json()['id'])['status']=='completed'
        got=next(x for x in reversed(env['state']['received']) if x['path']=='/v1/videos');assert got['files']['input_reference']==(PNG if reference=='image' else VIDEO);assert len(got['files'])==1;assert got['body']['num_frames']=='81';assert 'seconds' not in got['body'];assert got['body']['fps']=='16';assert got['body']['guidance_scale_2']=='4';extras=json.loads(got['body']['extra_params']);assert extras['sample_solver']=='euler';assert extras['custom_flag'] is False;assert 'custom_flag' not in got['body']

def test_model_style_catalog_names_permissions_and_preserved_key(env):
    c=env['client'];styles=c.get('/api/model-styles');assert styles.status_code==200
    assert {'openai','anthropic','minimax','minimax_v2','vllm_omni'}<={s['id'] for s in styles.json()}
    spec={'interface_style':'minimax','provider':'My Provider','base_url':env['spec']['base_url'],'model':'custom/new-ID','capabilities':['text']}
    r=c.post('/api/models',json={'name':'解耦配置','spec':spec,'api_key':'fixture-secret'});assert r.status_code==201,r.text
    model=r.json();assert model['spec']['model']=='custom/new-ID';assert model['spec']['provider']=='My Provider';assert model['spec']['protocol']=='MiniMax'
    updated=c.put('/api/models/'+model['id'],json={'name':'另一个模型','spec':{**spec,'model':'another/arbitrary-model'},'enabled':False});assert updated.status_code==200;assert updated.json()['has_key']
    assert updated.json()['spec']['model']=='another/arbitrary-model'
    # A disabled connection may be checked without enabling it or generating content.
    checked=c.post('/api/models/'+model['id']+'/check',json={});assert checked.status_code==200 and checked.json()['status']=='warning'
    view=next(m for m in env['viewer'].get('/api/models').json() if m['id']==model['id']);assert view['spec']['provider']=='My Provider';assert 'base_url' not in view['spec'];assert 'extra' not in view['spec'];assert 'fixture-secret' not in json.dumps(view)
    assert env['viewer'].get('/api/model-styles').status_code==200
    assert env['viewer'].post('/api/models',json={'name':'bad','spec':spec}).status_code==403
    for bad in ({'interface_style':'unknown'},{'interface_style':'anthropic','capabilities':['image']}, {'interface_style':'minimax','capabilities':['video_reference','video']}):
        assert c.post('/api/models',json={'name':'bad','spec':spec|bad}).status_code==400
    for style,cap in [('minimax','image'),('minimax','video'),('minimax_v2','video')]:
        added=c.post('/api/models',json={'name':style+' '+cap,'spec':spec|{'interface_style':style,'capabilities':[cap],'model':'unlisted-2028-model'}});assert added.status_code==201,added.text
    assert c.get('/api/models').status_code==200

def creation(env,kind='image',count=3,manual=False):
    doc={'project_id':env['project']['id'],'name':'新手作品','story':'白鹭穿行云海','style':'东方山水','kind':kind,'count':count,'text_model_id':env['model']['id'],'model_id':env['model']['id'],'size':'1280x720' if kind=='video' else '1024x1024','seconds':6}
    if manual:doc['cards']=[{'title':'画面'+str(i),'prompt':'云海'+str(i)} for i in range(count)]
    r=env['client'].post('/api/creations',json=doc);assert r.status_code==201,r.text;return r.json(),doc

def test_guided_plan_confirm_manual_run_and_workflow_export(env):
    c=env['client'];before=len(env['state']['received']);item,doc=creation(env)
    assert len(env['state']['received'])==before
    p=c.post('/api/creations/'+item['id']+'/plan',json={'revision':1},headers={'Idempotency-Key':'plan-once'});assert p.status_code==202,p.text
    assert call_job(env,p.json()['id'])['status']=='completed'
    item=c.get('/api/creations/'+item['id']).json();assert item['revision']==2 and len(item['document']['cards'])==3
    assert len(env['state']['received'])==before+1  # Only text planning, no media calls.
    content=next(x for x in c.get('/api/projects/'+doc['project_id']+'/contents').json() if x['id']==item['id']);assert content['status']=='draft' and content['outputs']==[]
    assert c.post('/api/creations/'+item['id']+'/plan',json={'revision':1},headers={'Idempotency-Key':'plan-once'}).json()['id']==p.json()['id']
    assert c.post('/api/creations/'+item['id']+'/run',json={'revision':1}).status_code==409
    run=c.post('/api/creations/'+item['id']+'/run',json={'revision':2},headers={'Idempotency-Key':'guided-images'});assert run.status_code==202,run.text
    j=call_job(env,run.json()['id']);assert j['status']=='completed',j;assert len(j['outputs'])==3
    assert c.post('/api/creations/'+item['id']+'/run',json={'revision':2},headers={'Idempotency-Key':'guided-images'}).json()['id']==j['id']
    assets=c.get('/api/assets').json();assert all(next(a for a in assets if a['id']==aid)['metadata']['source']=='creation' for aid in j['outputs'])
    contents=c.get('/api/projects/'+doc['project_id']+'/contents').json();assert any(x['source']=='creation' and x['id']==item['id'] for x in contents)
    before=len(env['state']['received']);w=c.post('/api/creations/'+item['id']+'/workflow',json={'revision':2});assert w.status_code==201,w.text;assert len(w.json()['document']['nodes'])==7;assert len(env['state']['received'])==before

def test_guided_manual_video_and_failure_preserves_partial_assets(env):
    c=env['client'];item,doc=creation(env,'video',2,True)
    # Manual cards can generate without any text model.
    saved=c.put('/api/creations/'+item['id'],json={**doc,'text_model_id':'','revision':1});assert saved.status_code==200,saved.text
    r=c.post('/api/creations/'+item['id']+'/run',json={'revision':2});assert r.status_code==202;assert len(call_job(env,r.json()['id'])['outputs'])==2
    item,doc=creation(env,'image',2,True);doc['cards'][1]['prompt']='FAIL_THIS_FRAME'
    assert c.put('/api/creations/'+item['id'],json={**doc,'revision':1}).status_code==200
    r=c.post('/api/creations/'+item['id']+'/run',json={'revision':2});j=call_job(env,r.json()['id']);assert j['status']=='failed';assert j['steps']['generate_2']['status']=='failed';assert len(j['steps']['generate_1']['output']['asset_ids'])==1
    assert c.get('/api/assets/'+j['steps']['generate_1']['output']['asset_ids'][0]+'/media').content==PNG

def test_guided_permissions_validation_and_planning_failure(env):
    c=env['client'];item,doc=creation(env)
    assert env['viewer'].post('/api/creations',json=doc).status_code==403
    assert env['viewer'].post('/api/creations/'+item['id']+'/plan',json={'revision':1}).status_code==403
    assert env['viewer'].get('/api/creations/'+item['id']).status_code==200
    private=c.post('/api/projects',json={'name':'私有集成创作','visibility':'private'}).json()
    own=c.post('/api/creations',json=doc|{'project_id':private['id']}).json()
    assert env['editor'].get('/api/creations/'+own['id']).status_code==403
    assert all(x['id']!=own['id'] for x in env['editor'].get('/api/creations').json())
    assert c.post('/api/creations/'+item['id']+'/run',json={'revision':1}).status_code==400
    assert c.put('/api/creations/'+item['id'],json={**doc,'revision':1,'cards':[{'title':'x','prompt':''}]}).status_code==400
    env['state']['plan_response']='bad-json'
    try:
        r=c.post('/api/creations/'+item['id']+'/plan',json={'revision':1});j=call_job(env,r.json()['id']);assert j['status']=='failed';assert 'JSON' in j['error']
        assert c.get('/api/creations/'+item['id']).json()['revision']==1
    finally:env['state'].pop('plan_response',None)

def test_guided_selected_frames_only_and_retry_unfinished(env):
    c=env['client'];item,doc=creation(env,'image',3,True);base='/api/creations/'+item['id']
    for bad in ([],[0,0],[-1],[3],[True]):assert c.post(base+'/run',json={'revision':1,'card_indices':bad}).status_code in (400,422)
    before=len(env['state']['received']);r=c.post(base+'/run',json={'revision':1,'card_indices':[1]},headers={'Idempotency-Key':'select-frame'})
    assert r.status_code==202,r.text;j=call_job(env,r.json()['id']);assert len(j['outputs'])==1 and 'generate_2' in j['steps'] and 'generate_1' not in j['steps']
    assert c.get(base).json()['run_card_indices']==[1]
    assert c.post(base+'/run',json={'revision':1,'card_indices':[1]},headers={'Idempotency-Key':'select-frame'}).json()['id']==j['id']
    assert len(env['state']['received'])==before+1
    doc['cards'][1]['prompt']='FAIL_THIS_FRAME';assert c.put(base,json=doc|{'revision':1}).status_code==200
    failed=call_job(env,c.post(base+'/run',json={'revision':2}).json()['id']);assert failed['status']=='failed'
    doc['cards'][1]['prompt']='fixed';assert c.put(base,json=doc|{'revision':2}).status_code==200
    before=len(env['state']['received']);run=c.post(base+'/run',json={'revision':3,'card_indices':[1,2]});j=call_job(env,run.json()['id'])
    assert len(j['outputs'])==2 and 'generate_1' not in j['steps'] and len(env['state']['received'])==before+2
    assets=c.get('/api/assets').json();assert all(any(a['id']==aid for a in assets) for aid in failed['steps']['generate_1']['output']['asset_ids'])

def test_guided_busy_revision_and_atomic_plan_completion(env):
    c=env['client'];item,doc=creation(env);gate=threading.Event();env['state']['hold']=gate
    r=c.post('/api/creations/'+item['id']+'/plan',json={'revision':1});assert r.status_code==202
    try:
        wait(lambda:c.get('/api/jobs/'+r.json()['id']).json()['status']=='running')
        assert c.put('/api/creations/'+item['id'],json={**doc,'revision':1}).status_code==409
        assert c.post('/api/creations/'+item['id']+'/plan',json={'revision':1}).status_code==409
    finally:env['state']['hold']=None;gate.set()
    assert call_job(env,r.json()['id'])['status']=='completed'
    assert c.put('/api/creations/'+item['id'],json={**doc,'revision':1}).status_code==409

def test_reference_validation_before_task_submission(env):
    c=env['client']
    image=c.post('/api/assets',json={'project_id':env['project']['id'],'name':'对话参考',
        'kind':'image','visibility':'private','mime':'image/png','filename':'ref.png',
        'base64':base64.b64encode(PNG).decode()}).json()
    model=c.post('/api/models',json={'name':'纯文生图','spec':{**env['spec'],'capabilities':['image']}}).json()
    cid=chat(env,'参考能力校验')
    body={'prompt':'测试','config':{'agent':'image','model_id':model['id'],'asset_ids':[image['id']]}}
    before=len(env['state']['received'])
    bad=c.post('/api/chats/'+cid+'/messages',json=body)
    assert bad.status_code==400 and '参考图片编辑' in bad.json()['error']
    assert c.get('/api/chats/'+cid).json()['messages']==[]
    assert len(env['state']['received'])==before
    body['config']['model_id']=env['model']['id']
    job=c.post('/api/chats/'+cid+'/messages',json=body)
    assert job.status_code==202,job.text
    assert call_job(env,job.json()['id'])['status']=='completed'
    assert env['state']['received'][-1]['files']['image']==PNG


def test_project_context_permissions_and_immutable_revisions(env):
    client = env['client']
    project = client.post('/api/projects', json={'name': '设定权限项目', 'visibility': 'private'}).json()
    route = '/api/projects/' + project['id'] + '/context'
    assert client.get(route).json() == []
    assert env['viewer'].get(route).status_code == 403
    payload = {'base_revision': 0, 'description': '第一版', 'style': '水墨', 'asset_ids': []}
    assert env['editor'].post(route, json=payload).status_code == 403
    other_asset = env['asset']['id']
    assert client.post(route, json={**payload, 'asset_ids': [other_asset]}).status_code == 400
    first = client.post(route, json=payload)
    assert first.status_code == 201
    assert first.json()['revision'] == 1
    assert client.post(route, json=payload).status_code == 409
    second = client.post(route, json={**payload, 'base_revision': 1, 'description': '第二版'})
    assert second.status_code == 201
    assert [(v['revision'], v['description']) for v in client.get(route).json()] == [
        (2, '第二版'), (1, '第一版'),
    ]


def test_explicit_project_context_in_chat_canvas_and_batch(env):
    client, received = env['client'], env['state']['received']
    project_id = env['project']['id']
    context_route = '/api/projects/' + project_id + '/context'
    original = '古塔设定第一版'
    payload = {'base_revision': 0, 'description': original, 'style': '冷蓝水墨', 'asset_ids': [env['asset']['id']]}
    first = client.post(context_route, json=payload)
    assert first.status_code == 201
    assert env['viewer'].get(context_route).json()[0]['asset_ids'] == [env['asset']['id']]
    assert env['viewer'].post(context_route, json=payload).status_code == 403
    assert client.post(context_route, json={**payload, 'base_revision': 1, 'description': '新版设定'}).status_code == 201

    message_route = '/api/chats/' + chat(env) + '/messages'
    message = {'prompt': '创作描述', 'config': config(env, 'prompt'), 'context_revision': 1}
    assert client.post(message_route, json={**message, 'context_revision': 100}).status_code == 404
    sent = client.post(message_route, json=message, headers={'Idempotency-Key': 'context-1'})
    assert sent.status_code == 202
    assert call_job(env, sent.json()['id'])['status'] == 'completed'
    assert original in received[-1]['body']['messages'][-1]['content']
    assert '新版设定' not in received[-1]['body']['messages'][-1]['content']
    replay = client.post(message_route, json=message, headers={'Idempotency-Key': 'context-1'})
    assert replay.json()['id'] == sent.json()['id']
    assert client.post(message_route, json={**message, 'context_revision': 2}, headers={'Idempotency-Key': 'context-1'}).status_code == 409

    workflow = env['workflow']
    workflow_route = '/api/workflows/' + workflow['id']
    analyzed = client.post(workflow_route + '/assist', json={
        'mode': 'analyze', 'model_id': env['model']['id'], 'prompt': '检查画布', 'context_revision': 1,
    })
    assert analyzed.status_code == 200
    context = json.loads(received[-1]['body']['messages'][-1]['content'])['project_context']
    assert context == {'revision': 1, 'description': original, 'style': '冷蓝水墨'}
    run = client.post(workflow_route + '/run', json={'revision': workflow['revision'], 'context_revision': 1})
    assert run.status_code == 202
    assert call_job(env, run.json()['id'])['status'] == 'completed'
    assert original in received[-1]['body']['prompt']

    creation = client.post('/api/creations', json={
        'project_id': project_id, 'name': '项目设定批量', 'story': '白鹭穿云', 'context_revision': 1,
        'model_id': env['model']['id'], 'cards': [{'title': '第一幕', 'prompt': '穿过云海'}],
    })
    assert creation.status_code == 201
    batch = client.post('/api/creations/' + creation.json()['id'] + '/run', json={'revision': 1})
    assert batch.status_code == 202
    assert call_job(env, batch.json()['id'])['status'] == 'completed'
    assert original in received[-1]['body']['prompt']


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
