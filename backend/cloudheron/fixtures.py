import copy,json
from .security import uid,fail
from .db import now
from psycopg.types.json import Jsonb
from .domain import TEMPLATES,AGENTS
def manual_workspace(s):
    key='manual_workspace_'+s.user['id'];saved=s.db.one('SELECT value FROM meta WHERE key=%s',key);old=saved['value'] if saved else None
    workspace=copy.deepcopy(old) if old and s.db.one('SELECT id FROM projects WHERE id=%s',old['project_id']) else {'project_id':uid('project'),'workflows':{},'chats':{},'assets':[]}
    pid=workspace['project_id'];created=[]
    try:
        with s.db.tx():
            s.db.run('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',key)
            if not s.db.one('SELECT id FROM projects WHERE id=%s',pid): s.db.insert('projects',{'id':pid,'name':'功能验收测试项目','owner_id':s.user['id'],'visibility':'team'})
            for i,(name,kind,file) in enumerate([('测试参考 · 云鹭角色','character','cloudheron-icon.png'),('测试参考 · 云海场景','scene','cloudheron-login-scene.png')]):
                if len(workspace['assets'])>i and s.db.one('SELECT id FROM assets WHERE id=%s',workspace['assets'][i]): continue
                a=s.save_asset((s.context.settings.frontend_dir/'assets'/file).read_bytes(),kind,record={'project_id':pid,'owner_id':s.user['id'],'name':name,'kind':kind,'visibility':'team','metadata':{'source':'manual_test_fixture'}});created.append(a['file'])
                if len(workspace['assets'])>i: workspace['assets'][i]=a['id']
                else: workspace['assets'].append(a['id'])
            for kind,name in [('image','TST-004/005/010 · 图片工作流'),('video','TST-015 · 视频工作流'),('reference','TST-016 · 参考资产工作流'),('error','TST-009 · 未配置模型报错')]:
                if workspace['workflows'].get(kind) and s.db.one('SELECT id FROM workflows WHERE id=%s',workspace['workflows'][kind]): continue
                doc=copy.deepcopy(TEMPLATES[1 if kind=='video' else 0]['document']);doc['nodes'][0]['params']['prompt']='白鹭飞过云海，柔和晨光，远处青山'
                if kind=='reference':
                    doc['nodes'].append({'id':'reference','type':'reference_asset','label':'云鹭角色参考','params':{'asset_id':workspace['assets'][0]},'position':{'x':40,'y':310}});doc['edges'].append({'source':'reference','target':'image'})
                workspace['workflows'][kind]=s.create_workflow(pid,name,doc)['id']
            for a in AGENTS:
                if workspace['chats'].get(a['id']) and s.db.one('SELECT id FROM chats WHERE id=%s',workspace['chats'][a['id']]): continue
                cid=uid('chat');cfg={**a['defaults'],'agent':a['id'],'model_id':'','kind':'video' if a['id']=='prompt' else a['id'],'asset_ids':[] if a['id']=='prompt' else [workspace['assets'][0]],'skill_ids':[],'additional_skill_ids':[],'expert_id':'expert_'+a['id']}
                s.db.insert('chats',{'id':cid,'project_id':pid,'title':a['name']+' 测试','messages':[{'id':uid('msg'),'role':'system','text':'【预置测试说明，尚未调用模型】请选择实际模型后测试 '+a['name'],'config':cfg,'at':now().isoformat()}]});workspace['chats'][a['id']]=cid
            cases=json.loads((s.context.settings.frontend_dir/'test-cases.json').read_text())
            for c in cases:
                entry='#projects/'+pid
                if any(x in c['title'] for x in ('工作流','节点','模板')): entry='#workflow/'+workspace['workflows']['image']
                elif '视频' in c['title']: entry='#create/'+workspace['chats']['video']
                elif 'Agent' in c['title'] or '对话' in c['title']: entry='#create/'+workspace['chats']['image']
                if c['id']=='TST-009': entry='#workflow/'+workspace['workflows']['error']
                if c['id']=='TST-016': entry='#workflow/'+workspace['workflows']['reference']
                if c['id'] in ('TST-043','TST-044'): entry='#models'
                if c['id']=='TST-045': entry='#create/'+workspace['chats']['video']
                if c['id']=='TST-014': entry='#create/'+workspace['chats']['prompt']
                if c.get('entry_path') in ('#models','#studio'): entry=c['entry_path']
                definition={**c,'entry_path':entry}
                s.db.run('INSERT INTO project_test_cases(project_id,test_id,definition) VALUES(%s,%s,%s) ON CONFLICT(project_id,test_id) DO UPDATE SET definition=EXCLUDED.definition',pid,c['id'],Jsonb(definition))
            workspace.update(case_ids=[c['id'] for c in cases],name=s.project(pid)['name'])
            s.db.run('INSERT INTO meta(key,value) VALUES(%s,%s) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',key,Jsonb(workspace))
        return workspace
    except Exception:
        for file in created: s.context.storage.delete(file)
        raise
