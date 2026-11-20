import base64,copy,json,re,time
from typing import Annotated
from psycopg.types.json import Jsonb
from fastapi import Request,Response,Header,Depends,Security
from fastapi.security import HTTPBearer,HTTPAuthorizationCredentials
from .schemas import *
from .workflow_ai import CONTRACT as AI_CONTRACT,proposal as ai_proposal
from .security import fail,uid,text,permission,token,digest,now_ms
from .domain import TEMPLATES,AGENTS,NODES,workflow,copy_template,options
from .service import Service,asset_view,job_view,template_view
from .storage import sniff
from .provider import Provider
from .project_context import load_context

def register(api,Svc,Db,settings,**kwargs):
    IdKey=Annotated[str|None,Header(alias='Idempotency-Key')]
    @api.get('/workflow-templates',response_model=list[TemplateOut],response_model_exclude_none=True,tags=['工作流模板'])
    def templates(s:Svc):
        rows=[t for t in s.db.all('SELECT * FROM workflow_templates ORDER BY updated_at DESC') if permission(s.user,s.db.one('SELECT * FROM projects WHERE id=%s',t['project_id']))]
        return [template_view(t) for t in TEMPLATES+rows]
    @api.post('/workflow-templates',response_model=TemplateOut,status_code=201,tags=['工作流模板'])
    def save_template(b:TemplateSave,s:Svc):
        s.editor();w=s.resource('workflows',b.workflow_id,True)
        if w['revision']!=b.revision: fail(409,'工作流已更新，请刷新后保存模板')
        if len(b.description)>2000: fail(400,'模板描述最多 2000 字')
        tid=uid('tpl');s.db.insert('workflow_templates',{'id':tid,'project_id':w['project_id'],'owner_id':s.user['id'],'name':text(b.name,'模板名称'),'description':b.description,'document':w['document'],'source_workflow_id':w['id'],'source_revision':w['revision']})
        return template_view(s.template(tid),True)
    @api.get('/workflow-templates/{template_id}',response_model=TemplateOut,tags=['工作流模板'])
    def template_detail(template_id:str,s:Svc): return template_view(s.template(template_id),True)
    @api.post('/workflow-templates/{template_id}/instantiate',response_model=WorkflowOut,response_model_exclude_unset=True,status_code=201,tags=['工作流模板'])
    def instantiate(template_id:str,b:TemplateInstantiate,s:Svc):
        s.editor();t=s.template(template_id)
        if t['revision']!=b.revision: fail(409,'模板版本已变化')
        return s.create_workflow(b.project_id,b.name,copy_template(t['document'],b.name,b.keep_bindings),'template')
    @api.post('/workflows/validate',response_model=Ok,tags=['工作流'])
    def validate(b:WorkflowValidate,s:Svc): s.project(b.project_id,True);s.wf_resources(b.document);return {'ok':True}
    @api.get('/workflows',response_model=list[WorkflowOut],response_model_exclude_none=True,tags=['工作流'])
    def workflows(s:Svc): return [w for w in s.db.all('SELECT * FROM workflows ORDER BY updated_at DESC') if permission(s.user,s.db.one('SELECT * FROM projects WHERE id=%s',w['project_id']))]
    @api.post('/workflows',response_model=WorkflowOut,response_model_exclude_unset=True,status_code=201,tags=['工作流'])
    def new_workflow(b:WorkflowCreate,s:Svc): s.editor();return s.create_workflow(b.project_id,b.name,b.document or copy.deepcopy(TEMPLATES[0]['document']))
    @api.get('/workflows/{workflow_id}',response_model=WorkflowOut,response_model_exclude_unset=True,tags=['工作流'])
    def workflow_detail(workflow_id:str,s:Svc):
        w=s.resource('workflows',workflow_id);return {**w,'can_edit':permission(s.user,s.project(w['project_id']),True),'job':job_view(s.db.one('SELECT * FROM jobs WHERE source_id=%s ORDER BY created_at DESC LIMIT 1',workflow_id))}
    @api.put('/workflows/{workflow_id}',response_model=WorkflowOut,response_model_exclude_unset=True,tags=['工作流'])
    def save_workflow(workflow_id:str,b:WorkflowSave,s:Svc): return s.save_workflow(s.resource('workflows',workflow_id,True),b.revision,b.document)
    @api.get('/workflows/{workflow_id}/versions',response_model=list[dict],tags=['工作流版本'])
    def versions(workflow_id:str,s:Svc): s.resource('workflows',workflow_id);return s.db.all('SELECT v.revision,v.actor_id,v.action,v.source_revision,v.saved_at,u.name AS actor_name FROM workflow_versions v LEFT JOIN users u ON u.id=v.actor_id WHERE v.workflow_id=%s ORDER BY revision DESC',workflow_id)
    @api.get('/workflows/{workflow_id}/versions/{revision}',response_model=dict,tags=['工作流版本'])
    def version_detail(workflow_id:str,revision:int,s:Svc):
        s.resource('workflows',workflow_id);v=s.db.one('SELECT * FROM workflow_versions WHERE workflow_id=%s AND revision=%s',workflow_id,revision)
        if not v: fail(404,'历史版本不存在')
        return v
    @api.post('/workflows/{workflow_id}/restore',response_model=WorkflowOut,response_model_exclude_unset=True,tags=['工作流版本'])
    def restore(workflow_id:str,b:Restore,s:Svc):
        w=s.resource('workflows',workflow_id,True);v=s.db.one('SELECT * FROM workflow_versions WHERE workflow_id=%s AND revision=%s',workflow_id,b.source_revision)
        if not v: fail(404,'历史版本不存在')
        return s.save_workflow(w,b.revision,v['document'],'restore',b.source_revision)
    @api.post('/workflows/{workflow_id}/run',response_model=JobOut,status_code=202,tags=['任务'])
    def run(workflow_id:str,b:WorkflowRun,response:Response,s:Svc,idempotency_key:IdKey=None):
        w=s.resource('workflows',workflow_id,True)
        def build():
            if w['revision']!=b.revision: fail(409,'请保存或刷新工作流再运行')
            workflow(w['document'])
            context=load_context(s,w['project_id'],b.context_revision)
            return s.enqueue(w['project_id'],'workflow',w['id'],{'document':w['document'],'input':{},'project_context':context})
        j,replayed=s.submit('workflow:'+w['id'],idempotency_key,b.model_dump(exclude_none=True),build)
        if replayed: response.headers['Idempotency-Replayed']='true'
        return j
    @api.post('/workflows/{workflow_id}/assist',response_model=AnalysisOut|ProposalOut,tags=['工作流 AI'])
    def assist(workflow_id:str,b:Assist,s:Svc):
        w=s.resource('workflows',workflow_id,True);params=options('text',b.params)
        instruction='仅分析工作流，解释问题和建议。禁止执行任务。' if b.mode=='analyze' else AI_CONTRACT+'允许的节点类型：'+','.join(NODES)
        context=load_context(s,w['project_id'],b.context_revision)
        payload={'workflow':w['document'],'request':b.prompt}
        if context:
            payload['project_context']={k:context[k] for k in ('revision','description','style')}
        api_model=s.model(b.model_id);result=Provider(settings,s.context.vault,s.context.storage,None).chat(api_model,[{'role':'system','content':instruction},{'role':'user','content':json.dumps(payload,ensure_ascii=False)}],params)
        if b.mode=='analyze': return {'analysis':result}
        document,explanation=ai_proposal(result,w['document']);s.wf_resources(document);pid=uid('proposal')
        s.db.insert('proposals',{'id':pid,'workflow_id':w['id'],'user_id':s.user['id'],'base_revision':w['revision'],'document':document,'explanation':explanation,'expires':now_ms()+3600000})
        return {'id':pid,'base_revision':w['revision'],'explanation':explanation,'before':w['document'],'after':document}
    @api.post('/proposals/{proposal_id}/confirm',response_model=WorkflowOut,response_model_exclude_unset=True,tags=['工作流 AI'])
    def confirm(proposal_id:str,s:Svc):
        with s.db.tx():
            p=s.db.one('SELECT * FROM proposals WHERE id=%s AND user_id=%s FOR UPDATE',proposal_id,s.user['id'])
            if not p or p['status']!='pending' or p['expires']<now_ms(): fail(409,'提案已失效，请重新请求修改')
            w=s.resource('workflows',p['workflow_id'],True);saved=s.save_workflow(w,p['base_revision'],p['document'],'ai_modify');s.db.run("UPDATE proposals SET status='confirmed' WHERE id=%s",proposal_id)
        return saved
    @api.get('/chats',response_model=list[ChatOut],response_model_exclude_none=True,tags=['对话'])
    def chats(s:Svc): return [{k:v for k,v in c.items() if k!='messages'} for c in s.db.all('SELECT * FROM chats ORDER BY updated_at DESC') if permission(s.user,s.db.one('SELECT * FROM projects WHERE id=%s',c['project_id']))]
    @api.post('/chats',response_model=ChatOut,response_model_exclude_unset=True,status_code=201,tags=['对话'])
    def new_chat(b:ChatCreate,s:Svc): s.project(b.project_id,True);cid=uid('chat');s.db.insert('chats',{'id':cid,'project_id':b.project_id,'title':text(b.title,'对话名称')});return s.db.one('SELECT * FROM chats WHERE id=%s',cid)
    @api.get('/chats/{chat_id}',response_model=ChatOut,response_model_exclude_unset=True,tags=['对话'])
    def chat_detail(chat_id:str,s:Svc):
        c=s.resource('chats',chat_id);return {**c,'can_edit':permission(s.user,s.project(c['project_id']),True),'job':job_view(s.db.one('SELECT * FROM jobs WHERE source_id=%s ORDER BY created_at DESC LIMIT 1',chat_id))}
    @api.post('/chats/{chat_id}/messages',response_model=JobOut,status_code=202,tags=['对话'])
    def send_message(chat_id:str,b:ChatMessage,response:Response,s:Svc,idempotency_key:IdKey=None):
        c=s.resource('chats',chat_id,True)
        def build():
            current=s.db.one('SELECT * FROM chats WHERE id=%s FOR UPDATE',chat_id)
            if s.db.one("SELECT id FROM jobs WHERE source_id=%s AND status IN ('queued','running')",chat_id): fail(409,'当前对话正在生成')
            cfg=s.chat_config(b.config);prompt=text(b.prompt,'创作描述',32000)
            from .documents import attach_document
            attach_document(s,c,cfg,b.config.get('document_id'))
            context=load_context(s,c['project_id'],b.context_revision)
            if context:
                cfg['context_revision']=context['revision']
            messages=current['messages']+[{'id':uid('msg'),'role':'user','text':prompt,'config':cfg,'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}]
            j=s.enqueue(c['project_id'],'chat',c['id'],{'prompt':prompt,'config':cfg,'messages':messages,'project_context':context})
            s.db.run('UPDATE chats SET messages=%s,updated_at=now() WHERE id=%s',Jsonb(messages),chat_id)
            return j
        j,replayed=s.submit('chat:'+chat_id,idempotency_key,b.model_dump(exclude_none=True),build)
        if replayed: response.headers['Idempotency-Replayed']='true'
        return j
    @api.get('/assets',response_model=list[AssetOut],tags=['资产'])
    def assets(s:Svc):
        return [asset_view(a) for a in s.db.all('SELECT * FROM assets ORDER BY created_at DESC') if permission(s.user,s.db.one('SELECT * FROM projects WHERE id=%s',a['project_id'])) if a['project_id']] + [asset_view(a) for a in s.db.all('SELECT * FROM assets WHERE project_id IS NULL ORDER BY created_at DESC') if permission(s.user,a)]
    @api.post('/assets',response_model=AssetOut,status_code=201,tags=['资产'])
    def upload(b:AssetCreate,s:Svc):
        s.editor()
        if b.project_id: s.project(b.project_id,True)
        try: data=base64.b64decode(b.base64,validate=True)
        except ValueError: fail(400,'上传 base64 有误')
        if len(data)>20*1024*1024: fail(413,'上传文件上限 20 MB')
        sniff(data,b.mime);record={'project_id':b.project_id,'owner_id':s.user['id'],'name':text(b.name,'资产名称'),'kind':b.kind,'visibility':b.visibility,'metadata':{'filename':text(b.filename,'文件名'),'description':b.description[:4000]}}
        if b.parent_id:
            parent=s.asset(b.parent_id)
            if parent['project_id']: s.project(parent['project_id'],True)
            if parent['owner_id']!=s.user['id'] and s.user['role']!='admin': fail(403,'仅创建者或管理员可上传新版本')
            with s.db.tx():
                family=parent['metadata'].get('family_id',parent['id']);s.db.run('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',family)
                version=s.db.one("SELECT COALESCE(MAX(version),0) n FROM assets WHERE id=%s OR metadata->>'family_id'=%s",family,family)['n']+1
                record.update(project_id=parent['project_id'],version=version);record['metadata'].update(family_id=family,parent_id=parent['id']);return asset_view(s.save_asset(data,b.kind,record=record))
        return asset_view(s.save_asset(data,b.kind,record=record))
    @api.patch('/assets/{asset_id}',response_model=Ok,tags=['资产'])
    def edit_asset(asset_id:str,b:AssetUpdate,s:Svc):
        s.editor();a=s.asset(asset_id)
        if a['project_id']: s.project(a['project_id'],True)
        elif s.user['role']!='admin' and a['owner_id']!=s.user['id']: fail(403,'仅创建者或管理员可修改独立资产')
        metadata={**a['metadata'],'description':b.description[:4000]};s.db.run('UPDATE assets SET name=%s,visibility=%s,metadata=%s WHERE id=%s',text(b.name,'资产名称'),b.visibility,Jsonb(metadata),asset_id);return {'ok':True}
    @api.get('/assets/{asset_id}/media',response_class=Response,tags=['资产'],responses={200:{'content':{'image/png':{},'video/mp4':{}}},206:{'description':'Range 部分文件'},416:{'description':'Range 有误'}})
    def media(asset_id:str,request:Request,s:Svc):
        a=s.asset(asset_id);return s.context.storage.response(a['file'],a['mime'],request.headers.get('range'))
    @api.post('/assets/{asset_id}/download-url',response_model=DownloadOut,tags=['资产'])
    def signed_url(asset_id:str,s:Svc): a=s.asset(asset_id);return {'url':s.context.storage.url(a['file']),'expires_in':300}
    @api.get('/jobs/{job_id}',response_model=JobOut,tags=['任务'])
    def job(job_id:str,s:Svc): return job_view(s.resource('jobs',job_id))
    @api.get('/system/status',response_model=RuntimeOut,tags=['运行管理'])
    def system_status(s:Svc):
        s.admin();return {'version':kwargs.get('version','0.2.2'),'state':'draining' if s.context.closing else 'ready','workers':s.context.worker.state(),'max_pending_per_user':settings.max_pending_per_user,'queued':s.db.one("SELECT count(*) n FROM jobs WHERE status='queued'")['n'],'running':s.db.one("SELECT count(*) n FROM jobs WHERE status='running'")['n']}
    @api.get('/publications',response_model=list[PublicationOut],tags=['发布 API'])
    def publications(s:Svc): return [{k:v for k,v in p.items() if k not in ('key_hash','document')} for p in s.db.all('SELECT * FROM publications ORDER BY created_at DESC') if permission(s.user,s.db.one('SELECT * FROM projects WHERE id=%s',p['project_id']))]
    @api.post('/publications',response_model=PublicationCreated,status_code=201,tags=['发布 API'])
    def publish(b:PublicationCreate,s:Svc):
        s.editor();w=s.resource('workflows',b.workflow_id,True);s.wf_resources(w['document']);pid=uid('endpoint');t=token()
        s.db.insert('publications',{'id':pid,'project_id':w['project_id'],'workflow_id':w['id'],'owner_id':s.user['id'],'name':text(b.name,'API 名称'),'version':text(b.version,'版本',60),'document':w['document'],'key_hash':digest(t)})
        return {'id':pid,'token':t,'path':'/api/v1/endpoints/'+pid+'/runs','version':b.version}
    @api.patch('/publications/{publication_id}',response_model=Ok,tags=['发布 API'])
    def revoke(publication_id:str,s:Svc):
        p=s.resource('publications',publication_id,True)
        if p['owner_id']!=s.user['id'] and s.user['role']!='admin': fail(403,'仅发布者或管理员可撤销')
        s.db.run('UPDATE publications SET enabled=false WHERE id=%s',publication_id);return {'ok':True}
    bearer=HTTPBearer(auto_error=False)
    def publication(request:Request,db:Db,authorization:Annotated[HTTPAuthorizationCredentials|None,Security(bearer)]=None):
        if not authorization: fail(401,'请提供 API 调用凭据')
        p=db.one('SELECT * FROM publications WHERE key_hash=%s AND enabled',digest(authorization.credentials))
        if not p: fail(401,'API 凭据无效或已撤销')
        u=db.one('SELECT * FROM users WHERE id=%s AND active',p['owner_id'])
        if not u: fail(403,'发布者账号已停用')
        s=Service(db,request.app.state.ctx,u);s.project(p['project_id'],True);return p,s
    Pub=Annotated[tuple,Depends(publication)]
    @api.post('/v1/endpoints/{endpoint_id}/runs',response_model=JobOut,status_code=202,tags=['第三方 API'])
    def api_run(endpoint_id:str,b:ApiRun,response:Response,pub:Pub,idempotency_key:IdKey=None):
        p,s=pub
        if endpoint_id!=p['id']: fail(403,'凭据与接口不匹配')
        def build(): s.wf_resources(p['document']);return s.enqueue(p['project_id'],'workflow',p['workflow_id'],{'document':p['document'],'input':{'prompt':text(b.prompt,'提示词',32000)}},p['id'])
        j,replayed=s.submit('endpoint:'+p['id'],idempotency_key,b.model_dump(),build)
        if replayed: response.headers['Idempotency-Replayed']='true'
        return j
    def public_job(pub,jid):
        p,s=pub;j=s.db.one('SELECT * FROM jobs WHERE id=%s AND publication_id=%s',jid,p['id'])
        if not j: fail(404,'任务不存在')
        return j,s
    @api.get('/v1/runs/{job_id}',response_model=ApiJobOut,tags=['第三方 API'])
    def api_job(job_id:str,pub:Pub):
        j,s=public_job(pub,job_id);return {**job_view(j),'outputs':[{'asset_id':a,'url':'/api/v1/runs/'+job_id+'/assets/'+a} for a in j['outputs']]}
    @api.get('/v1/runs/{job_id}/assets/{asset_id}',response_class=Response,tags=['第三方 API'])
    def api_media(job_id:str,asset_id:str,request:Request,pub:Pub):
        j,s=public_job(pub,job_id)
        if asset_id not in j['outputs']: fail(404,'产物不存在')
        a=s.asset(asset_id);return s.context.storage.response(a['file'],a['mime'],request.headers.get('range'))
    @api.get('/test-workspace',response_model=dict|None,tags=['测试'])
    def test_workspace(s:Svc): return (s.db.one('SELECT value FROM meta WHERE key=%s','manual_workspace_'+s.user['id']) or {}).get('value')
    @api.post('/test-workspace',response_model=dict,tags=['测试'])
    def seed_workspace(s:Svc):
        s.editor();from .fixtures import manual_workspace
        return manual_workspace(s)
