import base64,ipaddress,json,re,socket,time
from urllib.parse import urlsplit,quote
import httpx
from .domain import request_options
from .security import fail
class Provider:
    def __init__(self,settings,vault,storage,save): self.settings=settings;self.vault=vault;self.storage=storage;self.save=save
    def redact(self,message,key):
        value=str(message).replace(key,'[凭据已隐藏]') if key else str(message)
        return re.sub(r'Bearer\s+[\w.-]+','Bearer [凭据已隐藏]',value,flags=re.I)[:400]
    def request(self,m,path,method='GET',body=None,files=None,raw=False,timeout=None,claude=False):
        spec=m['spec'];key=self.vault.decrypt(m['secret']);headers={'Authorization':'Bearer '+key} if key else {}
        if claude:
            headers={'anthropic-version':'2023-06-01'}
            if key: headers['x-api-key']=key
        timeout=timeout or self.settings.model_timeout
        deadline=time.monotonic()+timeout
        url=spec['base_url'].rstrip('/')+path
        with httpx.Client(timeout=timeout,follow_redirects=False,trust_env=urlsplit(url).hostname not in ('localhost','127.0.0.1','::1')) as client:
            try:
                kwargs={'headers':headers}
                if files is not None: kwargs.update(data=body,files=files)
                elif body is not None: kwargs['json']=body
                with client.stream(method,url,**kwargs) as r:
                    limit=100*1024*1024 if raw else 32*1024*1024
                    if r.status_code>=300: limit=4096
                    data=bytearray()
                    for chunk in r.iter_bytes():
                        if time.monotonic()>deadline: raise ValueError('模型请求超过限定时间')
                        if len(data)+len(chunk)>limit: raise ValueError('模型响应超过大小上限')
                        data.extend(chunk)
                    if r.status_code>=300: raise ValueError(f'模型 HTTP {r.status_code}：{self.redact(data.decode(errors="replace"),key)}')
                    if raw: return bytes(data),r.headers.get('content-type','application/octet-stream').split(';')[0]
                    try: return json.loads(data)
                    except ValueError: raise ValueError('模型未返回有效 JSON')
            except httpx.HTTPError: raise ValueError('模型服务连接失败或超时，请检查地址和服务状态') from None
    def check(self,m):
        start=time.monotonic();spec=m['spec'];is_claude=spec.get('text_format', 'claude' if spec.get('protocol')=='Claude' else 'openai')=='claude'
        try:
            result=self.request(m,spec.get('paths',{}).get('models','/v1/models' if spec.get('interface_style')=='minimax_v2' else '/models'),timeout=self.settings.model_check_timeout,claude=is_claude)
            if spec.get('interface_style') in ('minimax','minimax_v2'):
                from .models.minimax import checked
                checked(self,m,result)
            if not isinstance(result,dict) or not isinstance(result.get('data'),list): raise ValueError('模型列表响应缺少 data 数组，请检查 models 路径')
            models=[x['id'] for x in result['data'] if isinstance(x,dict) and isinstance(x.get('id'),str)][:200]
            available=spec['model'] in models
            return {'ok':True,'status':'success' if available else 'warning','models':models,'model_available':available,'elapsed_ms':round((time.monotonic()-start)*1000),'note':'服务连接成功，所填模型在返回列表中；生成能力以实际任务为准' if available else '服务连接成功，但返回列表未发现所填模型，请核对模型名称或列表分页；尚未验证生成能力'}
        except ValueError as e:
            return {'ok':False,'status':'failed','models':[],'model_available':None,'elapsed_ms':round((time.monotonic()-start)*1000),'note':self.redact(str(e),self.vault.decrypt(m['secret']))}
    def chat(self,m,messages,params=None):
        spec=m['spec']
        if 'text' not in spec['capabilities']: raise ValueError('模型未启用文本能力')
        values=request_options('text',params or {},spec)
        is_claude=spec.get('text_format','claude' if spec.get('protocol')=='Claude' else 'openai')=='claude'
        if is_claude:
            unsupported=set(values)&{'presence_penalty','frequency_penalty','repetition_penalty','seed'}
            if unsupported: raise ValueError('Claude 格式不支持这些 OpenAI 参数：'+','.join(sorted(unsupported)))
            if 'stop' in values: values['stop_sequences']=values.pop('stop')
            values.setdefault('max_tokens',1024)
            body={**values,'model':spec['model'],'messages':[x for x in messages if x['role']!='system'],'stream':False}
            system='\n'.join(x['content'] for x in messages if x['role']=='system')
            if system: body['system']=system
            data=self.request(m,spec.get('paths',{}).get('text','/messages'),'POST',body,claude=True)
            blocks=data.get('content',[]) if isinstance(data,dict) else []
            if not isinstance(blocks,list): raise ValueError('Claude 响应缺少 content 文本块')
            content='\n'.join(x['text'] for x in blocks if isinstance(x,dict) and x.get('type')=='text' and isinstance(x.get('text'),str))
        else:
            body={**values,'model':spec['model'],'messages':messages,'stream':False}
            data=self.request(m,spec.get('paths',{}).get('text','/chat/completions'),'POST',body)
            try: content=data['choices'][0]['message']['content']
            except (KeyError,IndexError,TypeError): raise ValueError('文本响应缺少 choices[0].message.content') from None
        if not isinstance(content,str) or not content.strip(): raise ValueError('文本响应为空')
        return content
    def download(self,m,item,kind):
        if item.get('b64_json'):
            try: data=base64.b64decode(item['b64_json'],validate=True)
            except ValueError: raise ValueError('模型返回的 base64 有误') from None
            if len(data)>100*1024*1024: raise ValueError('模型返回文件过大')
            return self.save(data,kind)
        value=item.get('url');u=urlsplit(value or '');spec=m['spec'];own=(u.scheme,u.netloc)==(urlsplit(spec['base_url']).scheme,urlsplit(spec['base_url']).netloc)
        if u.scheme not in ('http','https') or not u.hostname or u.username or u.password: raise ValueError('媒体地址有误')
        if not own:
            if u.scheme!='https': raise ValueError('外部媒体须使用 HTTPS')
            addresses={x[4][0] for x in socket.getaddrinfo(u.hostname,u.port or 443)}
            if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses): raise ValueError('外部媒体须为公开地址')
        key=self.vault.decrypt(m['secret']);headers={'Authorization':'Bearer '+key} if own and key else {}
        with httpx.Client(timeout=self.settings.model_timeout,follow_redirects=False,trust_env=u.hostname not in ('localhost','127.0.0.1','::1')) as client:
            with client.stream('GET',value,headers=headers) as r:
                if r.status_code!=200: raise ValueError('媒体下载失败：HTTP '+str(r.status_code))
                data=bytearray()
                for chunk in r.iter_bytes():
                    if len(data)+len(chunk)>100*1024*1024: raise ValueError('媒体文件过大')
                    data.extend(chunk)
        return self.save(bytes(data),kind)
    def generate(self,m,kind,prompt,refs,params):
        spec=m['spec'];caps=spec['capabilities'];paths=spec.get('paths',{})
        if kind not in caps: raise ValueError('模型未启用对应生成能力')
        if not prompt.strip(): raise ValueError('请填写画面提示词')
        if any(not a['mime'].startswith(('image/','video/')) for a in refs): raise ValueError('参考须为图片或视频')
        if kind=='image' and any(a['mime'].startswith('video/') for a in refs): raise ValueError('图片仅支持参考图片')
        if kind=='image' and refs and 'image_edit' not in caps: raise ValueError('模型未启用参考图片编辑能力')
        if kind=='video' and any(a['mime'].startswith('video/') for a in refs) and 'video_reference' not in caps: raise ValueError('模型未启用参考视频能力')
        if (kind=='image' and spec.get('image_style')=='minimax') or (kind=='video' and spec.get('video_style') in ('minimax','minimax_v2')):
            from .models.minimax import generate
            return generate(self,m,kind,prompt,refs,params)
        omni=kind=='video' and spec.get('video_style','vllm_omni' if spec.get('protocol')=='vLLM-Omni' else 'openai')=='vllm_omni'
        if omni and len(refs)>1: raise ValueError('官方 vLLM-Omni 视频任务每次只支持一个参考文件')
        body={**request_options(kind,params,spec),'model':spec['model'],'prompt':prompt}
        if params.get('size'): body['size']=params['size']
        if kind=='video': body['seconds']=str(params.get('seconds',4))
        if params.get('seed','')!='': body['seed']=params['seed']
        path=paths.get('video','/videos') if kind=='video' else paths.get('edit','/images/edits') if refs else paths.get('image','/images/generations')
        if omni:
            # Model-specific extensions travel inside the documented extra_params.
            known={'model','prompt','size','seconds','seed','fps','num_frames','width','height','num_inference_steps','guidance_scale','guidance_scale_2','true_cfg_scale','boundary_ratio','flow_shift','negative_prompt','generate_sound','sound_duration','enable_frame_interpolation','frame_interpolation_exp','frame_interpolation_scale','frame_interpolation_model_path','lora','user','extra_params'}
            extras=body.pop('extra_params',{})
            if not isinstance(extras,dict): raise ValueError('vLLM-Omni extra_params 须为 JSON 对象')
            extras={**extras,**{k:body.pop(k) for k in list(body) if k not in known}}
            if extras: body['extra_params']=extras
            if 'num_frames' in body: body.pop('seconds',None)
        files=None
        field=lambda a:spec.get('reference_fields',{}).get('video' if a['mime'].startswith('video/') else 'image','video_reference' if a['mime'].startswith('video/') else 'input_reference')
        if omni: field=lambda a:'input_reference'
        if kind=='video' and spec.get('video_format')=='json' and not omni:
            groups={}
            for a in refs: groups.setdefault(field(a),[]).append('data:'+a['mime']+';base64,'+base64.b64encode(self.storage.read(a['file'])).decode())
            body.update({k:v[0] if len(v)==1 else v for k,v in groups.items()})
        elif kind=='video' or refs or spec.get('format')=='multipart':
            # files with scalar entries force multipart even when there are no reference files.
            files=[(k,(None,json.dumps(v,separators=(',',':')) if isinstance(v,(dict,list,bool)) else str(v))) for k,v in body.items() if v is not None]
            for i,a in enumerate(refs): files.append((field(a) if kind=='video' else 'image[]' if len(refs)>1 else 'image',(f'reference-{i}.'+a['mime'].split('/')[1],self.storage.read(a['file']),a['mime'])))
            body={}
        data=self.request(m,path,'POST',body,files)
        if data.get('data'):
            return [self.download(m,x,kind) for x in data['data'][:4 if kind=='image' else 1]]
        if kind=='image': raise ValueError('图像响应缺少 data 数组')
        if not isinstance(data.get('id'),str): raise ValueError('视频响应缺少异步任务 id')
        deadline=time.monotonic()+1800;state=data;upstream_id=quote(data['id'],safe='')
        while state.get('status') not in ('completed','failed'):
            if time.monotonic()>deadline: raise ValueError('视频生成超过 30 分钟，请先检查上游任务 '+data['id'])
            time.sleep(self.settings.poll_seconds);state=self.request(m,paths.get('video_status','/videos/{id}').replace('{id}',upstream_id))
        if state['status']=='failed': raise ValueError(self.redact(state.get('error',{}).get('message','视频生成失败'),self.vault.decrypt(m['secret'])))
        raw,_=self.request(m,paths.get('video_content','/videos/{id}/content').replace('{id}',upstream_id),raw=True)
        return [self.save(raw,'video')]
