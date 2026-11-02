"""Interface contracts describe wire formats, never model-name allowlists."""
import copy
from ..security import fail,text

ALL=['text','image','image_edit','video','video_reference']
STYLES=[
    {'id':'openai','name':'OpenAI 兼容','capabilities':ALL,'base_hint':'https://your-service.example/v1','note':'文本 Chat Completions、Images、异步 /videos；可用于兼容该格式的任意厂商或部署。'},
    {'id':'anthropic','name':'Anthropic / Claude 兼容','capabilities':['text'],'base_hint':'https://your-service.example/v1','note':'Messages 格式、x-api-key、anthropic-version；模型名自由填写。'},
    {'id':'vllm_omni','name':'vLLM-Omni','capabilities':ALL,'base_hint':'http://127.0.0.1:8000/v1','note':'文本/图片兼容 OpenAI；视频使用官方 multipart /videos。'},
    {'id':'minimax','name':'MiniMax 原生（图片 / 视频 V1）','capabilities':['text','image','image_edit','video'],'base_hint':'https://api.minimax.io/v1','note':'图片 /image_generation；视频 V1 提交→查询→文件下载；文本可选 OpenAI/Claude 兼容格式。'},
    {'id':'minimax_v2','name':'MiniMax 视频 V2','capabilities':['video','video_reference'],'base_hint':'https://api.minimax.io','note':'/v2/video_generation，content 参考数组与异步查询。服务地址不带 /v1。'},
    {'id':'legacy','name':'现有自定义配置','capabilities':ALL,'base_hint':'https://your-service.example/v1','note':'保留已有协议、路径、格式与参考字段；用于兼容历史配置。'},
]

def normalize_spec(spec):
    if not isinstance(spec,dict): fail(400,'模型配置须为对象')
    out=copy.deepcopy(spec);style=out.get('interface_style')
    if 'provider' in out: text(out['provider'],'厂商名称',100)
    if not style: return out  # Historical rows retain their exact behavior.
    entry=next((x for x in STYLES if x['id']==style),None)
    if not entry: fail(400,'接口风格有误')
    caps=out.get('capabilities',[])
    if not isinstance(caps,list) or any(c not in entry['capabilities'] for c in caps): fail(400,'所选接口风格不支持这些任务能力')
    if style=='legacy': return out
    out['protocol']={'openai':'OpenAI','anthropic':'Claude','vllm_omni':'vLLM-Omni','minimax':'MiniMax','minimax_v2':'MiniMax'}[style]
    out['text_format']='claude' if style=='anthropic' else 'openai' if style=='minimax_v2' else out.get('text_format','openai')
    if style in ('openai','vllm_omni') and out['text_format']=='claude': fail(400,'该接口风格请选择Chat Completions或Responses')
    out['image_style']='minimax' if style=='minimax' else 'openai'
    out['video_style']='minimax_v2' if style=='minimax_v2' else 'minimax' if style=='minimax' else 'vllm_omni' if style=='vllm_omni' else 'openai'
    if style in ('minimax','minimax_v2'): out.update(format='json',video_format='json')
    if style=='vllm_omni': out['video_format']='multipart'
    return out
