import asyncio,base64,copy,json,re,secrets,threading,time
from contextlib import asynccontextmanager
from typing import Annotated
from types import SimpleNamespace
import psycopg
from psycopg_pool import PoolTimeout
from psycopg.types.json import Jsonb
from fastapi import FastAPI,APIRouter,Depends,Request,Response,Header,Security,HTTPException
from fastapi.security import APIKeyCookie,HTTPBearer,HTTPAuthorizationCredentials
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from .config import Settings
from .db import Database,DB,now
from .security import *
from .schemas import *
from .domain import *
from .storage import Storage,sniff
from .service import Service,asset_view,job_view,template_view
from .worker import Worker
from .provider import Provider

VERSION='0.3.2';cookie_scheme=APIKeyCookie(name='cloudheron',auto_error=False);bearer_scheme=HTTPBearer(auto_error=False)
def seed(d):
    skills=[('skill_visual','画面提示词','image','主体、环境、光线与构图：{{prompt}}'),('skill_motion','视频动作描述','video','明确主体动作与运镜，避免无关切换：{{prompt}}'),('skill_reference','参考资产注入','all','保持参考资产的外观、服装与风格。{{prompt}}'),('skill_structure','提示词结构整理','prompt','将创作要求组织为主体、环境、光线、构图或动作：{{prompt}}'),('skill_concise','提示词精炼','prompt','去除重复描述，只输出提示词：{{prompt}}')]
    for sid,name,task,t in skills: d.run('INSERT INTO skills(id,name,task,template,builtin) VALUES(%s,%s,%s,%s,true) ON CONFLICT(id) DO NOTHING',sid,name,task,t)
    for eid,name,task,ids in [('expert_image','画面创作专家','image',['skill_visual','skill_reference']),('expert_video','动态影像专家','video',['skill_motion','skill_reference']),('expert_prompt','提示词整理专家','prompt',['skill_structure','skill_concise'])]: d.run('INSERT INTO experts(id,name,task,skill_ids,builtin) VALUES(%s,%s,%s,%s,true) ON CONFLICT(id) DO NOTHING',eid,name,task,Jsonb(ids))

def create_app(settings:Settings|None=None):
    settings=settings or Settings()
    @asynccontextmanager
    async def lifespan(app):
        database=Database(settings.database_url);owner=None;ctx=None
        try:
            database.migrate();owner=psycopg.connect(settings.database_url,autocommit=True)
            if not owner.execute('SELECT pg_try_advisory_lock(91401702)').fetchone()[0]: raise RuntimeError('该 PostgreSQL 数据库已有云鹭执行器，请使用单进程启动')
            storage=Storage(settings);storage.check();ctx=SimpleNamespace(settings=settings,database=database,storage=storage,vault=Vault(settings.vault_key_b64),owner=owner,closing=False)
            ctx.worker=Worker(ctx);app.state.ctx=ctx
            with database.connection() as conn: seed(DB(conn))
            ctx.worker.start();yield
        finally:
            if ctx: ctx.closing=True;await asyncio.to_thread(ctx.worker.close)
            if owner: owner.close()
            database.close()
    app=FastAPI(title='云鹭 · CloudHeron API',version=VERSION,description='FastAPI + PostgreSQL + 私有 S3 对象存储。会话 Cookie 或发布 API Bearer 鉴权。写请求需 X-CloudHeron: 1。',lifespan=lifespan,responses={400:{'model':ErrorOut},401:{'model':ErrorOut},403:{'model':ErrorOut},409:{'model':ErrorOut},422:{'model':ErrorOut},429:{'model':ErrorOut},503:{'model':ErrorOut},404:{'model':ErrorOut},413:{'model':ErrorOut},500:{'model':ErrorOut},502:{'model':ErrorOut}})
    if settings.cors_origins: app.add_middleware(CORSMiddleware,allow_origins=settings.cors_origins,allow_credentials=True,allow_methods=['GET','POST','PUT','PATCH','OPTIONS'],allow_headers=['Content-Type','X-CloudHeron','Idempotency-Key','Authorization','Range'],expose_headers=['Idempotency-Replayed','Content-Range'])
    @app.exception_handler(HTTPException)
    async def http_error(request,e): return JSONResponse({'error':str(e.detail)},status_code=e.status_code)
    @app.exception_handler(RequestValidationError)
    async def validation_error(request,e): return JSONResponse({'error':'请求字段校验失败：'+'；'.join('.'.join(str(x) for x in item['loc'])+' '+item['msg'] for item in e.errors())},status_code=422)
    @app.exception_handler(psycopg.IntegrityError)
    async def conflict(request,e): return JSONResponse({'error':'记录已存在或引用关系有误'},status_code=409)
    @app.exception_handler(psycopg.OperationalError)
    @app.exception_handler(PoolTimeout)
    async def database_unavailable(request,e): return JSONResponse({'error':'数据库暂未就绪，请稍后重试'},status_code=503)
    @app.exception_handler(ValueError)
    async def invalid_operation(request,e): return JSONResponse({'error':str(e)[:500]},status_code=400)
    @app.exception_handler(Exception)
    async def internal_error(request,e): return JSONResponse({'error':'内部服务错误，请检查数据库、桶配置或服务日志'},status_code=500)
    @app.middleware('http')
    async def headers(request,call_next):
        if int(request.headers.get('content-length','0'))>32*1024*1024: return JSONResponse({'error':'请求超过 32 MB'},status_code=413)
        response=await call_next(request);response.headers['X-Content-Type-Options']='nosniff';response.headers['X-Frame-Options']='DENY';response.headers['Referrer-Policy']='same-origin'
        response.headers['Cache-Control']='no-store' if request.url.path.startswith('/api/') else 'no-cache'
        if not request.url.path.startswith(('/docs','/redoc','/openapi.json')): response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response
    def get_db(request:Request):
        with request.app.state.ctx.database.connection() as conn: yield DB(conn)
    Db=Annotated[DB,Depends(get_db)]
    def current_user(db:Db,session:Annotated[str|None,Security(cookie_scheme)]=None):
        u=db.one('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.hash=%s AND sessions.expires>%s AND users.active',digest(session or ''),now_ms())
        if not u: fail(401,'请登录团队账号')
        return u
    def get_service(request:Request,db:Db,user:Annotated[dict,Depends(current_user)]): return Service(db,request.app.state.ctx,user)
    Svc=Annotated[Service,Depends(get_service)]
    def protect(request:Request,x_cloudheron:Annotated[str|None,Header(alias='X-CloudHeron')]=None):
        if request.method in ('GET','HEAD','OPTIONS') or request.url.path.startswith('/api/v1/'): return
        if x_cloudheron!='1': fail(403,'缺少请求保护头')
        origin=request.headers.get('origin');allowed={str(request.base_url).rstrip('/'),*settings.cors_origins}
        if origin and origin not in allowed: fail(403,'请求来源不匹配')
    api=APIRouter(prefix='/api',dependencies=[Depends(protect)])
    attempts={};rate_lock=threading.Lock()
    def rate(req):
        ip=req.client.host
        with rate_lock:
            now_time=time.monotonic();entry=attempts.get(ip,(0,now_time+60))
            if entry[1]<now_time: entry=(0,now_time+60)
            attempts[ip]=(entry[0]+1,entry[1])
            if len(attempts)>2000:
                for k,v in list(attempts.items()):
                    if v[1]<now_time: del attempts[k]
            if entry[0]>=15: fail(429,'操作过于频繁，请一分钟后再试')
    def session_out(db,response,u):
        t=token();db.run('DELETE FROM sessions WHERE expires<%s',now_ms());db.insert('sessions',{'hash':digest(t),'user_id':u['id'],'expires':now_ms()+7*86400000})
        response.set_cookie('cloudheron',t,max_age=604800,httponly=True,samesite='strict',secure=settings.cookie_secure);return {'user':clean_user(u)}
    @api.get('/health',response_model=HealthOut,tags=['运行管理'])
    def health(db:Db): db.one('SELECT 1');return {'status':'ok','version':VERSION}
    @api.get('/ready',response_model=HealthOut,tags=['运行管理'])
    def ready(request:Request,db:Db):
        ctx=request.app.state.ctx
        if ctx.closing: fail(503,'服务正在停止')
        try: db.one('SELECT 1');ctx.storage.check()
        except Exception: fail(503,'数据库或对象存储尚未就绪')
        return {'status':'ready','version':VERSION}
    @api.get('/bootstrap',response_model=BootstrapOut,tags=['账号'])
    def bootstrap(db:Db): return {'setup_required':not db.one('SELECT id FROM users LIMIT 1'),'team':(db.one("SELECT value FROM meta WHERE key='team'") or {}).get('value','云鹭团队'),'node_types':NODES}
    @api.post('/setup',response_model=SessionOut,status_code=201,tags=['账号'])
    def setup(b:Setup,request:Request,response:Response,db:Db):
        rate(request);email=text(b.email,'邮箱').lower()
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email): fail(400,'邮箱格式有误')
        with db.tx():
            db.run('SELECT pg_advisory_xact_lock(91401703)')
            if db.one('SELECT id FROM users LIMIT 1'): fail(409,'团队已初始化')
            uid_value=uid('usr');db.insert('users',{'id':uid_value,'name':text(b.name,'姓名'),'email':email,'password':password(b.password),'role':'admin'});db.insert('meta',{'key':'team','value':Jsonb(text(b.team,'团队名称'))})
        return session_out(db,response,db.one('SELECT * FROM users WHERE id=%s',uid_value))
    @api.post('/login',response_model=SessionOut,tags=['账号'])
    def login(b:Login,request:Request,response:Response,db:Db):
        rate(request);u=db.one('SELECT * FROM users WHERE email=%s AND active',b.email.lower().strip())
        if not verify(b.password,u['password'] if u else '0'*32+':'+'0'*128) or not u: fail(401,'邮箱或密码有误，或账号已停用')
        return session_out(db,response,u)
    @api.post('/join',response_model=SessionOut,tags=['账号'])
    def join(b:Join,request:Request,response:Response,db:Db):
        rate(request);key='invite:'+digest(b.token);encoded=password(b.password)
        with db.tx():
            inv=db.one('SELECT * FROM meta WHERE key=%s FOR UPDATE',key)
            if not inv or inv['value']['expires']<now_ms(): fail(400,'邀请链接无效或已过期')
            u=db.one('UPDATE users SET password=%s,active=true WHERE id=%s RETURNING *',encoded,inv['value']['user_id']);db.run('DELETE FROM meta WHERE key=%s',key)
        return session_out(db,response,u)
    @api.get('/me',response_model=MeOut,tags=['账号'])
    def me(s:Svc): return {'user':clean_user(s.user),'team':s.db.one("SELECT value FROM meta WHERE key='team'")['value']}
    @api.post('/logout',response_model=Ok,tags=['账号'])
    def logout(request:Request,response:Response,s:Svc): s.db.run('DELETE FROM sessions WHERE hash=%s',digest(request.cookies.get('cloudheron','')));response.delete_cookie('cloudheron');return {'ok':True}
    @api.post('/password',response_model=SessionOut,tags=['账号'])
    def change_password(b:ChangePassword,response:Response,s:Svc):
        if not verify(b.current,s.user['password']): fail(400,'当前密码有误')
        with s.db.tx(): s.db.run('UPDATE users SET password=%s WHERE id=%s',password(b.password),s.user['id']);s.db.run('DELETE FROM sessions WHERE user_id=%s',s.user['id'])
        return session_out(s.db,response,s.user)
    @api.get('/users',response_model=list[UserOut],tags=['成员'])
    def users(s:Svc): return [clean_user(u) for u in s.db.all('SELECT * FROM users ORDER BY created_at')]
    @api.post('/users',response_model=InvitationOut,status_code=201,tags=['成员'])
    def invite(b:Invite,s:Svc):
        s.admin();email=text(b.email,'邮箱').lower()
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email): fail(400,'邮箱格式有误')
        tid=token();user_id=uid('usr')
        with s.db.tx():
            s.db.insert('users',{'id':user_id,'name':text(b.name,'姓名'),'email':email,'password':password(token()),'role':b.role,'active':False});s.db.insert('meta',{'key':'invite:'+digest(tid),'value':{'user_id':user_id,'expires':now_ms()+7*86400000}})
        return {'user':clean_user(s.db.one('SELECT * FROM users WHERE id=%s',user_id)),'invite_path':'/#join/'+tid}
    @api.patch('/users/{user_id}',response_model=UserOut,tags=['成员'])
    def update_user(user_id:str,b:UpdateUser,s:Svc):
        s.admin()
        with s.db.tx():
            s.db.run('SELECT pg_advisory_xact_lock(91401704)');u=s.db.one('SELECT * FROM users WHERE id=%s',user_id)
            if not u: fail(404,'成员不存在')
            if u['role']=='admin' and u['active'] and (b.role!='admin' or not b.active) and s.db.one("SELECT count(*) n FROM users WHERE role='admin' AND active")['n']<=1: fail(400,'请至少保留一位有效管理员')
            s.db.run('UPDATE users SET name=%s,role=%s,active=%s WHERE id=%s',text(b.name,'姓名'),b.role,b.active,user_id)
            if b.password: s.db.run('UPDATE users SET password=%s WHERE id=%s',password(b.password),user_id)
            if b.password or not b.active: s.db.run('DELETE FROM sessions WHERE user_id=%s',user_id)
        return clean_user(s.db.one('SELECT * FROM users WHERE id=%s',user_id))
    @api.get('/projects',response_model=list[ProjectOut],tags=['项目'])
    def projects(s:Svc): return [{**p,'can_edit':permission(s.user,p,True)} for p in s.db.all('SELECT * FROM projects ORDER BY created_at DESC') if permission(s.user,p)]
    @api.post('/projects',response_model=ProjectOut,status_code=201,tags=['项目'])
    def create_project(b:ProjectCreate,s:Svc):
        s.editor();pid=uid('project');s.db.insert('projects',{'id':pid,'name':text(b.name,'项目名称'),'owner_id':s.user['id'],'visibility':b.visibility});return s.db.one('SELECT * FROM projects WHERE id=%s',pid)
    @api.patch('/projects/{project_id}',response_model=Ok,tags=['项目'])
    def update_project(project_id:str,b:ProjectUpdate,s:Svc):
        p=s.project(project_id,True)
        if s.user['role']!='admin' and p['owner_id']!=s.user['id']: fail(403,'仅管理员或创建者可管理共享')
        for uid_value in b.acl:
            if not s.db.one('SELECT id FROM users WHERE id=%s',uid_value): fail(400,'授权成员不存在')
        s.db.run('UPDATE projects SET name=%s,visibility=%s,acl=%s WHERE id=%s',text(b.name,'项目名称'),b.visibility,Jsonb(b.acl),project_id);return {'ok':True}
    @api.get('/projects/{project_id}/contents',response_model=list[dict],tags=['项目'])
    def contents(project_id:str,s:Svc):
        s.project(project_id);out=[]
        for table,source in [('chats','chat'),('workflows','workflow'),('creations','creation')]:
            for r in s.db.all('SELECT * FROM '+table+' WHERE project_id=%s ORDER BY updated_at DESC',project_id):
                j=s.db.one("SELECT * FROM jobs WHERE source_id=%s AND (%s!='creation' OR source='creation') ORDER BY created_at DESC LIMIT 1",r['id'],source);out.append({'id':r['id'],'project_id':project_id,'source':source,'title':r.get('name',r.get('title')),'status':j['status'] if j else 'draft','outputs':j['outputs'] if j else []})
        return out
    @api.get('/projects/{project_id}/test-cases',response_model=list[dict],tags=['测试'])
    def cases(project_id:str,s:Svc): s.project(project_id);return [r['definition'] for r in s.db.all('SELECT definition FROM project_test_cases WHERE project_id=%s ORDER BY test_id',project_id)]
    from .models.routes import register as register_models
    register_models(api,Svc,settings)
    from .creations.routes import register as register_creations
    register_creations(api,Svc)
    @api.get('/task-options',response_model=dict,tags=['能力'])
    def task_options(s:Svc): return OPTIONS
    @api.get('/agents',response_model=list[AgentOut],tags=['能力'])
    def agents(s:Svc): return AGENTS
    @api.get('/skills',response_model=list[SkillOut],tags=['能力'])
    def skills(s:Svc): return s.db.all('SELECT * FROM skills ORDER BY builtin DESC,name')
    def write_skill(s,b,sid=None):
        s.admin();text(b.template,'Skill 模板',5000)
        if '{{prompt}}' not in b.template: fail(400,'Skill 须包含 {{prompt}}')
        if sid:
            if not s.db.one('SELECT id FROM skills WHERE id=%s',sid): fail(404,'Skill 不存在')
            s.db.run('UPDATE skills SET name=%s,task=%s,template=%s WHERE id=%s',text(b.name,'Skill 名称'),b.task,b.template,sid)
        else: sid=uid('skill');s.db.insert('skills',{'id':sid,'name':text(b.name,'Skill 名称'),'task':b.task,'template':b.template})
        return s.db.one('SELECT * FROM skills WHERE id=%s',sid)
    @api.post('/skills',response_model=SkillOut,status_code=201,tags=['能力'])
    def add_skill(b:SkillWrite,s:Svc): return write_skill(s,b)
    @api.put('/skills/{skill_id}',response_model=SkillOut,tags=['能力'])
    def update_skill(skill_id:str,b:SkillWrite,s:Svc): return write_skill(s,b,skill_id)
    @api.get('/experts',response_model=list[ExpertOut],tags=['能力'])
    def experts(s:Svc): return s.db.all('SELECT * FROM experts ORDER BY builtin DESC,name')
    def write_expert(s,b,eid=None):
        s.admin()
        if len(set(b.skill_ids))!=len(b.skill_ids): fail(400,'专家须组合不同 Skill')
        s.skills('',b.skill_ids)
        if eid:
            if not s.db.one('SELECT id FROM experts WHERE id=%s',eid): fail(404,'专家不存在')
            s.db.run('UPDATE experts SET name=%s,task=%s,skill_ids=%s WHERE id=%s',text(b.name,'专家名称'),b.task,Jsonb(b.skill_ids),eid)
        else: eid=uid('expert');s.db.insert('experts',{'id':eid,'name':text(b.name,'专家名称'),'task':b.task,'skill_ids':b.skill_ids})
        return s.db.one('SELECT * FROM experts WHERE id=%s',eid)
    @api.post('/experts',response_model=ExpertOut,status_code=201,tags=['能力'])
    def add_expert(b:ExpertWrite,s:Svc): return write_expert(s,b)
    @api.put('/experts/{expert_id}',response_model=ExpertOut,tags=['能力'])
    def update_expert(expert_id:str,b:ExpertWrite,s:Svc): return write_expert(s,b,expert_id)
    # Workflow, media and public endpoints are registered separately, preserving explicit OpenAPI paths.
    from .routes import register
    register(api,Svc,Db,settings,requestRecord=None)
    app.include_router(api)
    app.mount('/',StaticFiles(directory=settings.frontend_dir,html=True),name='frontend')
    return app
