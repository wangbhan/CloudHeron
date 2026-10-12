import base64,copy,json,re
from psycopg.types.json import Jsonb
from .db import now
from .security import fail,uid,permission,text,digest,now_ms
from .domain import workflow,options,AGENTS,TEMPLATES
from .storage import sniff

def job_view(j): return {k:v for k,v in j.items() if k!='snapshot'} if j else None
def asset_view(a): return {**{k:v for k,v in a.items() if k!='file'},'url':'/api/assets/'+a['id']+'/media'}
def template_view(t,detail=False):
    d=t['document'];return {**t,'builtin':t.get('builtin',False),'document':d if detail else None,'node_count':len(d['nodes']),'edge_count':len(d['edges'])}
class Service:
    def __init__(self,db,context,user): self.db=db;self.context=context;self.user=user
    def editor(self):
        if self.user['role']=='viewer': fail(403,'查看者仅可查看，操作需要编辑者或管理员权限')
    def admin(self):
        if self.user['role']!='admin': fail(403,'此操作需要管理员权限')
    def project(self,pid,edit=False):
        p=self.db.one('SELECT * FROM projects WHERE id=%s',pid)
        if not p: fail(404,'项目不存在')
        if not permission(self.user,p,edit): fail(403,'当前账号缺少项目权限')
        return p
    def resource(self,table,rid,edit=False):
        if table not in ('workflows','chats','workflow_templates','publications','jobs'): raise ValueError('未知资源')
        r=self.db.one('SELECT * FROM '+table+' WHERE id=%s',rid)
        if not r: fail(404,'内容不存在')
        self.project(r['project_id'],edit);return r
    def asset(self,aid):
        a=self.db.one('SELECT * FROM assets WHERE id=%s',aid)
        if not a: fail(404,'参考资产不存在')
        if a['project_id']: self.project(a['project_id'])
        elif not permission(self.user,a): fail(403,'当前账号缺少资产权限')
        return a
    def model(self,mid):
        m=self.db.one('SELECT * FROM models WHERE id=%s AND enabled',mid or '')
        if not m: fail(400,'请先配置并启用对应模型')
        return m
    def wf_resources(self,doc):
        workflow(doc)
        for n in doc['nodes']:
            p=n['params']
            if n['type']=='reference_asset' and p.get('asset_id'): self.asset(p['asset_id'])
            if p.get('model_id'):
                m=self.model(p['model_id']);kind={'prompt_agent':'text','image_generate':'image','video_generate':'video'}.get(n['type'])
                if kind: options(kind,p,m['spec'].get('reference_fields',{}).values())
    def version(self,w,action,source=None):
        self.db.insert('workflow_versions',{'workflow_id':w['id'],'revision':w['revision'],'document':w['document'],'actor_id':self.user['id'],'action':action,'source_revision':source,'saved_at':w['updated_at']})
    def create_workflow(self,pid,name,doc,action='create'):
        self.project(pid,True);self.wf_resources(doc)
        with self.db.tx():
            wid=uid('wf');doc=copy.deepcopy(doc);doc['name']=text(name,'工作流名称')
            self.db.insert('workflows',{'id':wid,'project_id':pid,'name':name,'document':doc});w=self.db.one('SELECT * FROM workflows WHERE id=%s',wid);self.version(w,action)
        return w
    def save_workflow(self,w,revision,doc,action='save',source=None):
        self.wf_resources(doc);name=text(doc.get('name',w['name']),'工作流名称')
        with self.db.tx():
            saved=self.db.one('UPDATE workflows SET name=%s,document=%s,revision=revision+1,updated_at=now() WHERE id=%s AND revision=%s RETURNING *',name,Jsonb(doc),w['id'],revision)
            if not saved: fail(409,'工作流已被他人修改，请刷新后重试')
            self.version(saved,action,source)
        return saved
    def model_view(self,m):
        spec=m['spec'] if self.user['role']=='admin' else {k:m['spec'].get(k) for k in ('source','protocol','capabilities','model')}
        return {'id':m['id'],'name':m['name'],'enabled':m['enabled'],'has_key':bool(m['secret']),'spec':spec}
    def template(self,tid): return next((t for t in TEMPLATES if t['id']==tid),None) or self.resource('workflow_templates',tid)
    def skills(self,prompt,ids):
        if not isinstance(ids,list) or len(ids)>20: fail(400,'Skill 列表有误')
        for sid in dict.fromkeys(ids):
            s=self.db.one('SELECT * FROM skills WHERE id=%s',sid)
            if not s: fail(400,'Skill 不存在')
            prompt=s['template'].replace('{{prompt}}',prompt)
        return prompt
    def chat_config(self,raw):
        a=next((a for a in AGENTS if a['id']==raw.get('agent')),None)
        if not a: fail(400,'请选择有效 Agent')
        kind=raw.get('kind','image') if a['id']=='prompt' else a['id'];m=self.model(raw.get('model_id'))
        if kind not in ('image','video') or a['model_capability'] not in m['spec']['capabilities']: fail(400,'所选模型不支持该 Agent')
        cfg={'agent':a['id'],'kind':kind,'model_id':m['id'],'asset_ids':[],'skill_ids':[]}
        if a['id']!='prompt':
            refs=raw.get('asset_ids',[])
            if not isinstance(refs,list) or len(refs)>8 or any(not isinstance(x,str) for x in refs): fail(400,'参考资产列表有误')
            for aid in refs: self.asset(aid)
            cfg.update(asset_ids=refs,text_model_id=raw.get('text_model_id',''),size=raw.get('size',a['defaults']['size']))
            if not isinstance(cfg['size'],str) or len(cfg['size'])>80: fail(400,'分辨率有误')
            if cfg['text_model_id']:
                if 'text' not in self.model(cfg['text_model_id'])['spec']['capabilities']: fail(400,'理解对话需要文本模型')
                cfg['text_options']=options('text',raw.get('text_options',{}))
            if raw.get('seed','')!='':
                if type(raw['seed'])!=int or abs(raw['seed'])>2**53-1: fail(400,'随机种子须为有效整数')
                cfg['seed']=raw['seed']
            if a['id']=='video':
                cfg['seconds']=raw.get('seconds',4)
                if type(cfg['seconds']) not in (int,float) or not 1<=cfg['seconds']<=120: fail(400,'视频时长须为 1–120 秒')
        ids=raw.get('skill_ids',[])
        if not isinstance(ids,list) or len(ids)>20 or any(not isinstance(x,str) for x in ids): fail(400,'Skill 列表有误')
        expert_ids=[]
        if raw.get('expert_id'):
            e=self.db.one('SELECT * FROM experts WHERE id=%s',raw['expert_id'])
            if not e or e['task'] not in ('all',a['id']): fail(400,'专家不存在或不适用')
            cfg.update(expert_id=e['id'],expert_snapshot={'name':e['name'],'skill_ids':e['skill_ids']});expert_ids=e['skill_ids']
        cfg['additional_skill_ids']=list(dict.fromkeys(ids));cfg['skill_ids']=list(dict.fromkeys(expert_ids+ids))
        self.skills('',cfg['skill_ids']);cfg.update(options(a['model_capability'],raw,m['spec'].get('reference_fields',{}).values()));return cfg
    def submit(self,scope,key,body,build):
        key_hash=None
        if key is not None:
            if not re.fullmatch(r'[-a-zA-Z0-9._:]{1,128}',key): fail(400,'Idempotency-Key 格式有误')
            key_hash=digest(key)
        request_hash=digest(json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False))
        with self.db.tx():
            # Serialize submissions per user; protects pending caps across concurrent HTTP requests.
            self.db.run('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))','submit:'+self.user['id'])
            if key_hash:
                old=self.db.one('SELECT * FROM request_keys WHERE owner_id=%s AND scope=%s AND key_hash=%s',self.user['id'],scope,key_hash)
                if old:
                    if old['request_hash']!=request_hash: fail(409,'同一 Idempotency-Key 已用于不同请求，请使用新键')
                    return job_view(self.db.one('SELECT * FROM jobs WHERE id=%s',old['job_id'])),True
            if self.context.closing: fail(503,'服务正在停止，请稍后提交')
            if self.db.one("SELECT count(*) n FROM jobs WHERE owner_id=%s AND status IN ('queued','running')",self.user['id'])['n']>=self.context.settings.max_pending_per_user: fail(429,'待完成任务达到上限，请等待后再提交')
            job=build()
            if key_hash: self.db.insert('request_keys',{'owner_id':self.user['id'],'scope':scope,'key_hash':key_hash,'request_hash':request_hash,'job_id':job['id']})
        self.context.worker.notify();return job_view(job),False
    def enqueue(self,pid,source,sid,snapshot,publication_id=None):
        self.project(pid,True);jid=uid('job')
        self.db.insert('jobs',{'id':jid,'project_id':pid,'owner_id':self.user['id'],'source':source,'source_id':sid,'publication_id':publication_id,'snapshot':snapshot,'status':'queued'})
        return self.db.one('SELECT * FROM jobs WHERE id=%s',jid)
    def save_asset(self,data,kind,job=None,record=None):
        mime=sniff(data);aid=uid('asset');key='assets/'+aid+'.'+mime.split('/')[1]
        if kind in ('image','video') and not mime.startswith(kind+'/'): fail(400,'产物类型不匹配')
        item=record or {'project_id':job['project_id'],'owner_id':job['owner_id'],'name':'生成'+('图片' if kind=='image' else '视频'),'kind':kind,'visibility':'private','metadata':{'job_id':job['id'],'source':job['source'],'source_id':job['source_id'],'family_id':aid}}
        item={**item,'id':aid,'mime':mime,'file':key};item['metadata']=copy.deepcopy(item.get('metadata',{}));item['metadata'].setdefault('family_id',aid)
        self.context.storage.put(key,data,mime)
        try:
            self.db.insert('assets',item)
        except Exception:
            self.context.storage.delete(key);raise
        return self.db.one('SELECT * FROM assets WHERE id=%s',aid)
