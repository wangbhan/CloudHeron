export const agents = [
  {id:'image',name:'图片 Agent',description:'组织画面与参考图，调用图片模型。',model_capability:'image',fields:['model_id','text_model_id','asset_ids','expert_id','skill_ids','size','seed'],defaults:{size:'1024x1024'}},
  {id:'video',name:'视频 Agent',description:'组织动作与运镜，调用视频模型。',model_capability:'video',fields:['model_id','text_model_id','asset_ids','expert_id','skill_ids','size','seconds','seed'],defaults:{size:'1280x720',seconds:4}},
  {id:'prompt',name:'提示词 Agent',description:'整理图片或视频提示词，返回文字。',model_capability:'text',fields:['model_id','kind','expert_id','skill_ids'],defaults:{kind:'image'}}
];


export function normalizeChatConfig(raw, {getModel,getSkill,getExpert}) {
  const agent=agents.find(a=>a.id===raw?.agent);
  if(!agent)throw Error('请选择有效 Agent');
  const kind=agent.id==='prompt'?(raw.kind||'image'):agent.id;
  if(!['image','video'].includes(kind))throw Error('请选择图片或视频提示词用途');
  const model=getModel(raw.model_id);
  if(!JSON.parse(model.spec).capabilities.includes(agent.model_capability))throw Error('所选模型不支持此 Agent 的任务');
  const cfg={agent:agent.id,kind,model_id:raw.model_id,asset_ids:[],skill_ids:[]};
  if(agent.id!=='prompt'){
    cfg.asset_ids=raw.asset_ids||[];
    if(!Array.isArray(cfg.asset_ids)||cfg.asset_ids.length>8||cfg.asset_ids.some(x=>typeof x!=='string'))throw Error('参考资产列表有误');
    cfg.text_model_id=raw.text_model_id||'';
    if(cfg.text_model_id&&!JSON.parse(getModel(cfg.text_model_id).spec).capabilities.includes('text'))throw Error('理解对话需要文本模型');
    cfg.size=raw.size||agent.defaults.size;
    if(typeof cfg.size!=='string'||cfg.size.length>80)throw Error('分辨率格式有误');
    if(raw.seed!==undefined&&raw.seed!==''){if(!Number.isSafeInteger(Number(raw.seed)))throw Error('随机种子须为整数');cfg.seed=Number(raw.seed);}
    if(agent.id==='video'){cfg.seconds=Number(raw.seconds??4);if(!Number.isFinite(cfg.seconds)||cfg.seconds<1||cfg.seconds>120)throw Error('视频时长须为 1–120 秒');}
  }
  const additional=raw.skill_ids||[];
  if(!Array.isArray(additional)||additional.length>20||additional.some(x=>typeof x!=='string'))throw Error('Skill 列表有误');
  let ordered=[];
  if(raw.expert_id){
    const expert=getExpert(raw.expert_id);
    if(!expert||!['all',agent.id].includes(expert.task))throw Error('专家不存在或不适用于此 Agent');
    ordered=JSON.parse(expert.skill_ids);
    cfg.expert_id=expert.id;
    cfg.expert_snapshot={name:expert.name,skill_ids:[...ordered]};
  }
  cfg.additional_skill_ids=[...new Set(additional)];
  cfg.skill_ids=[...new Set([...ordered,...additional])];
  if(cfg.skill_ids.length>20)throw Error('专家与附加 Skill 合计最多 20 项');
  for(const sid of cfg.skill_ids){const s=getSkill(sid);if(!s)throw Error('Skill 不存在');}
  return cfg;
}
