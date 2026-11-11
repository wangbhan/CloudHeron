import base64,copy,json,math
import pytest
from fastapi import HTTPException
from cloudheron.domain import workflow,OPTIONS,options,copy_template,TEMPLATES,request_options,model_spec
from cloudheron.security import password,verify,Vault
from cloudheron.config import Settings
from cloudheron.main import create_app

def test_password_and_vault():
    value='fixture-password-123';encoded=password(value);assert verify(value,encoded);assert not verify('wrong',encoded)
    vault=Vault(base64.b64encode(b'k'*32).decode());secret=vault.encrypt('fixture-model-secret');assert vault.decrypt(secret)=='fixture-model-secret';assert vault.decrypt('')==''

@pytest.mark.parametrize('kind',list(OPTIONS))
def test_options_zero_hidden_and_nested(kind):
    zero={'image':'guidance_scale','video':'guidance_scale','text':'temperature'}[kind]
    raw={zero:0,'api_params':{'watermark':False,'nested':{'weights':[0,.5]}}};assert options(kind,raw)[zero]==0
    assert request_options(kind,raw,{'extra':{'watermark':True}})['watermark'] is False
    assert 'asset_ids' not in options(kind,{**raw,'asset_ids':['x']})

@pytest.mark.parametrize('raw',[{'n':5},{'n':True},{'quality':'bad'},{'api_params':[]},{'api_params':{'model':'override'}},{'api_params':{'image':'override'}},{'api_params':{'nested':{'__proto__':True}}},{'guidance_scale':float('nan')}])
def test_options_reject_invalid(raw):
    with pytest.raises(HTTPException): options('image',raw)

def test_workflow_and_template_copy():
    for t in TEMPLATES: assert len(workflow(t['document']))==len(t['document']['nodes'])
    doc=copy.deepcopy(TEMPLATES[0]['document']);doc['nodes'][1]['params']['model_id']='original'
    assert copy_template(doc,'copy')['nodes'][1]['params']['model_id']=='';assert doc['nodes'][1]['params']['model_id']=='original'
    doc['edges'].append({'source':'output','target':'image'})
    with pytest.raises(HTTPException): workflow(doc)

def test_openapi_explicit_paths_and_secrets():
    settings=Settings(database_url='postgresql://fixture:fixture@127.0.0.1/fixture_test',vault_key_b64=base64.b64encode(b'k'*32).decode(),s3_bucket='qa',s3_access_key='fixture',s3_secret_key='fixture-secret')
    spec=create_app(settings).openapi()
    assert spec['info']['version']=='0.3.4';assert '/api/chats/{chat_id}/messages' in spec['paths'];assert '/api/assets/{asset_id}/download-url' in spec['paths']
    assert spec['paths']['/api/chats/{chat_id}/messages']['post']['requestBody']['content']['application/json']['schema']['$ref'].endswith('/ChatMessage')
    assert spec['paths']['/api/v1/endpoints/{endpoint_id}/runs']['post']['security']==[{'HTTPBearer':[]}]
    assert 'secret' not in spec['components']['schemas']['ModelOut']['properties'];assert 'password' not in spec['components']['schemas']['UserOut']['properties']

def test_postgres_required_and_explicit_cors():
    with pytest.raises(ValueError): Settings(database_url='sqlite:///file',vault_key_b64='x',s3_bucket='qa')
    with pytest.raises(ValueError): Settings(database_url='postgresql://localhost/test',vault_key_b64='x',s3_bucket='qa',cors_origins=['*'])
