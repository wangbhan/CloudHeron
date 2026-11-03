import copy,json
import pytest
from fastapi import HTTPException
from cloudheron.domain import TEMPLATES,workflow
from cloudheron.workflow_ai import proposal

@pytest.mark.parametrize('form',['missing','array','strings','negative'])
def test_ai_layout_normalization_preserves_business_fields(form):
    base=copy.deepcopy(TEMPLATES[0]['document']);doc=copy.deepcopy(base);node=doc['nodes'][0]
    node['params'].pop('prompt',None)
    if form=='missing':node.pop('position');node.pop('params')
    if form=='array':node['position']=[120,240]
    if form=='strings':node['position']={'x':'120','y':'240'}
    if form=='negative':node['position']={'x':-20,'y':240}
    fixed,note=proposal(json.dumps({'explanation':'示例修改','document':doc}),base)
    workflow(fixed);assert '画布兼容处理' in note
    assert fixed['nodes'][0]['params']==base['nodes'][0]['params']
    assert fixed['nodes'][0]['position']['x']>=0
    assert base==TEMPLATES[0]['document']

@pytest.mark.parametrize('field,value',[('params',[]),('position',{'x':'bad','y':0}),('position',{'x':True,'y':0})])
def test_ai_invalid_fields_rejected_with_node_name(field,value):
    base=copy.deepcopy(TEMPLATES[0]['document']);doc=copy.deepcopy(base);doc['nodes'][0][field]=value
    with pytest.raises(HTTPException) as exc:proposal(json.dumps({'explanation':'x','document':doc}),base)
    assert exc.value.status_code==422 and doc['nodes'][0]['id'] in exc.value.detail

def test_ai_new_node_layout_and_invalid_identifier():
    base=copy.deepcopy(TEMPLATES[0]['document']);doc=copy.deepcopy(base)
    doc['nodes'].append({'id':'new_input','type':'prompt_input','label':'新增文本','params':{'prompt':'fixture'}})
    fixed,note=proposal(json.dumps({'explanation':'增加输入','document':doc}),base)
    assert fixed['nodes'][-1]['position']['x']>=0 and 'new_input补全坐标' in note
    doc['nodes'][-1]['id']=[]
    with pytest.raises(HTTPException) as exc:proposal(json.dumps({'explanation':'x','document':doc}),base)
    assert exc.value.status_code==422
