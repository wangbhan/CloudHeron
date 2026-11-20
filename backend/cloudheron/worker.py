import concurrent.futures,threading,time,logging
from contextlib import contextmanager
from fastapi import HTTPException
import psycopg
from psycopg_pool import PoolTimeout
from psycopg.types.json import Jsonb
from .db import DB
from .service import Service, uploaded_asset
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
            j=d.one('SELECT * FROM jobs WHERE id=%s FOR UPDATE',jid)
            if not j: return
            steps=j['steps'];error=str(error)[:500]
            for step in steps.values():
                if step['status']=='running': step.update(status='failed',error=error)
            d.run("UPDATE jobs SET status='failed',error=%s,steps=%s,updated_at=now() WHERE id=%s",error,Jsonb(steps),jid)
            if j['source']=='chat':
                c=d.one('SELECT * FROM chats WHERE id=%s FOR UPDATE',j['source_id'])
                if c and not any(m.get('job_id')==jid and m['role']=='assistant' for m in c['messages']):
                    msgs=c['messages']+[{'id':uid('msg'),'role':'assistant','text':'生成失败：'+error,'job_id':jid,'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}]
                    d.run('UPDATE chats SET messages=%s,updated_at=now() WHERE id=%s',Jsonb(msgs),c['id'])
    def execute(self, jid):
        try:
            with self.ctx.database.connection() as conn:
                job = DB(conn).one('SELECT * FROM jobs WHERE id=%s', jid)
            if job:
                self.run_job(job)
        except Exception as error:
            detail = error.detail if isinstance(error, HTTPException) else str(error)
            try:
                with self.ctx.database.connection() as conn:
                    self.failed(DB(conn), jid, detail)
            except (psycopg.Error, PoolTimeout):
                logging.getLogger(__name__).error('Could not persist failure for job %s', jid)
        finally:
            with self.guard:
                self.active.discard(jid)
            self.notify()

    def run_job(self, j):
        from .project_context import with_context
        jid = j['id']
        snap = j['snapshot']
        project_context = snap.get('project_context')
        steps = {}

        @contextmanager
        def authorized():
            with self.ctx.database.connection() as conn:
                db = DB(conn)
                user = db.one('SELECT * FROM users WHERE id=%s', j['owner_id'])
                service = Service(db, self.ctx, user)
                service.project(j['project_id'], True)
                yield service

        def step(node_id, state, output=None):
            steps[node_id] = {'status': state}
            if output is not None:
                steps[node_id]['output'] = output
            with self.ctx.database.connection() as conn:
                DB(conn).run('UPDATE jobs SET steps=%s,updated_at=now() WHERE id=%s', Jsonb(steps), jid)

        def save(data, kind):
            # Check before transferring the object and again before exposing its metadata.
            with authorized():
                pass
            record = None
            if j['source'] == 'creation':
                node_id = next((key for key, value in steps.items() if value['status'] == 'running'), None)
                name = next((n.get('label', n['id']) for n in snap['document']['nodes'] if n['id'] == node_id), '生成产物')
                record = {
                    'project_id': j['project_id'], 'owner_id': j['owner_id'],
                    'name': name, 'kind': kind, 'visibility': 'private',
                    'metadata': {'job_id': jid, 'source': j['source'], 'source_id': j['source_id'], 'node_id': node_id},
                }
            with uploaded_asset(self.ctx.storage, data, kind, j, record) as item:
                with authorized() as service, service.db.tx():
                    service.db.insert('assets', item)
                    return service.db.one('SELECT * FROM assets WHERE id=%s', item['id'])

        api = Provider(self.ctx.settings, self.ctx.vault, self.ctx.storage, save)

        def generate(kind, model_id, prompt, asset_ids, params):
            with authorized() as service:
                model = service.model(model_id)
                prompt = service.skills(with_context(prompt, project_context), params.get('skill_ids', []))
                refs = [service.asset(asset_id) for asset_id in asset_ids]
            return api.generate(model, kind, prompt, refs, params)

        def send_chat(model_id, messages, params, skill_ids=()):
            with authorized() as service:
                model = service.model(model_id)
                if skill_ids:
                    messages[-1]['content'] = service.skills(messages[-1]['content'], skill_ids)
            return api.chat(model, messages, params)

        def chat(model_id, prompt, params):
            return send_chat(model_id, [
                {'role': 'system', 'content': '你是云鹭提示词 Agent，整理可用提示词。'},
                {'role': 'user', 'content': with_context(prompt, project_context)},
            ], params, params.get('skill_ids', []))

        with authorized():
            pass
        outputs = []
        assistant = None
        creation_update = None
        if j['source'] == 'document_analysis':
            step('document', 'running')
            with authorized() as service:
                model = service.model(snap['model_id'])
                images = [service.asset(item['asset_id']) for item in snap['document']['images']]
            result = api.analyze_document(model, snap['document'], images, {'max_tokens': 4096, **snap['params']})
            if not result or len(result) > 16000:
                fail(400, '分析结果过长或为空，请调整模型参数后重试')
            with authorized() as service, service.db.tx():
                updated = service.db.one(
                    "UPDATE documents SET status='analyzed',summary=%s WHERE id=%s AND job_id=%s RETURNING id",
                    result, j['source_id'], jid,
                )
                if not updated:
                    fail(409, '文档分析版本已变化')
                step_output = {'document_id': j['source_id']}
                steps['document'] = {'status': 'completed', 'output': step_output}
                service.db.run("UPDATE jobs SET status='completed',steps=%s,updated_at=now() WHERE id=%s", Jsonb(steps), jid)
            return
        if j['source'] == 'creation_plan':
            from .creations.domain import parse_plan
            doc = snap['document']
            step('plan', 'running')
            request = {key: doc[key] for key in ('story', 'style', 'count', 'kind')}
            result = send_chat(doc['text_model_id'], [
                {'role': 'system', 'content': '将故事整理为指定数量的独立画面，人物和风格保持一致。'
                 '只返回JSON对象，格式为{"cards":[{"title":"画面标题","prompt":"可直接用于生图或视频的完整描述"}]}，不输出其它内容。'},
                {'role': 'user', 'content': with_context(str(request), project_context)},
            ], {'max_tokens': 4096})
            doc['cards'] = parse_plan(result, doc['count'])
            creation_update = doc
            step('plan', 'completed', {'card_count': len(doc['cards'])})
        elif j['source'] == 'chat':
            cfg = snap['config']
            step('agent', 'running')
            history = [
                {'role': message['role'], 'content': message['text']}
                for message in snap['messages']
                if message['role'] in ('user', 'assistant') and message.get('text')
            ][-20:]
            base_prompt = snap['prompt']
            if cfg.get('document_context'):
                context = cfg['document_context']
                document_text = '\n\n【已确认文档 ' + context['filename'] + '】\n' + context['summary']
                base_prompt += document_text
                if history:
                    history[-1]['content'] += document_text
            if cfg['agent'] == 'prompt':
                result = send_chat(cfg['model_id'], [
                    {'role': 'system', 'content': '你是云鹭提示词 Agent，只返回可用提示词。'},
                    *history[:-1],
                    {'role': 'user', 'content': with_context(base_prompt, project_context)},
                ], cfg, cfg['skill_ids'])
            else:
                prompt = base_prompt
                if cfg.get('text_model_id'):
                    prompt = send_chat(cfg['text_model_id'], [
                        {'role': 'system', 'content': '结合创作历史整理生成提示词，只返回提示词。'},
                        *history[:-1],
                        {'role': 'user', 'content': with_context(history[-1]['content'], project_context)},
                    ], cfg.get('text_options', {}))
                elif len(history) > 1:
                    prompt = '\n'.join(message['role'] + ': ' + message['content'] for message in history)
                outputs = generate(cfg['kind'], cfg['model_id'], prompt, cfg['asset_ids'], cfg)
                result = ('图片' if cfg['kind'] == 'image' else '视频') + '已生成。'
            step('agent', 'completed')
            assistant = {
                'id': uid('msg'), 'role': 'assistant', 'text': result, 'outputs': [asset['id'] for asset in outputs],
                'job_id': jid, 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            }
        else:
            doc = snap['document']
            values = {}
            for node in workflow(doc):
                node_id = node['id']
                step(node_id, 'running')
                params = node['params']
                inbound = [values[edge['source']] for edge in doc['edges'] if edge['target'] == node_id]
                texts = [value['text'] for value in inbound if value.get('text')]
                media = [asset for value in inbound for asset in value.get('media', [])]
                prompt = '\n'.join(texts) or params.get('prompt') or snap.get('input', {}).get('prompt', '')
                node_type = node['type']
                if node_type == 'prompt_input':
                    out = {'text': snap.get('input', {}).get('prompt', params.get('prompt', ''))}
                elif node_type == 'reference_asset':
                    with authorized() as service:
                        out = {'media': [service.asset(params.get('asset_id'))]}
                elif node_type == 'prompt_agent':
                    out = {'text': chat(params.get('model_id'), prompt, params)}
                elif node_type in ('image_generate', 'video_generate'):
                    kind = 'image' if node_type == 'image_generate' else 'video'
                    out = {'media': generate(kind, params.get('model_id'), prompt, [asset['id'] for asset in media], params)}
                else:
                    out = {'media': media}
                values[node_id] = out
                step_output = {'text': out['text']} if 'text' in out else {'asset_ids': [asset['id'] for asset in out.get('media', [])]}
                step(node_id, 'completed', step_output)
            collected = [
                asset for node in doc['nodes'] if node['type'] == 'media_output'
                for asset in values[node['id']].get('media', [])
            ]
            if not collected:
                collected = [
                    asset for node in doc['nodes'] if node['type'] in ('image_generate', 'video_generate')
                    for asset in values[node['id']].get('media', [])
                ]
            outputs = list({asset['id']: asset for asset in collected}.values())
        with authorized() as service, service.db.tx():
            d = service.db
            if creation_update is not None:
                changed = d.one(
                    'UPDATE creations SET document=%s,revision=revision+1,updated_at=now() WHERE id=%s AND revision=%s RETURNING id',
                    Jsonb(creation_update), j['source_id'], snap['revision'],
                )
                if not changed:
                    fail(409, '创作版本已改变，规划结果未覆盖当前内容')
            if assistant:
                c = d.one('SELECT messages FROM chats WHERE id=%s FOR UPDATE', j['source_id'])
                d.run('UPDATE chats SET messages=%s,updated_at=now() WHERE id=%s', Jsonb(c['messages'] + [assistant]), j['source_id'])
            d.run("UPDATE jobs SET status='completed',outputs=%s,updated_at=now() WHERE id=%s", Jsonb([a['id'] for a in outputs]), jid)
