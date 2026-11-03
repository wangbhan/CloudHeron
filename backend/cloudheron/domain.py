import copy,json,math,re
from pathlib import Path
from .security import fail,text

REG=json.loads((Path(__file__).parent/'registry.json').read_text())
OPTIONS=REG['task_options'];NODES=REG['node_types'];AGENTS=REG['agents'];TEMPLATES=REG['templates']
RESERVED={'model','prompt','messages','stream','size','seconds','seed','image','image[]','input_reference','video_reference','model_id','text_model_id','asset_id','asset_ids','agent','kind','skill_ids','expert_id','project_id','api_params','text_options','content','subject_reference','first_frame_image','duration','authorization','api_key','headers','base_url','paths','reference_fields'}|{f['key'] for fields in OPTIONS.values() for f in fields}
UNSAFE={'__proto__','constructor','prototype'}
def json_check(value,depth=0):
    if depth>8: fail(400,'额外 API 参数嵌套最多 8 层')
    if isinstance(value,dict):
        for k,v in value.items():
            if k in UNSAFE: fail(400,'额外 API 参数包含无效字段')
            json_check(v,depth+1)
    elif isinstance(value,list):
        for v in value: json_check(v,depth+1)
    elif isinstance(value,float) and not math.isfinite(value): fail(400,'数字须为有限值')
def options(kind,raw,reference_fields=()):
    if not isinstance(raw,dict): fail(400,'API 配置须为对象')
    out={}
    for f in OPTIONS[kind]:
        v=raw.get(f['key'],'')
        if v=='': continue
        if f['type']=='number':
            if type(v) not in (int,float) or not math.isfinite(v) or not f['min']<=v<=f['max'] or (f.get('integer') and int(v)!=v): fail(400,f['label']+'数值超出允许范围')
        elif f['type']=='select':
            if v not in f['values']: fail(400,f['label']+'选项有误')
        elif f['type']=='lines':
            if not isinstance(v,list) or not 1<=len(v)<=4 or any(not isinstance(x,str) or not 1<=len(x)<=200 for x in v): fail(400,'停止词须为 1–4 个文本')
        elif not isinstance(v,str) or len(v)>f['maxLength']: fail(400,f['label']+'格式有误')
        out[f['key']]=copy.deepcopy(v)
    if 'api_params' in raw:
        custom=raw['api_params']
        if not isinstance(custom,dict): fail(400,'额外 API 参数须为 JSON 对象')
        json_check(custom)
        if len(json.dumps(custom,ensure_ascii=False))>16000: fail(400,'额外 API 参数过长')
        blocked={str(k).lower() for k in RESERVED|set(reference_fields)}
        for k in custom:
            if not re.fullmatch(r'[-a-zA-Z0-9_\[\]]{1,80}',k) or k.lower() in blocked: fail(400,'额外 API 参数覆盖受控字段：'+k)
        if custom: out['api_params']=copy.deepcopy(custom)
    return out
def request_options(kind,p,spec):
    out=options(kind,p,spec.get('reference_fields',{}).values());custom=out.pop('api_params',{})
    return {**spec.get('extra',{}),**custom,**out}
def model_spec(spec):
    from urllib.parse import urlsplit
    from .models.catalog import normalize_spec
    spec=normalize_spec(spec)
    if not isinstance(spec,dict): fail(400,'模型配置须为对象')
    u=urlsplit(spec.get('base_url',''))
    if u.scheme not in ('http','https') or not u.hostname or u.username or u.password or u.query or u.fragment: fail(400,'模型地址须为 HTTP(S) 服务根地址')
    if spec.get('protocol') not in ('OpenAI','Claude','vLLM','vLLM-Omni','SGLang','MiniMax'): fail(400,'模型协议有误')
    if spec.get('text_format','openai') not in ('openai','claude','responses'): fail(400,'文本请求格式有误')
    if spec.get('video_style','openai') not in ('openai','vllm_omni','minimax','minimax_v2'): fail(400,'视频接口风格有误')
    if spec.get('video_style', 'vllm_omni' if spec.get('protocol')=='vLLM-Omni' else 'openai')=='vllm_omni' and spec.get('video_format','multipart')!='multipart': fail(400,'官方 vLLM-Omni 视频接口使用 multipart，请选择对应格式')
    if spec.get('image_style','openai') not in ('openai','minimax'): fail(400,'图片接口风格有误')
    if spec.get('anthropic_version','2023-06-01')!='2023-06-01': fail(400,'Claude API 版本须为 2023-06-01')
    caps=spec.get('capabilities',[])
    if not isinstance(caps,list) or not caps or any(c not in ('text','image','image_edit','video','video_reference') for c in caps): fail(400,'模型能力有误')
    if 'image_edit' in caps and 'image' not in caps or 'video_reference' in caps and 'video' not in caps: fail(400,'参考能力须同时启用对应生成能力')
    text(spec.get('model'),'上游模型名称')
    for name in ('format','video_format'):
        if name in spec and spec[name] not in ('multipart','json'): fail(400,'请求格式有误')
    if not isinstance(spec.get('paths',{}),dict) or any(not isinstance(v,str) or not re.fullmatch(r'/[a-zA-Z0-9_/{\}-]+',v) or '..' in v for v in spec.get('paths',{}).values()): fail(400,'接口路径须为相对路径')
    fields=spec.get('reference_fields',{})
    if not isinstance(fields,dict) or any(k not in ('image','video') for k in fields): fail(400,'参考字段有误')
    for name in fields.values():
        if not isinstance(name,str) or not re.fullmatch(r'[-a-zA-Z0-9_\[\]]{1,80}',name) or name in UNSAFE or (name.lower() in RESERVED and name not in ('image','image[]','input_reference','video_reference')): fail(400,'参考字段须为独立字段名')
    if not isinstance(spec.get('extra',{}),dict): fail(400,'附加参数须为 JSON 对象')
    json_check(spec.get('extra',{}))
    if len(json.dumps(spec.get('extra',{})))>16000: fail(400,'附加参数过长')
    return spec
def workflow(w):
    if not isinstance(w,dict) or w.get('schema_version')!='1.0' or not isinstance(w.get('nodes'),list) or not 1<=len(w['nodes'])<=100 or not isinstance(w.get('edges'),list) or len(w['edges'])>300: fail(400,'工作流须为 schema_version 1.0，包含 1–100 个节点')
    nodes={};degree={};seen=set()
    allowed={'prompt_input':[],'reference_asset':[],'prompt_agent':['text'],'image_generate':['text','image','reference'],'video_generate':['text','image','video','reference'],'media_output':['image','video','media','reference']}
    for n in w['nodes']:
        if not isinstance(n,dict) or not isinstance(n.get('id'),str) or not re.fullmatch(r'[-\w]{1,80}',n['id'],re.ASCII) or n['id'] in nodes or n.get('type') not in NODES: fail(400,'节点编号或类型有误')
        p=n.get('params');pos=n.get('position',{})
        if not isinstance(p,dict) or not isinstance(pos,dict) or any(type(pos.get(k)) not in (int,float) or not math.isfinite(pos[k]) or not 0<=pos[k]<=10000 for k in ('x','y')): fail(400,'节点 '+n['id']+' 的params须为对象，position.x/y须为0–10000的有限数字')
        for k in ('prompt','model_id','asset_id','size'):
            if k in p and not isinstance(p[k],str): fail(400,'节点 '+k+' 须为文本')
        if 'seconds' in p and (type(p['seconds']) not in (int,float) or not 1<=p['seconds']<=120): fail(400,'视频时长须为 1–120 秒')
        if p.get('seed','')!='' and (type(p['seed'])!=int or abs(p['seed'])>2**53-1): fail(400,'随机种子须为有效整数')
        if 'skill_ids' in p and (not isinstance(p['skill_ids'],list) or len(p['skill_ids'])>20 or any(not isinstance(x,str) for x in p['skill_ids'])): fail(400,'Skill 参数有误')
        kind={'prompt_agent':'text','image_generate':'image','video_generate':'video'}.get(n['type'])
        if kind: options(kind,p)
        nodes[n['id']]=n;degree[n['id']]=0
    for e in w['edges']:
        if not isinstance(e,dict) or e.get('source') not in nodes or e.get('target') not in nodes or e['source']==e['target']: fail(400,'连线引用有误')
        pair=(e['source'],e['target'])
        if pair in seen: fail(400,'重复连线')
        seen.add(pair)
        if NODES[nodes[e['source']]['type']]['output'] not in allowed[nodes[e['target']]['type']]: fail(400,'连线输入输出类型不匹配')
        degree[e['target']]+=1
    queue=[k for k,d in degree.items() if d==0];order=[]
    while queue:
        k=queue.pop(0);order.append(nodes[k])
        for e in w['edges']:
            if e['source']==k:
                degree[e['target']]-=1
                if degree[e['target']]==0: queue.append(e['target'])
    if len(order)!=len(nodes): fail(400,'工作流存在循环连线')
    return order
def copy_template(document,name,keep=False):
    doc=copy.deepcopy(document);doc['name']=name
    for n in doc['nodes']:
        if not keep:
            for k in ('model_id','asset_id'):
                if k in n['params']: n['params'][k]=''
    return doc
