const number=(key,label,min,max,integer=false)=>({key,label,type:'number',min,max,integer});
const choice=(key,label,values)=>({key,label,type:'select',values});
const string=(key,label,maxLength=4000)=>({key,label,type:'string',maxLength});
const sampling=[string('negative_prompt','负向提示词'),number('guidance_scale','引导强度 guidance_scale',0,50),number('num_inference_steps','采样步数',1,200,true)];
export const taskOptions={
  image:[number('n','图片数量',1,4,true),choice('quality','质量',['auto','standard','hd','low','medium','high']),choice('style','画面风格',['vivid','natural']),choice('background','背景',['auto','opaque','transparent']),choice('output_format','输出格式',['png','jpeg','webp']),number('output_compression','输出压缩质量',0,100,true),choice('response_format','响应格式',['b64_json','url']),...sampling],
  video:[number('fps','帧率 fps',1,120,true),string('aspect_ratio','宽高比 aspect_ratio',40),...sampling],
  text:[number('temperature','温度 temperature',0,2),number('top_p','概率采样 top_p',0,1),number('top_k','候选数 top_k',1,1000,true),number('max_tokens','最大输出 tokens',1,131072,true),number('presence_penalty','主题惩罚 presence_penalty',-2,2),number('frequency_penalty','重复惩罚 frequency_penalty',-2,2),number('repetition_penalty','重复系数 repetition_penalty',0.01,10),number('seed','文本随机种子',Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,true),{key:'stop',label:'停止词（每行一个，最多 4 个）',type:'lines'}]
};
const reserved=new Set(['model','prompt','messages','stream','size','seconds','seed','image','image[]','input_reference','video_reference','model_id','text_model_id','asset_id','asset_ids','agent','kind','skill_ids','expert_id','project_id','api_params','text_options','authorization','api_key','headers','base_url','paths','reference_fields',...Object.values(taskOptions).flat().map(f=>f.key)]);
const unsafe=new Set(['__proto__','constructor','prototype']);
function validateJson(value,depth=0){
  if(depth>8)throw Error('额外 API 参数嵌套最多 8 层');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error('额外 API 参数数字须为有限值');return;}
  if(Array.isArray(value)){for(const v of value)validateJson(v,depth+1);return;}
  if(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value))){for(const [k,v]of Object.entries(value)){if(unsafe.has(k))throw Error('额外 API 参数包含无效字段');validateJson(v,depth+1);}return;}
  throw Error('额外 API 参数须为有效 JSON 数据');
}
export function normalizeApiOptions(kind,raw={},{referenceFields=[]}={}){
  if(!taskOptions[kind]||!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('API 配置须为对象');
  const out={};
  for(const f of taskOptions[kind]){
    const v=raw[f.key];if(v===undefined||v==='')continue;
    if(f.type==='number'){if(typeof v!=='number'||!Number.isFinite(v)||v<f.min||v>f.max||(f.integer&&!Number.isSafeInteger(v)))throw Error(`${f.label}须为 ${f.min}–${f.max} 的${f.integer?'整数':'数值'}`);}
    else if(f.type==='select'){if(!f.values.includes(v))throw Error(f.label+'选项有误');}
    else if(f.type==='lines'){if(!Array.isArray(v)||!v.length||v.length>4||v.some(s=>typeof s!=='string'||!s.length||s.length>200))throw Error('停止词须为 1–4 个文本，每项最多 200 字');}
    else if(typeof v!=='string'||v.length>f.maxLength)throw Error(f.label+'格式有误或过长');
    out[f.key]=structuredClone(v);
  }
  if(raw.api_params!==undefined){
    const custom=raw.api_params;if(!custom||typeof custom!=='object'||Array.isArray(custom))throw Error('额外 API 参数须为 JSON 对象');validateJson(custom);
    if(JSON.stringify(custom).length>16000)throw Error('额外 API 参数最多 16000 个字符');
    const blocked=new Set([...reserved,...referenceFields].map(s=>s.toLowerCase()));
    for(const k of Object.keys(custom))if(!/^[-a-zA-Z0-9_\[\]]{1,80}$/.test(k)||blocked.has(k.toLowerCase()))throw Error('额外 API 参数不能覆盖受控字段：'+k);
    if(Object.keys(custom).length)out.api_params=structuredClone(custom);
  }
  return out;
}
export function requestOptions(kind,params,spec){
  const options=normalizeApiOptions(kind,params,{referenceFields:Object.values(spec.reference_fields||{})});
  const {api_params={},...standard}=options;
  return {...spec.extra,...api_params,...standard};
}
export function validateReferenceField(name){return typeof name==='string'&&/^[-a-zA-Z0-9_\[\]]{1,80}$/.test(name)&&(!reserved.has(name.toLowerCase())||['image','image[]','input_reference','video_reference'].includes(name))&&!unsafe.has(name);}
