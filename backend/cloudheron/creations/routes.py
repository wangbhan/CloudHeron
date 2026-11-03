import copy
from typing import Annotated,Literal
from psycopg.types.json import Jsonb
from fastapi import Header,Response
from pydantic import Field,StrictInt
from ..schemas import Contract,JobOut,Revision,WorkflowOut
from ..security import uid,text,fail,permission
from ..service import job_view
from .domain import cards,config,compile_workflow

class CreationWrite(Contract):
    project_id:str;name:str;story:str=Field(min_length=1,max_length=16000);style:str=Field(default='',max_length=2000)
    kind:Literal['image','video']='image';count:int=Field(default=3,ge=1,le=12)
    text_model_id:str='';model_id:str='';size:str=Field(default='1024x1024',min_length=1,max_length=80)
    seconds:int=Field(default=4,ge=1,le=120);asset_ids:list[str]=Field(default_factory=list,max_length=8)
    cards:list[dict]=Field(default_factory=list,max_length=12)
class CreationSave(CreationWrite): revision:int=Field(ge=1)
class CreationRun(Revision):
    card_indices:list[StrictInt]|None=Field(default=None,min_length=1,max_length=12)

def register(api,Svc):
    Key=Annotated[str|None,Header(alias='Idempotency-Key')]
    def view(s,c):
        j=s.db.one("SELECT * FROM jobs WHERE source_id=%s AND source IN ('creation','creation_plan') ORDER BY created_at DESC LIMIT 1",c['id'])
        indices=j['snapshot'].get('card_indices') if j and j['source']=='creation' else None
        return {**c,'run_card_indices':indices,'can_resume':bool(j and j['source']=='creation' and j['snapshot'].get('card_titles')==[x['title'] for x in c['document']['cards']]),'can_edit':permission(s.user,s.project(c['project_id']),True),'job':job_view(j)}
    def read(s,cid,edit=False):
        c=s.db.one('SELECT * FROM creations WHERE id=%s',cid)
        if not c: fail(404,'集成创作不存在')
        s.project(c['project_id'],edit);return c
    def busy(s,cid):
        if s.db.one("SELECT id FROM jobs WHERE source_id=%s AND status IN ('queued','running')",cid): fail(409,'当前创作正在执行，请等待完成')
    @api.get('/creations',response_model=list[dict],tags=['集成创作'])
    def listing(s:Svc): return [view(s,c) for c in s.db.all('SELECT * FROM creations ORDER BY updated_at DESC') if permission(s.user,s.db.one('SELECT * FROM projects WHERE id=%s',c['project_id']))]
    @api.post('/creations',response_model=dict,status_code=201,tags=['集成创作'])
    def create(b:CreationWrite,s:Svc):
        s.project(b.project_id,True);doc=b.model_dump(exclude={'project_id','name'})
        if doc['cards']:doc['cards']=cards(doc['cards'])
        cid=uid('creation');s.db.insert('creations',{'id':cid,'project_id':b.project_id,'owner_id':s.user['id'],'name':text(b.name,'名称'),'document':doc});return view(s,read(s,cid))
    @api.get('/creations/{creation_id}',response_model=dict,tags=['集成创作'])
    def detail(creation_id:str,s:Svc): return view(s,read(s,creation_id))
    @api.put('/creations/{creation_id}',response_model=dict,tags=['集成创作'])
    def save(creation_id:str,b:CreationSave,s:Svc):
        c=read(s,creation_id,True)
        if b.project_id!=c['project_id']:fail(400,'创作所属项目固定，请另建创作')
        doc=b.model_dump(exclude={'project_id','name','revision'})
        if doc['cards']:doc['cards']=cards(doc['cards'])
        with s.db.tx():
            s.db.one('SELECT id FROM creations WHERE id=%s FOR UPDATE',creation_id);busy(s,creation_id)
            updated=s.db.one('UPDATE creations SET name=%s,document=%s,revision=revision+1,updated_at=now() WHERE id=%s AND revision=%s RETURNING *',text(b.name,'名称'),Jsonb(doc),creation_id,b.revision)
            if not updated:fail(409,'创作已被更新，请刷新')
        return view(s,updated)
    def submit(s,cid,b,mode,key,response):
        c=read(s,cid,True)
        def build():
            current=s.db.one('SELECT * FROM creations WHERE id=%s FOR UPDATE',cid);busy(s,cid)
            if current['revision']!=b.revision:fail(409,'创作已被更新，请刷新')
            doc=current['document'];config(s,doc,mode=='creation')
            snap={'revision':current['revision'],'document':copy.deepcopy(doc),'name':current['name']}
            if mode=='creation':
                definition=compile_workflow(current['name'],doc,b.card_indices);s.wf_resources(definition);snap={'document':definition,'creation_revision':current['revision'],'card_titles':[x['title'] for x in doc['cards']],'card_indices':b.card_indices if b.card_indices is not None else list(range(len(doc['cards'])))}
            return s.enqueue(c['project_id'],mode,cid,snap)
        j,replayed=s.submit(mode+':'+cid,key,b.model_dump(),build)
        if replayed:response.headers['Idempotency-Replayed']='true'
        return j
    @api.post('/creations/{creation_id}/plan',response_model=JobOut,status_code=202,tags=['集成创作'])
    def plan(creation_id:str,b:Revision,response:Response,s:Svc,idempotency_key:Key=None):return submit(s,creation_id,b,'creation_plan',idempotency_key,response)
    @api.post('/creations/{creation_id}/run',response_model=JobOut,status_code=202,tags=['集成创作'])
    def run(creation_id:str,b:CreationRun,response:Response,s:Svc,idempotency_key:Key=None):return submit(s,creation_id,b,'creation',idempotency_key,response)
    @api.post('/creations/{creation_id}/workflow',response_model=WorkflowOut,status_code=201,tags=['集成创作'])
    def export(creation_id:str,b:Revision,s:Svc):
        c=read(s,creation_id,True)
        if c['revision']!=b.revision:fail(409,'创作已被更新，请刷新')
        config(s,c['document'],True);definition=compile_workflow(c['name'],c['document']);return s.create_workflow(c['project_id'],c['name']+' · 画板',definition)
