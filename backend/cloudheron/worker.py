import concurrent.futures,threading,time,logging
import psycopg
from psycopg_pool import PoolTimeout
from psycopg.types.json import Jsonb
from .db import DB
from .service import Service
from .domain import workflow
from .provider import Provider
from .security import uid,fail

class Worker:
    def __init__(self,context):
        self.ctx=context;self.stop_event=threading.Event();self.wake=threading.Event();self.active=set();self.guard=threading.Lock()
        self.executor=concurrent.futures.ThreadPoolExecutor(max_workers=context.settings.workers,thread_name_prefix='cloudheron-job')
        self.thread=threading.Thread(target=self.loop,name='cloudheron-scheduler',daemon=True)
    def notify(self): self.wake.set()
    def recover(self):
        with self.ctx.database.connection() as conn:
            d=DB(conn)
            for j in d.all("SELECT id FROM jobs WHERE status='running'"): self.failed(d,j['id'],'服务重启中断任务，请检查当前产物后重新运行')
    def start(self): self.recover();self.thread.start();self.notify()
    def close(self): self.stop_event.set();self.notify();self.thread.join() if self.thread.ident is not None else None;self.executor.shutdown(wait=True)
    def state(self):
        with self.guard: return {'active':len(self.active),'concurrency':self.ctx.settings.workers,'paused':self.stop_event.is_set()}
    def loop(self):
        while not self.stop_event.is_set():
            # The advisory lock belongs to this dedicated connection. If it is
            # lost, drain instead of continuing under an unowned execution lease.
            try: self.ctx.owner.execute('SELECT 1')
            except psycopg.Error:
                logging.getLogger(__name__).error('Executor database connection lost; restart required')
                self.ctx.closing=True;self.stop_event.set();break
            with self.guard: capacity=self.ctx.settings.workers-len(self.active)
            if capacity:
                try:
                    with self.ctx.database.connection() as conn:
                        d=DB(conn)
                        with d.tx():
                            row=d.one("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1")
                            if row and not self.stop_event.is_set(): d.run("UPDATE jobs SET status='running',updated_at=now() WHERE id=%s",row['id'])
                            else: row=None
                except (psycopg.Error,PoolTimeout):
                    logging.getLogger(__name__).error('Queue database unavailable; retrying acquisition')
                    self.wake.wait(1);self.wake.clear();continue
                if row:
                    with self.guard: self.active.add(row['id'])
                    self.executor.submit(self.execute,row['id']);continue
            self.wake.wait(.25);self.wake.clear()
    def failed(self,d,jid,error):
        with d.tx():
            j=d.one('SELECT * FROM jobs WHERE id=%s FOR UPDATE',jid);steps=j['steps'];error=str(error)[:500]
            for step in steps.values():
                if step['status']=='running': step.update(status='failed',error=error)
            d.run("UPDATE jobs SET status='failed',error=%s,steps=%s,updated_at=now() WHERE id=%s",error,Jsonb(steps),jid)
            if j['source']=='chat':
                c=d.one('SELECT * FROM chats WHERE id=%s FOR UPDATE',j['source_id'])
                if c and not any(m.get('job_id')==jid and m['role']=='assistant' for m in c['messages']):
                    msgs=c['messages']+[{'id':uid('msg'),'role':'assistant','text':'生成失败：'+error,'job_id':jid,'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}]
                    d.run('UPDATE chats SET messages=%s,updated_at=now() WHERE id=%s',Jsonb(msgs),c['id'])
    def execute(self,jid):
        from .project_context import with_context
        try:
            with self.ctx.database.connection() as conn:
                d=DB(conn);j=d.one('SELECT * FROM jobs WHERE id=%s',jid);snap=j['snapshot'];steps={}
                project_context=snap.get('project_context')
                user=d.one('SELECT * FROM users WHERE id=%s',j['owner_id']);s=Service(d,self.ctx,user)
                def step(n,state,out=None,error=None):
                    steps[n]={'status':state}
                    if out is not None: steps[n]['output']=out
                    if error: steps[n]['error']=str(error)[:500]
                    d.run('UPDATE jobs SET steps=%s,updated_at=now() WHERE id=%s',Jsonb(steps),jid)
                def principal():
                    s.user=d.one('SELECT * FROM users WHERE id=%s',j['owner_id']);s.project(j['project_id'],True)
                def save(data,kind):
                    principal();record=None
                    if j['source']=='creation':
                        nid=next((key for key,value in steps.items() if value['status']=='running'),None)
                        name=next((n.get('label',n['id']) for n in snap['document']['nodes'] if n['id']==nid),'生成产物')
                        record={'project_id':j['project_id'],'owner_id':j['owner_id'],'name':name,'kind':kind,'visibility':'private','metadata':{'job_id':jid,'source':j['source'],'source_id':j['source_id'],'node_id':nid}}
                    return s.save_asset(data,kind,j,record)
                api=Provider(self.ctx.settings,self.ctx.vault,self.ctx.storage,save)
                def generate(kind,mid,prompt,refs,p): principal();return api.generate(s.model(mid),kind,s.skills(with_context(prompt,project_context),p.get('skill_ids',[])),refs,p)
                def chat(mid,prompt,p): principal();return api.chat(s.model(mid),[{'role':'system','content':'你是云鹭提示词 Agent，整理可用提示词。'},{'role':'user','content':s.skills(with_context(prompt,project_context),p.get('skill_ids',[]))}],p)
                try:
                    principal();outputs=[];assistant=None;creation_update=None
                    if j['source']=='creation_plan':
                        from .creations.domain import parse_plan
                        doc=snap['document'];step('plan','running')
                        result=api.chat(s.model(doc['text_model_id']),[{'role':'system','content':'将故事整理为指定数量的独立画面，人物和风格保持一致。只返回JSON对象，格式为{"cards":[{"title":"画面标题","prompt":"可直接用于生图或视频的完整描述"}]}，不输出其它内容。'},{'role':'user','content':with_context(str({'story':doc['story'],'style':doc['style'],'count':doc['count'],'kind':doc['kind']}),project_context)}],{'max_tokens':4096})
                        doc['cards']=parse_plan(result,doc['count']);creation_update=doc;step('plan','completed',{'card_count':len(doc['cards'])})
                    elif j['source']=='chat':
                        cfg=snap['config'];step('agent','running');history=[{'role':m['role'],'content':m['text']} for m in snap['messages'] if m['role'] in ('user','assistant') and m.get('text')][-20:]
                        refs=[s.asset(a) for a in cfg['asset_ids']]
                        if cfg['agent']=='prompt': result=api.chat(s.model(cfg['model_id']),[{'role':'system','content':'你是云鹭提示词 Agent，只返回可用提示词。'},*history[:-1],{'role':'user','content':s.skills(with_context(snap['prompt'],project_context),cfg['skill_ids'])}],cfg)
                        else:
                            prompt=snap['prompt']
                            if cfg.get('text_model_id'): prompt=api.chat(s.model(cfg['text_model_id']),[{'role':'system','content':'结合创作历史整理生成提示词，只返回提示词。'},*history[:-1],{'role':'user','content':with_context(history[-1]['content'],project_context)}],cfg.get('text_options',{}))
                            elif len(history)>1: prompt='\n'.join(m['role']+': '+m['content'] for m in history)
                            outputs=generate(cfg['kind'],cfg['model_id'],prompt,refs,cfg);result=('图片' if cfg['kind']=='image' else '视频')+'已生成。'
                        step('agent','completed');assistant={'id':uid('msg'),'role':'assistant','text':result,'outputs':[a['id'] for a in outputs],'job_id':jid,'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
                    else:
                        doc=snap['document'];values={}
                        for n in workflow(doc):
                            step(n['id'],'running');p=n['params'];inbound=[values[e['source']] for e in doc['edges'] if e['target']==n['id']]
                            texts=[v['text'] for v in inbound if v.get('text')];media=[a for v in inbound for a in v.get('media',[])];prompt='\n'.join(texts) or p.get('prompt') or snap.get('input',{}).get('prompt','')
                            if n['type']=='prompt_input': out={'text':snap.get('input',{}).get('prompt',p.get('prompt',''))}
                            elif n['type']=='reference_asset': out={'media':[s.asset(p.get('asset_id'))]}
                            elif n['type']=='prompt_agent': out={'text':chat(p.get('model_id'),prompt,p)}
                            elif n['type'] in ('image_generate','video_generate'): out={'media':generate('image' if n['type']=='image_generate' else 'video',p.get('model_id'),prompt,media,p)}
                            else: out={'media':media}
                            values[n['id']]=out;step(n['id'],'completed',{'text':out['text']} if 'text' in out else {'asset_ids':[a['id'] for a in out.get('media',[])]})
                        collected=[a for n in doc['nodes'] if n['type']=='media_output' for a in values[n['id']].get('media',[])]
                        if not collected: collected=[a for n in doc['nodes'] if n['type'] in ('image_generate','video_generate') for a in values[n['id']].get('media',[])]
                        outputs=list({a['id']:a for a in collected}.values())
                    with d.tx():
                        if creation_update is not None:
                            principal()
                            changed=d.one('UPDATE creations SET document=%s,revision=revision+1,updated_at=now() WHERE id=%s AND revision=%s RETURNING id',Jsonb(creation_update),j['source_id'],snap['revision'])
                            if not changed: fail(409,'创作版本已改变，规划结果未覆盖当前内容')
                        if assistant:
                            c=d.one('SELECT messages FROM chats WHERE id=%s FOR UPDATE',j['source_id']);d.run('UPDATE chats SET messages=%s,updated_at=now() WHERE id=%s',Jsonb(c['messages']+[assistant]),j['source_id'])
                        d.run("UPDATE jobs SET status='completed',outputs=%s,updated_at=now() WHERE id=%s",Jsonb([a['id'] for a in outputs]),jid)
                except Exception as e:
                    from fastapi import HTTPException
                    self.failed(d,jid,e.detail if isinstance(e,HTTPException) else str(e))
        finally:
            with self.guard: self.active.discard(jid)
            self.notify()
