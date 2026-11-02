import base64,json
from types import SimpleNamespace
import httpx,pytest
from cloudheron.domain import model_spec
from cloudheron.provider import endpoint,Provider
from cloudheron.security import Vault
from cloudheron.creations.domain import parse_plan,compile_workflow
from fastapi import HTTPException

@pytest.mark.parametrize('base,paths,expected',[('http://host',{},'/v1/responses'),('http://host/v1',{},'/responses'),('http://host/proxy',{},'/responses'),('http://host',{'text':'/special'},'/special')])
def test_root_and_versioned_endpoints(base,paths,expected):assert endpoint({'base_url':base,'paths':paths},'text','/responses')==expected

def test_responses_exact_contract_and_catalog_is_not_generation(monkeypatch):
    seen=[];mode={'value':'ok'};vault=Vault(base64.b64encode(b'k'*32).decode())
    def handler(req):
        seen.append((req.method,req.url.path,json.loads(req.content) if req.content else None))
        if req.method=='GET':return httpx.Response(200,json={'data':[{'id':'arbitrary-model'}]})
        if mode['value']=='failed':return httpx.Response(502,json={'error':'upstream fixture-secret'})
        if mode['value']=='incomplete':return httpx.Response(200,json={'status':'incomplete','output':[]})
        return httpx.Response(200,json={'status':'completed','output':[{'type':'reasoning','summary':[]},{'type':'message','content':[{'type':'output_text','text':'成功'}]}]})
    client=httpx.Client;monkeypatch.setattr(httpx,'Client',lambda **kw:client(transport=httpx.MockTransport(handler),**kw))
    p=Provider(SimpleNamespace(model_timeout=1,model_check_timeout=1),vault,None,None)
    spec=model_spec({'interface_style':'openai','text_format':'responses','model':'arbitrary-model','base_url':'http://host','capabilities':['text']});m={'spec':spec,'secret':vault.encrypt('fixture-secret')}
    result=p.check(m);assert result['ok'] and result['generation_verified'] is False and result['scope']=='model_list'
    assert p.chat(m,[{'role':'user','content':'hi'}],{'max_tokens':128})=='成功'
    assert seen[-1][1]=='/v1/responses' and seen[-1][2]['max_output_tokens']==128 and 'messages' not in seen[-1][2] and seen[-1][2]['model']=='arbitrary-model'
    mode['value']='failed'
    with pytest.raises(ValueError,match='HTTP 502') as exc:p.chat(m,[{'role':'user','content':'hi'}])
    assert 'fixture-secret' not in str(exc.value);assert 'POST /v1/responses' in str(exc.value)
    mode['value']='incomplete'
    with pytest.raises(ValueError,match='未完成'):p.chat(m,[{'role':'user','content':'hi'}])
    assert len(seen)==4  # No automatic POST retries.

def test_guided_plan_schema_and_workflow_preserves_per_frame_prompts():
    cards=parse_plan('```json\n{"cards":[{"title":"一","prompt":"白鹭晨光"},{"title":"二","prompt":"白鹭雨夜"}]}\n```',2)
    for value in ('bad','{"cards":[]}','{"cards":[{"title":"x","prompt":""}]}'):
        with pytest.raises(HTTPException):parse_plan(value,2)
    doc={'kind':'video','model_id':'m','cards':cards,'style':'东方山水','size':'1280x720','seconds':6,'asset_ids':['asset_ref']}
    w=compile_workflow('作品',doc)
    assert w['nodes'][0]['params']['prompt']=='东方山水\n白鹭晨光'
    assert w['nodes'][2]['params']['prompt']=='东方山水\n白鹭雨夜'
    assert len([x for x in w['edges'] if x['source']=='ref_1'])==2
