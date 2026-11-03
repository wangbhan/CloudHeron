"""Normalize AI presentation fields before the ordinary workflow/resource validation."""
import copy,json,math,re
from .security import fail,text
from .domain import workflow

CONTRACT='只返回JSON对象 {"explanation":"修改摘要","document":{"schema_version":"1.0","name":"工作流名称","nodes":[{"id":"节点ID","type":"节点类型","label":"名称","params":{},"position":{"x":40,"y":40}}],"edges":[{"source":"源节点ID","target":"目标节点ID"}]}}。所有节点必须有params对象和position数值坐标x/y（0至10000）；保留已有模型ID、资产ID、参数和坐标。返回完整工作流，不要返回补丁，不执行任务。'

def proposal(raw,base):
    try: data=json.loads(re.sub(r'\s*```$','',re.sub(r'^```(?:json)?\s*','',raw.strip())))
    except (ValueError,TypeError):fail(422,'AI未返回有效JSON，当前工作流保持原样')
    if not isinstance(data,dict):fail(422,'AI修改结果须为JSON对象')
    doc=copy.deepcopy(data.get('document'))
    if not isinstance(doc,dict) or not isinstance(doc.get('nodes'),list):fail(422,'AI修改结果缺少document.nodes，当前工作流保持原样')
    previous={n['id']:n for n in base['nodes']};notes=[]
    for i,n in enumerate(doc['nodes']):
        if not isinstance(n,dict):fail(422,'AI节点须为对象')
        if not isinstance(n.get('id'),str):fail(422,'AI节点 '+str(i+1)+' 的id须为文本')
        old=previous.get(n['id'],{});label=n['id']
        if 'params' not in n:n['params']=copy.deepcopy(old.get('params',{}));notes.append(label+'补全参数对象')
        elif not isinstance(n['params'],dict):fail(422,'AI节点 '+label+' 的params须为对象')
        elif old:n['params']={**copy.deepcopy(old['params']),**n['params']}
        pos=n.get('position')
        if pos is None:pos=copy.deepcopy(old.get('position',{'x':40+(i%4)*280,'y':40+(i//4)*200}));notes.append(label+'补全坐标')
        elif isinstance(pos,list) and len(pos)==2:pos=dict(zip(('x','y'),pos));notes.append(label+'转换数组坐标')
        if not isinstance(pos,dict):fail(422,'AI节点 '+label+' 的position须包含x/y')
        normalized={}
        for key in ('x','y'):
            value=pos.get(key,old.get('position',{}).get(key))
            if isinstance(value,str):
                try:value=float(value);notes.append(label+'转换'+key+'数字坐标')
                except ValueError:pass
            if type(value) not in (int,float) or not math.isfinite(value):fail(422,'AI节点 '+label+' 的position.'+key+'须为有限数字')
            normalized[key]=max(0,min(10000,value))
            if normalized[key]!=value:notes.append(label+'将'+key+'移入画布范围')
        n['position']=normalized
    workflow(doc)
    explanation=text(data.get('explanation'),'修改摘要',4000)
    if notes:explanation+='\n画布兼容处理：'+'；'.join(notes)
    return doc,explanation[:8000]
