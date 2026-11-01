from psycopg.types.json import Jsonb
from ..schemas import ModelOut,ModelWrite,ModelCheckOut
from ..security import uid,text,fail
from ..domain import model_spec
from ..provider import Provider
from .catalog import STYLES

def register(api,Svc,settings):
    @api.get('/model-styles',response_model=list[dict],tags=['模型'])
    def styles(s:Svc): return STYLES
    @api.get('/models',response_model=list[ModelOut],tags=['模型'])
    def models(s:Svc): return [s.model_view(m) for m in s.db.all('SELECT * FROM models ORDER BY updated_at DESC')]
    @api.post('/models',response_model=ModelOut,status_code=201,tags=['模型'])
    def add_model(b:ModelWrite,s:Svc):
        s.admin();spec=model_spec(b.spec);mid=uid('model')
        s.db.insert('models',{'id':mid,'name':text(b.name,'配置名称'),'spec':spec,'secret':s.context.vault.encrypt(b.api_key or ''),'enabled':b.enabled})
        return s.model_view(s.db.one('SELECT * FROM models WHERE id=%s',mid))
    @api.put('/models/{model_id}',response_model=ModelOut,tags=['模型'])
    def update_model(model_id:str,b:ModelWrite,s:Svc):
        s.admin();old=s.db.one('SELECT * FROM models WHERE id=%s',model_id)
        if not old: fail(404,'模型不存在')
        spec=model_spec(b.spec);secret=old['secret'] if b.api_key is None else s.context.vault.encrypt(b.api_key)
        s.db.run('UPDATE models SET name=%s,spec=%s,secret=%s,enabled=%s,updated_at=now() WHERE id=%s',text(b.name,'配置名称'),Jsonb(spec),secret,b.enabled,model_id)
        return s.model_view(s.db.one('SELECT * FROM models WHERE id=%s',model_id))
    @api.post('/models/{model_id}/check',response_model=ModelCheckOut,tags=['模型'])
    def check_model(model_id:str,s:Svc):
        s.admin();m=s.db.one('SELECT * FROM models WHERE id=%s',model_id)
        if not m: fail(404,'模型不存在')
        return Provider(settings,s.context.vault,s.context.storage,None).check(m)
