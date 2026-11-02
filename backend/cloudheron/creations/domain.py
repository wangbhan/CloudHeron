"""Guided creation compiles confirmed cards to the existing workflow contract."""
import json,re
from ..security import fail,text
from ..domain import workflow

def cards(value,count=None):
    if not isinstance(value,list) or not 1<=len(value)<=12: fail(400,'画面列表须包含1–12个画面')
    if count is not None and len(value)!=count: fail(400,'AI返回的画面数量不符，请重新规划或手动编辑')
    out=[]
    for i,c in enumerate(value):
        if not isinstance(c,dict): fail(400,'画面格式有误')
        out.append({'title':text(c.get('title'),'画面标题',100),'prompt':text(c.get('prompt'),'画面描述',4000)})
    return out

def parse_plan(raw,count):
    value=raw.strip()
    if value.startswith('```'): value=re.sub(r'^```(?:json)?\s*|\s*```$','',value)
    try: obj=json.loads(value)
    except ValueError: fail(400,'AI未返回有效画面JSON，请重试规划或手动填写')
    return cards(obj.get('cards') if isinstance(obj,dict) else obj,count)

def config(s,doc,need_media=False):
    if not need_media:
        model=s.model(doc['text_model_id'])
        if 'text' not in model['spec']['capabilities']: fail(400,'故事规划需要文本模型')
    if need_media:
        media=s.model(doc['model_id'])
        if doc['kind'] not in media['spec']['capabilities']: fail(400,'请选择对应图片或视频模型')
    for aid in doc['asset_ids']: s.asset(aid)

def compile_workflow(name,doc):
    plan=cards(doc.get('cards'));nodes=[];edges=[]
    for i,c in enumerate(plan):
        sid=f'scene_{i+1}';gen=f'generate_{i+1}'
        prompt=(doc['style']+'\n' if doc.get('style') else '')+c['prompt']
        params={'model_id':doc['model_id'],'size':doc['size']}
        if doc['kind']=='video': params['seconds']=doc['seconds']
        nodes.extend([{'id':sid,'type':'prompt_input','label':c['title'],'params':{'prompt':prompt},'position':{'x':40,'y':40+i*180}},{'id':gen,'type':doc['kind']+'_generate','label':'生成'+c['title'],'params':params,'position':{'x':360,'y':40+i*180}}])
        edges.extend([{'source':sid,'target':gen},{'source':gen,'target':'output'}])
        for j,aid in enumerate(doc['asset_ids']): edges.append({'source':f'ref_{j+1}','target':gen})
    for j,aid in enumerate(doc['asset_ids']): nodes.append({'id':f'ref_{j+1}','type':'reference_asset','label':'参考资产','params':{'asset_id':aid},'position':{'x':40+j*260,'y':40+len(plan)*180}})
    nodes.append({'id':'output','type':'media_output','label':'项目产物','params':{},'position':{'x':720,'y':40}})
    result={'schema_version':'1.0','name':name,'nodes':nodes,'edges':edges};workflow(result);return result
