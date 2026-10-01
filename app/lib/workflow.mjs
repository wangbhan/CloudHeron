export const nodeTypes={prompt_input:{name:'提示词输入',output:'text'},reference_asset:{name:'参考资产',output:'reference'},prompt_agent:{name:'提示词 Agent',output:'text'},image_generate:{name:'图片生成',output:'image'},video_generate:{name:'视频生成',output:'video'},media_output:{name:'产物输出',output:'media'}};
export function validateWorkflow(w) {
  if(!w||w.schema_version!=='1.0'||!Array.isArray(w.nodes)||!Array.isArray(w.edges)||w.nodes.length<1||w.nodes.length>100||w.edges.length>300)throw Error('工作流须为 schema_version 1.0，包含 1–100 个节点与最多 300 条连线');
  const nodes=new Map();
  for(const n of w.nodes){
    if(!n||!/^[-\w]{1,80}$/.test(n.id)||nodes.has(n.id)||!nodeTypes[n.type])throw Error('节点编号重复、格式有误或类型未支持');
    if(!n.params||typeof n.params!=='object'||Array.isArray(n.params))throw Error('节点参数须为对象');
    if(!n.position||!Number.isFinite(n.position.x)||!Number.isFinite(n.position.y)||n.position.x<0||n.position.y<0||n.position.x>10000||n.position.y>10000)throw Error('节点位置须为 0–10000 的有效画布坐标');
    for(const key of ['prompt','model_id','asset_id','size'])if(n.params[key]!==undefined&&typeof n.params[key]!=='string')throw Error('节点 '+n.id+' 的 '+key+' 参数须为文本');
    if(n.params.seconds!==undefined&&(!Number.isFinite(n.params.seconds)||n.params.seconds<1||n.params.seconds>120))throw Error('视频时长须为 1–120 秒');
    if(n.params.seed!==undefined&&n.params.seed!==''&&!Number.isSafeInteger(n.params.seed))throw Error('随机种子须为有效整数');
    if(n.params.skill_ids&&(!Array.isArray(n.params.skill_ids)||n.params.skill_ids.length>20))throw Error('Skill 参数须为数组，最多 20 项');
    nodes.set(n.id,n);
  }
  const keys=new Set(),degree=new Map(w.nodes.map(n=>[n.id,0]));
  for(const e of w.edges){
    if(!nodes.has(e.source)||!nodes.has(e.target)||e.source===e.target)throw Error('连线引用不存在的节点或连接自身');
    const k=e.source+'>'+e.target;if(keys.has(k))throw Error('重复连线');keys.add(k);
    const s=nodes.get(e.source),t=nodes.get(e.target),out=nodeTypes[s.type].output;
    const allowed={prompt_input:[],reference_asset:[],prompt_agent:['text'],image_generate:['text','image','reference'],video_generate:['text','image','video','reference'],media_output:['image','video','media','reference']};
    if(!allowed[t.type].includes(out))throw Error(`${s.label||s.id} → ${t.label||t.id} 的输入输出类型不匹配`);
    degree.set(e.target,degree.get(e.target)+1);
  }
  const queue=w.nodes.filter(n=>degree.get(n.id)===0).map(n=>n.id),order=[];
  while(queue.length){const id=queue.shift();order.push(nodes.get(id));for(const e of w.edges.filter(e=>e.source===id)){degree.set(e.target,degree.get(e.target)-1);if(!degree.get(e.target))queue.push(e.target);}}
  if(order.length!==w.nodes.length)throw Error('工作流存在循环连线');
  return order;
}
export function template(name='图片创作') {
  return {schema_version:'1.0',name,nodes:[
    {id:'prompt',type:'prompt_input',label:'提示词输入',params:{prompt:''},position:{x:40,y:90}},
    {id:'image',type:'image_generate',label:'图片生成',params:{model_id:'',size:'1024x1024'},position:{x:340,y:90}},
    {id:'output',type:'media_output',label:'产物输出',params:{},position:{x:640,y:90}}
  ],edges:[{source:'prompt',target:'image'},{source:'image',target:'output'}]};
}
export async function executeWorkflow(w,{input={},resolveAsset,generate,chat,onStep}) {
  const order=validateWorkflow(w),values=new Map();
  for(const n of order){
    await onStep(n.id,'running');
    try {
      const inbound=w.edges.filter(e=>e.target===n.id).map(e=>values.get(e.source));
      const texts=inbound.filter(v=>v?.text).map(v=>v.text),media=inbound.flatMap(v=>v?.media||[]);
      const prompt=texts.join('\n')||n.params.prompt||input.prompt||'';
      let out;
      if(n.type==='prompt_input')out={text:input.prompt??n.params.prompt??''};
      else if(n.type==='reference_asset')out={media:[await resolveAsset(n.params.asset_id)]};
      else if(n.type==='prompt_agent')out={text:await chat(n.params.model_id,prompt,n.params)};
      else if(['image_generate','video_generate'].includes(n.type))out={media:await generate(n.type==='image_generate'?'image':'video',n.params.model_id,prompt,media,n.params)};
      else if(n.type==='media_output'){if(!media.length)throw Error('产物输出节点缺少图片或视频输入');out={media};}
      values.set(n.id,out);await onStep(n.id,'completed',out);
    }catch(e){await onStep(n.id,'failed',null,e.message);throw e;}
  }
  const sinks=w.nodes.filter(n=>n.type==='media_output');
  return [...new Map((sinks.length?sinks:w.nodes.filter(n=>!w.edges.some(e=>e.source===n.id))).flatMap(n=>values.get(n.id)?.media||[]).map(a=>[a.id,a])).values()];
}
