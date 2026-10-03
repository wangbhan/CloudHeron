import {requestOptions,validateReferenceField} from './api-options.mjs';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
const PRIVATE=/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/;
const privateIP=a=>PRIVATE.test(a)||a==='::1'||a==='::'||/^f[cd]/i.test(a)||/^fe[89ab]/i.test(a)||a.includes(':');
export function validateModel(spec) {
  const u=new URL(spec.base_url);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('模型地址须为 HTTP(S) 服务根地址，凭据请填入密钥字段');
  if(!['OpenAI','vLLM','vLLM-Omni','SGLang'].includes(spec.protocol))throw Error('请选择支持的协议');
  if(!Array.isArray(spec.capabilities)||!spec.capabilities.length||spec.capabilities.some(c=>!['text','image','video','image_edit','video_reference'].includes(c)))throw Error('模型任务能力有误');
  if(spec.capabilities.includes('image_edit')&&!spec.capabilities.includes('image'))throw Error('参考图片编辑能力需要同时启用图片能力');
  if(typeof spec.model!=='string'||!spec.model.trim())throw Error('请输入上游模型名称');
  if(spec.capabilities.includes('video_reference')&&!spec.capabilities.includes('video'))throw Error('参考视频能力需要同时启用视频能力');
  if(spec.video_format&&!['multipart','json'].includes(spec.video_format))throw Error('视频请求格式有误');
  if(spec.reference_fields){if(typeof spec.reference_fields!=='object'||Array.isArray(spec.reference_fields)||Object.keys(spec.reference_fields).some(k=>!['image','video'].includes(k))||Object.values(spec.reference_fields).some(v=>!validateReferenceField(v)))throw Error('参考字段须为 image/video 对应的独立字段名');}
  if(spec.format&&!['multipart','json'].includes(spec.format))throw Error('请求格式有误');
  for(const value of Object.values(spec.paths||{}))if(typeof value!=='string'||!/^\/[a-zA-Z0-9_\-/{}/]+$/.test(value)||value.includes('..'))throw Error('接口路径须为 / 开头的相对路径');
  if(spec.extra&&(typeof spec.extra!=='object'||Array.isArray(spec.extra)))throw Error('附加参数须为 JSON 对象');
  if(JSON.stringify(spec.extra||{}).length>16000)throw Error('附加参数过长');
  return spec;
}
async function limited(response, max) {
  if(Number(response.headers.get('content-length'))>max)throw Error('模型返回文件超过大小上限');
  const chunks=[];let size=0;
  for await(const c of response.body){size+=c.length;if(size>max)throw Error('模型返回文件超过大小上限');chunks.push(c);}
  return Buffer.concat(chunks);
}
export function provider({secret,loadMedia,saveMedia,pollMs=2500}) {
  const redact=(v,key)=>String(v||'').replaceAll(key||'__NO_SECRET__','[凭据已隐藏]').replace(/Bearer\s+[\w.-]+/gi,'Bearer [凭据已隐藏]').slice(0,400);
  function url(spec,path) {return new URL(spec.base_url.replace(/\/$/,'')+path);}
  async function request(model,path,{method='GET',body,raw=false}={}) {
    const spec=JSON.parse(model.spec),key=secret(model.secret),headers={};if(key)headers.authorization='Bearer '+key;
    if(body&&!(body instanceof FormData)){headers['content-type']='application/json';body=JSON.stringify(body);}
    let r;try{r=await fetch(url(spec,path),{method,body,headers,redirect:'error',signal:AbortSignal.timeout(180000)});}catch{throw Error('模型服务连接失败或超时，请检查地址及服务状态');}
    if(!r.ok){const message=(await limited(r,4096)).toString();throw Error(`模型 HTTP ${r.status}：${redact(message,key)}`);}
    if(raw)return {data:await limited(r,100*1024*1024),mime:r.headers.get('content-type')?.split(';')[0]||'application/octet-stream'};
    const data=await limited(r,32*1024*1024);try{return JSON.parse(data);}catch{throw Error('模型未返回有效 JSON，请检查接口路径与请求格式');}
  }
  async function chat(model,messages,params={}) {
    const spec=JSON.parse(model.spec);if(!spec.capabilities.includes('text'))throw Error('所选模型未启用文本能力');
    const data=await request(model,spec.paths?.text||'/chat/completions',{method:'POST',body:{...requestOptions('text',params,spec),model:spec.model,messages,stream:false}});
    const content=data.choices?.[0]?.message?.content;if(typeof content!=='string'||!content.trim())throw Error('文本模型响应缺少 choices[0].message.content');return content;
  }
  async function download(model,value,kind) {
    if(value.b64_json){const data=Buffer.from(value.b64_json,'base64');if(!data.length||data.length>100*1024*1024)throw Error('生成文件为空或过大');return saveMedia(data,kind,value.mime_type|| (kind==='image'?'image/png':'video/mp4'));}
    if(!value.url)throw Error('模型响应未包含 b64_json 或 url');
    const spec=JSON.parse(model.spec),u=new URL(value.url);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('模型返回的媒体地址有误');
    const own=u.origin===new URL(spec.base_url).origin;
    if(!own){if(u.protocol!=='https:')throw Error('外部媒体须为 HTTPS 地址');const addrs=isIP(u.hostname)?[{address:u.hostname}]:await lookup(u.hostname,{all:true});if(!addrs.length||addrs.some(a=>privateIP(a.address)))throw Error('外部媒体地址须为公开地址');}
    const key=secret(model.secret),headers=own&&key?{authorization:'Bearer '+key}:{};
    const r=await fetch(u,{headers,redirect:'error',signal:AbortSignal.timeout(180000)});if(!r.ok)throw Error('生成成功，但媒体下载失败：HTTP '+r.status);
    return saveMedia(await limited(r,100*1024*1024),kind,r.headers.get('content-type')?.split(';')[0]||(kind==='image'?'image/png':'video/mp4'));
  }
  async function generate(model,kind,prompt,refs=[],params={}) {
    const spec=JSON.parse(model.spec);if(!spec.capabilities.includes(kind))throw Error(`模型未启用 ${kind==='image'?'图片':'视频'} 能力`);
    if(!prompt?.trim())throw Error('请填写画面提示词');
    if(refs.some(a=>!a.mime.startsWith('image/')&&!a.mime.startsWith('video/')))throw Error('参考输入须为图片或视频');
    if(kind==='image'&&refs.some(a=>a.mime.startsWith('video/')))throw Error('图片生成仅支持参考图片；参考视频请使用视频 Agent 或视频生成节点');
    if(kind==='video'&&refs.some(a=>a.mime.startsWith('video/'))&&!spec.capabilities.includes('video_reference'))throw Error('所选模型未启用参考视频能力，请配置支持视频输入的模型并启用该能力');
    if(kind==='image'&&refs.length&&!spec.capabilities.includes('image_edit'))throw Error('所选图片模型未启用参考图片／编辑能力');
    let path=kind==='video'?(spec.paths?.video||'/videos'):(refs.length?spec.paths?.edit||'/images/edits':spec.paths?.image||'/images/generations');
    const values={...requestOptions(kind,params,spec),model:spec.model,prompt};if(params.size)values.size=params.size;
    if(kind==='video')values.seconds=String(params.seconds||4);
    if(params.seed!==undefined&&params.seed!=='')values.seed=Number(params.seed);
    let body=values;
    const referenceField=a=>a.mime.startsWith('video/')?(spec.reference_fields?.video||'video_reference'):(spec.reference_fields?.image||'input_reference');
    const videoJson=kind==='video'&&spec.video_format==='json';
    if(videoJson){
      const groups={};for(const a of refs){const field=referenceField(a);(groups[field]||=[]).push(`data:${a.mime};base64,${(await loadMedia(a)).toString('base64')}`);}
      for(const [field,items]of Object.entries(groups))body[field]=items.length===1?items[0]:items;
    }else if(kind==='video'||refs.length||spec.format==='multipart'){
      const f=new FormData();for(const [k,v]of Object.entries(values))if(v!==undefined&&v!==null)f.append(k,typeof v==='object'?JSON.stringify(v):String(v));
      for(const [i,a]of refs.entries()){const data=await loadMedia(a);f.append(kind==='video'?referenceField(a):(refs.length>1?'image[]':'image'),new Blob([data],{type:a.mime}),`reference-${i}.${a.mime.split('/')[1]}`);}
      body=f;
    }
    const data=await request(model,path,{method:'POST',body});
    if(kind==='image'){if(!Array.isArray(data.data)||!data.data.length)throw Error('图像模型响应缺少 data 数组');return Promise.all(data.data.slice(0,4).map(v=>download(model,v,'image')));}
    if(data.data?.length)return Promise.all(data.data.slice(0,1).map(v=>download(model,v,'video')));
    if(!data.id)throw Error('视频接口须返回异步任务 id 或 data[].url/b64_json');
    const deadline=Date.now()+30*60*1000;let state=data;
    while(!['completed','failed'].includes(state.status)){
      if(Date.now()>deadline)throw Error('视频生成超过 30 分钟；上游任务 '+data.id+' 可能仍在运行，请检查服务后再重试');
      await new Promise(r=>setTimeout(r,pollMs));state=await request(model,(spec.paths?.video_status||'/videos/{id}').replace('{id}',encodeURIComponent(data.id)));
    }
    if(state.status==='failed')throw Error(redact(state.error?.message||'上游视频生成失败',secret(model.secret)));
    const out=await request(model,(spec.paths?.video_content||'/videos/{id}/content').replace('{id}',encodeURIComponent(data.id)),{raw:true});
    return [await saveMedia(out.data,'video',out.mime)];
  }
  return {request,chat,generate};
}
