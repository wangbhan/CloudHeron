import base64,copy,json
from types import SimpleNamespace
from urllib.parse import urlsplit,parse_qs
import httpx,pytest
from fastapi import HTTPException
from cloudheron.domain import model_spec,options
from cloudheron.models.catalog import STYLES
from cloudheron.provider import Provider
from cloudheron.security import Vault

PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKwAAAABJRU5ErkJggg==')
VIDEO=b'\x00\x00\x00\x18ftypisom000000000000'

def spec(style,kind,**extra):
    return model_spec({'interface_style':style,'provider':'任意厂商','model':'custom-model-2027/A','base_url':'http://fixture.local'+('' if style=='minimax_v2' else '/v1'),'capabilities':[kind],**extra})

@pytest.mark.parametrize('style,kind',[(s['id'],c) for s in STYLES if s['id']!='legacy' for c in s['capabilities'] if c in ('text','image','video')])
def test_model_name_never_derived_from_interface(style,kind):
    value=spec(style,kind);assert value['model']=='custom-model-2027/A';assert value['provider']=='任意厂商'
    assert spec(style,kind,model='another-case-sensitive-ID')['model']=='another-case-sensitive-ID'

def test_legacy_preservation_and_style_validation():
    legacy={'protocol':'vLLM','base_url':'http://localhost:8000/v1','model':'local/custom','capabilities':['text','video'],'video_style':'openai','video_format':'json','paths':{'text':'/custom-chat'},'extra':{'x':False}}
    assert model_spec(legacy)==legacy
    assert model_spec(legacy|{'interface_style':'legacy'})==legacy|{'interface_style':'legacy'}
    for value in [legacy|{'interface_style':'unknown'},legacy|{'interface_style':'anthropic'},legacy|{'provider':[]}]:
        with pytest.raises(HTTPException): model_spec(value)
    assert model_spec(legacy|{'interface_style':'vllm_omni'})['video_format']=='multipart'

@pytest.mark.parametrize('field',['content','subject_reference','first_frame_image','duration'])
def test_native_controlled_parameters(field):
    with pytest.raises(HTTPException): options('video',{'api_params':{field:'override'}})

@pytest.fixture
def native(monkeypatch):
    received=[];mode={'value':'ok'};vault=Vault(base64.b64encode(b'k'*32).decode());saved=[]
    def handler(req):
        path=req.url.path;body=json.loads(req.content) if req.content else None
        received.append((req.method,str(req.url),body,dict(req.headers)))
        if mode['value']=='business_error': return httpx.Response(200,json={'base_resp':{'status_code':1004,'status_msg':'fixture-secret authentication'}})
        if path=='/v1/image_generation': return httpx.Response(200,json={'data':{'image_base64':[base64.b64encode(PNG).decode()]},'base_resp':{'status_code':0}})
        if path in ('/v1/video_generation','/v2/video_generation'): return httpx.Response(200,json={'task_id':'task_custom'})
        if path=='/v1/query/video_generation':
            assert parse_qs(req.url.query.decode())['task_id']==['task_custom']
            if mode['value']=='unknown':return httpx.Response(200,json={'status':'mystery'})
            if mode['value']=='failed':return httpx.Response(200,json={'status':'Fail','base_resp':{'status_code':0,'status_msg':'fixture-secret failed'}})
            return httpx.Response(200,json={'status':'Success','file_id':'file_custom','base_resp':{'status_code':0}})
        if path=='/v1/files/retrieve':
            assert parse_qs(req.url.query.decode())['file_id']==['file_custom']
            return httpx.Response(200,json={'file':{'download_url':'http://fixture.local/media.mp4'}})
        if path=='/v2/query/video_generation/task_custom':return httpx.Response(200,json={'task':{'status':'succeeded','content':{'url':'http://fixture.local/media.mp4'}}})
        if path=='/media.mp4':return httpx.Response(200,content=VIDEO)
        if path=='/v1/chat/completions':return httpx.Response(200,json={'choices':[{'message':{'content':'hello'}}]})
        if path=='/v1/models':return httpx.Response(200,json={'data':[{'id':'text-only'}]})
        return httpx.Response(404,json={})
    client=httpx.Client;transport=httpx.MockTransport(handler)
    monkeypatch.setattr(httpx,'Client',lambda **kw:client(transport=transport,**kw))
    def save(data,kind): saved.append((data,kind));return 'asset_'+str(len(saved))
    adapter=Provider(SimpleNamespace(model_timeout=1,model_check_timeout=1,poll_seconds=.001),vault,SimpleNamespace(read=lambda _:PNG),save)
    def model(style,kind,**extra):return {'spec':spec(style,kind,**extra),'secret':vault.encrypt('fixture-secret')}
    return adapter,model,received,saved,mode

def test_minimax_native_image_mapping_and_reference(native):
    p,m,got,saved,mode=native;model=m('minimax','image',capabilities=['image','image_edit'])
    assert p.generate(model,'image','云海',[{'mime':'image/png','file':'ref'}],{'size':'1024x1024','seed':0,'n':1,'response_format':'b64_json','api_params':{'prompt_optimizer':False}})==['asset_1']
    body=got[0][2];assert body['model']=='custom-model-2027/A';assert body['response_format']=='base64';assert body['seed']==0;assert body['prompt_optimizer'] is False
    assert body['width']==1024 and body['height']==1024;assert body['subject_reference'][0]['image_file'].startswith('data:image/png;base64,');assert saved==[(PNG,'image')]
    mode['value']='business_error'
    with pytest.raises(ValueError,match='1004') as exc:p.generate(model,'image','test',[],{})
    assert 'fixture-secret' not in str(exc.value)

@pytest.mark.parametrize('style',['minimax','minimax_v2'])
def test_minimax_video_complete_chain_and_arbitrary_model(native,style):
    p,m,got,saved,mode=native;model=m(style,'video')
    assert p.generate(model,'video','云海',[],{'size':'1280x720','seconds':6})==['asset_1']
    body=got[0][2];assert body['model']=='custom-model-2027/A';assert body['duration']==6;assert body['resolution']=='720P';assert 'seconds' not in body
    assert saved==[(VIDEO,'video')]
    assert got[0][3]['authorization']=='Bearer fixture-secret'
    if style=='minimax_v2':assert body['content']==[{'type':'text','text':'云海'}]
    else:assert body['prompt']=='云海'

def test_minimax_video_failures_references_and_unknown(native):
    p,m,got,saved,mode=native;model=m('minimax','video')
    for value in ('failed','unknown'):
        mode['value']=value
        with pytest.raises(ValueError) as exc:p.generate(model,'video','test',[],{})
        assert 'fixture-secret' not in str(exc.value)
    assert not saved
    mode['value']='ok';ref={'mime':'image/png','file':'ref'}
    p.generate(model,'video','test',[ref],{});assert got[-4][2]['first_frame_image'].startswith('data:')
    with pytest.raises(ValueError,match='一张'):p.generate(model,'video','test',[ref,ref],{})
    model=m('minimax_v2','video',capabilities=['video','video_reference']);p.generate(model,'video','test',[{'mime':'video/mp4','file':'ref'}],{})
    assert got[-3][2]['content'][1]['role']=='reference_video'

def test_minimax_text_and_non_generation_probe(native):
    p,m,got,saved,mode=native;model=m('minimax','text');assert p.chat(model,[{'role':'user','content':'hello'}])=='hello'
    result=p.check(model);assert result['ok'] and result['status']=='warning' and result['model_available'] is False
    assert [x[0] for x in got]==['POST','GET'];assert not saved

    # V2's root base URL still probes the documented v1 model-list route.
    result=p.check(m('minimax_v2','video'));assert result['status']=='warning'
    assert got[-1][1]=='http://fixture.local/v1/models'
