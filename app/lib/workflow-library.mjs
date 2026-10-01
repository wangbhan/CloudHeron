import {template, validateWorkflow} from './workflow.mjs';

export const librarySchema = `
  CREATE TABLE IF NOT EXISTS workflow_versions (
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    revision INTEGER NOT NULL,
    document TEXT NOT NULL,
    actor_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    source_revision INTEGER,
    saved_at TEXT NOT NULL,
    PRIMARY KEY (workflow_id,revision)
  );
  CREATE TABLE IF NOT EXISTS workflow_templates (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    owner_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    document TEXT NOT NULL,
    source_workflow_id TEXT REFERENCES workflows(id),
    source_revision INTEGER,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS workflow_templates_project ON workflow_templates(project_id);
`;

const image = template('图片生成模板');
image.nodes[0].params.prompt='描述主体、环境、光线和构图';
const video = template('视频生成模板');
video.nodes[0].params.prompt='描述主体动作、镜头运动和环境';
Object.assign(video.nodes[1],{id:'video',type:'video_generate',label:'视频生成',params:{model_id:'',size:'1280x720',seconds:4}});
video.edges=[{source:'prompt',target:'video'},{source:'video',target:'output'}];
const imageVideo=template('图片转视频模板');
imageVideo.nodes[0].params.prompt='先生成白鹭云海画面，再生成白鹭展翅的动作';
imageVideo.nodes.splice(2,0,{id:'video_prompt',type:'prompt_input',label:'视频动作描述',params:{prompt:'白鹭缓慢展翅，镜头平稳跟随'},position:{x:340,y:310}},{id:'video',type:'video_generate',label:'参考生成图片制作视频',params:{model_id:'',size:'1280x720',seconds:4},position:{x:650,y:90}});
imageVideo.nodes.at(-1).position={x:960,y:90};
imageVideo.edges=[{source:'prompt',target:'image'},{source:'image',target:'video'},{source:'video_prompt',target:'video'},{source:'video',target:'output'}];

export const builtinTemplates = [
  ['builtin_image',image,'提示词 → 图片生成 → 产物输出'],
  ['builtin_video',video,'提示词 → 视频生成 → 产物输出'],
  ['builtin_image_video',imageVideo,'先生成图片，将实际图片传给视频节点，再输出视频']
].map(([id,document,description])=>{
  validateWorkflow(document);
  return {id,name:document.name,description,document:JSON.stringify(document),project_id:null,builtin:true,revision:1};
});

export function copyTemplate(document,name,{keepBindings=false}={}) {
  const copy=structuredClone(document);
  copy.name=name;
  for(const node of copy.nodes){
    if(!keepBindings){
      if('model_id' in node.params)node.params.model_id='';
      if('asset_id' in node.params)node.params.asset_id='';
    }
  }
  validateWorkflow(copy);
  return copy;
}
