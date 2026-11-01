"""MiniMax native media adapters. Model IDs pass through unchanged."""
import base64,re,time
from urllib.parse import quote
from ..domain import request_options

def checked(p,m,data):
    if not isinstance(data,dict): raise ValueError('MiniMax 响应须为 JSON 对象')
    base=data.get('base_resp',{})
    if not isinstance(base,dict): raise ValueError('MiniMax base_resp 格式有误')
    code=base.get('status_code',0)
    if code not in (0,'0'): raise ValueError(p.redact('MiniMax '+str(code)+'：'+str(base.get('status_msg','请求失败')),p.vault.decrypt(m['secret'])))
    return data

def generate(p,m,kind,prompt,refs,params):
    spec=m['spec'];paths=spec.get('paths',{});values=request_options(kind,params,spec)
    data_uri=lambda a:'data:'+a['mime']+';base64,'+base64.b64encode(p.storage.read(a['file'])).decode()
    body={**values,'model':spec['model']}
    for controlled in ('content','subject_reference','first_frame_image','duration'):
        body.pop(controlled,None)
    if kind=='image':
        body['prompt']=prompt
        if body.get('response_format')=='b64_json': body['response_format']='base64'
        if params.get('size') and not body.get('aspect_ratio'):
            match=re.fullmatch(r'(\d+)[x×](\d+)',params['size'])
            if not match: raise ValueError('MiniMax 图片分辨率须为宽x高，或在附加参数配置 aspect_ratio')
            body.setdefault('width',int(match[1]));body.setdefault('height',int(match[2]))
        if params.get('seed','')!='': body['seed']=params['seed']
        if refs: body['subject_reference']=[{'type':'character','image_file':data_uri(a)} for a in refs]
        result=checked(p,m,p.request(m,paths.get('image','/image_generation'),'POST',body))
        result=result.get('data',{})
        if not isinstance(result,dict): raise ValueError('MiniMax 图片响应缺少 data 对象')
        items=[{'b64_json':x} for x in result.get('image_base64',[])]+[{'url':x} for x in result.get('image_urls',[])]
        if not items: raise ValueError('MiniMax 图片响应缺少 image_urls 或 image_base64')
        return [p.download(m,item,'image') for item in items[:4]]
    v2=spec.get('video_style')=='minimax_v2'
    # Core fields cannot be overridden by model defaults or task extensions.
    body['duration']=params.get('seconds',4)
    if params.get('size') and 'resolution' not in body:
        match=re.fullmatch(r'(\d+)[x×](\d+)',params['size'])
        body['resolution']=match[2]+'P' if match else params['size']
    if params.get('seed','')!='': body['seed']=params['seed']
    if v2:
        body['content']=[{'type':'text','text':prompt}]+[{'type':'video_url' if a['mime'].startswith('video/') else 'image_url',('video_url' if a['mime'].startswith('video/') else 'image_url'):{'url':data_uri(a)},'role':'reference_video' if a['mime'].startswith('video/') else 'reference_image'} for a in refs]
        # V2 defaults are rooted at the host; custom endpoints remain relative to base_url.
        create_path=paths.get('video','/v2/video_generation')
    else:
        if len(refs)>1 or any(not a['mime'].startswith('image/') for a in refs): raise ValueError('MiniMax 视频 V1 此入口仅支持一张首帧参考图；多参考或参考视频请选择 V2')
        body['prompt']=prompt
        if refs: body['first_frame_image']=data_uri(refs[0])
        create_path=paths.get('video','/video_generation')
    result=checked(p,m,p.request(m,create_path,'POST',body));tid=result.get('task_id')
    if not isinstance(tid,str) or not tid: raise ValueError('MiniMax 视频响应缺少 task_id')
    deadline=time.monotonic()+1800
    while True:
        if time.monotonic()>deadline: raise ValueError('MiniMax 视频超过30分钟，请先查询上游任务 '+tid)
        if v2: path=paths.get('video_status','/v2/query/video_generation/{id}').replace('{id}',quote(tid,safe=''))
        else: path=paths.get('video_status','/query/video_generation')+'?task_id='+quote(tid,safe='')
        result=checked(p,m,p.request(m,path))
        if v2: result=result.get('task',{})
        if not isinstance(result,dict): raise ValueError('MiniMax 视频任务响应格式有误')
        state=result.get('status')
        if state in ('Fail','failed','cancelled','canceled'):
            raise ValueError(p.redact('MiniMax 视频失败：'+str(result.get('error',result.get('base_resp',{}).get('status_msg','上游任务失败'))),p.vault.decrypt(m['secret'])))
        if state in ('Success','succeeded'): break
        if state not in ('Preparing','Queueing','Processing','queued','running'): raise ValueError('MiniMax 返回未知视频状态：'+str(state)+'，请先查询任务 '+tid)
        time.sleep(p.settings.poll_seconds)
    if v2:
        content=result.get('content',{})
        url=content.get('url') if isinstance(content,dict) else None
    else:
        fid=result.get('file_id')
        if not isinstance(fid,(str,int)) or not str(fid): raise ValueError('MiniMax 视频完成但缺少 file_id')
        result=checked(p,m,p.request(m,paths.get('video_content','/files/retrieve')+'?file_id='+quote(str(fid),safe='')))
        url=result.get('file',{}).get('download_url')
    if not isinstance(url,str) or not url: raise ValueError('MiniMax 视频完成但缺少下载地址')
    return [p.download(m,{'url':url},'video')]
