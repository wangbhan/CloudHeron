import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {id} from './security.mjs';
import {template} from './workflow.mjs';
import {agents} from './agents.mjs';
import {librarySchema} from './workflow-library.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
export const manualCaseSchema=`CREATE TABLE IF NOT EXISTS project_test_cases (project_id TEXT NOT NULL REFERENCES projects(id),test_id TEXT NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(project_id,test_id))`;

export function seedManualWorkspace(d,u){
  const key='manual_workspace_'+u.id,existing=d.one('SELECT value FROM meta WHERE key=?',key),old=existing?JSON.parse(existing.value):null;
  const cases=JSON.parse(readFileSync(join(root,'public/test-cases.json'),'utf8')),written=[];
  d.db.exec(manualCaseSchema);
  d.db.exec(librarySchema);
  d.run("INSERT OR IGNORE INTO workflow_versions(workflow_id,revision,document,action,saved_at) SELECT id,revision,document,'baseline',updated_at FROM workflows");
  try{return d.tx(()=>{
    const now=new Date().toISOString();
    const out=old&&d.one('SELECT id FROM projects WHERE id=?',old.project_id)?old:{project_id:id('project'),workflows:{},chats:{}};
    if(!d.one('SELECT id FROM projects WHERE id=?',out.project_id))d.run('INSERT INTO projects(id,name,owner_id,visibility,created_at) VALUES(?,?,?,?,?)',out.project_id,'功能验收测试项目',u.id,'team',now);
    out.assets=out.assets||[];
    for(const [i,name,kind,source]of [[0,'测试参考 · 云鹭角色','character','cloudheron-icon.png'],[1,'测试参考 · 云海场景','scene','cloudheron-login-scene.png']]){
      if(out.assets[i]&&d.one('SELECT id FROM assets WHERE id=?',out.assets[i]))continue;
      const aid=id('asset'),file=aid+'.png',target=join(d.dir,'media',file);writeFileSync(target,readFileSync(join(root,'public/assets',source)),{flag:'wx',mode:0o600});written.push(target);
      d.run('INSERT INTO assets(id,project_id,owner_id,name,kind,visibility,mime,file,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',aid,out.project_id,u.id,name,kind,'team','image/png',file,JSON.stringify({family_id:aid,source:'manual_test_fixture',description:'预置参考测试文件，来自用户确认的云鹭品牌素材；不是模型生成产物。'}),now);out.assets[i]=aid;
    }
    for(const [kind,name]of [['image','TST-004/005/010 · 图片工作流'],['video','TST-015 · 视频工作流'],['reference','TST-016 · 参考资产工作流'],['error','TST-009 · 未配置模型报错']]){
      if(out.workflows[kind]&&d.one('SELECT id FROM workflows WHERE id=?',out.workflows[kind]))continue;
      const w=template(name);w.nodes[0].params.prompt='白鹭飞过云海，柔和晨光，远处青山';
      if(kind==='video'){w.nodes[1].id='video';w.nodes[1].type='video_generate';w.nodes[1].label='视频生成';w.nodes[1].params={model_id:'',size:'1280x720',seconds:4,skill_ids:['skill_motion']};w.edges=[{source:'prompt',target:'video'},{source:'video',target:'output'}];}
      if(kind==='reference'){w.nodes.push({id:'reference',type:'reference_asset',label:'云鹭角色参考 v1',params:{asset_id:out.assets[0]},position:{x:40,y:310}});w.edges.push({source:'reference',target:'image'});w.nodes[1].params.skill_ids=['skill_reference'];}
      if(kind==='error')w.nodes[0].params.prompt='测试预期：图片生成节点因未配置模型报错，后续输出节点停止。';
      const wid=id('wf');d.run('INSERT INTO workflows(id,project_id,name,document,updated_at) VALUES(?,?,?,?,?)',wid,out.project_id,name,JSON.stringify(w),now);d.run('INSERT INTO workflow_versions(workflow_id,revision,document,actor_id,action,saved_at) VALUES(?,1,?,?,?,?)',wid,JSON.stringify(w),u.id,'create',now);out.workflows[kind]=wid;
    }
    for(const a of agents){
      if(out.chats[a.id]&&d.one('SELECT id FROM chats WHERE id=?',out.chats[a.id]))continue;
      const cid=id('chat'),target=a.id==='prompt'?'video':a.id;
      const config={...a.defaults,agent:a.id,kind:target,model_id:'',expert_id:'expert_'+a.id,additional_skill_ids:[],skill_ids:[],asset_ids:a.id==='prompt'?[]:[out.assets[0]]};
      const sample=a.id==='video'?'白鹭缓慢展翅起飞，镜头向上跟随，4 秒':a.id==='prompt'?'请整理一个白鹭穿过云海的 4 秒视频提示词':'参考云鹭角色，在云海青山背景中生成柔光画面';
      const text=`【预置测试说明，尚未调用模型】\n测试 ${a.name} 的配置、专家选择与对话历史。请在右侧选择真实模型后发送以下内容：\n${sample}\n预期：${a.id==='prompt'?'返回文字提示词，不产生媒体资产':'返回可预览和下载的'+(a.id==='video'?'视频':'图片')+'，加入本测试项目与资产库'}。`;
      d.run('INSERT INTO chats(id,project_id,title,messages,updated_at) VALUES(?,?,?,?,?)',cid,out.project_id,(a.id==='image'?'TST-011/013':a.id==='video'?'TST-015':'TST-014')+' · '+a.name,JSON.stringify([{id:id('msg'),role:'system',text,config,at:now}]),now);out.chats[a.id]=cid;
    }
    const entries={
      'TST-001':'#projects/'+out.project_id,'TST-002':'#projects/'+out.project_id,'TST-003':'#workflow',
      'TST-004':'#workflow/'+out.workflows.image,'TST-005':'#workflow/'+out.workflows.image,'TST-006':'#workflow/'+out.workflows.image,
      'TST-007':'#workflow/'+out.workflows.image,'TST-008':'#workflow/'+out.workflows.image,'TST-009':'#workflow/'+out.workflows.error,
      'TST-010':'#workflow/'+out.workflows.image,'TST-011':'#create/'+out.chats.image,'TST-012':'#skills','TST-013':'#create/'+out.chats.image,
      'TST-043':'#models','TST-044':'#models','TST-045':'#create/'+out.chats.video,
      'TST-014':'#create/'+out.chats.prompt,'TST-015':'#create/'+out.chats.video,'TST-016':'#workflow/'+out.workflows.reference,
      'TST-017':'#projects/'+out.project_id,'TST-018':'#team','TST-019':'#api','TST-020':'#testing/'+out.project_id,'TST-021':'#workflow','TST-022':'#create/'+out.chats.image,'TST-023':'#create/'+out.chats.video,'TST-024':'#workflow/templates','TST-025':'#workflow/'+out.workflows.image,'TST-026':'#workflow/'+out.workflows.image,'TST-027':'#workflow/'+out.workflows.image,'TST-028':'#workflow/'+out.workflows.image,'TST-029':'#create/'+out.chats.image,'TST-030':'#create/'+out.chats.video,'TST-031':'#workflow/'+out.workflows.image,'TST-032':'#workflow/'+out.workflows.image
    };
    for(const c of cases)d.run('INSERT INTO project_test_cases(project_id,test_id,definition) VALUES(?,?,?) ON CONFLICT(project_id,test_id) DO UPDATE SET definition=excluded.definition',out.project_id,c.id,JSON.stringify({...c,entry_path:entries[c.id]}));
    out.case_ids=cases.map(c=>c.id);out.name=d.one('SELECT name FROM projects WHERE id=?',out.project_id).name;
    d.run('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',key,JSON.stringify(out));return out;
  });}catch(e){for(const file of written)try{unlinkSync(file);}catch{}throw e;}
}
