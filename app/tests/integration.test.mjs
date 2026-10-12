import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {template} from '../lib/workflow.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKwAAAABJRU5ErkJggg==','base64');
const video=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom000000000000')]);
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r('http://127.0.0.1:'+server.address().port)));
test('真实 HTTP 与 SQLite 集成（上游仅为测试夹具）',async t=>{
  let proposalDoc,generateCalls=0,lastVideoBody='',lastImageBody='',lastTextBody='',lastImageType='',lastVideoType='',lastImageBytes,lastVideoBytes,failImage=false;
  const fixture=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),raw=bytes.toString();
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'fixture'}]}));
    if(req.url==='/v1/chat/completions'){lastTextBody=raw;const b=JSON.parse(raw),modify=b.messages[0].content.includes('explanation');return res.end(JSON.stringify({choices:[{message:{content:modify?JSON.stringify({explanation:'雨夜改为晨曦',document:proposalDoc}):'明亮的晨曦画面'}}]}));}
    if(req.url==='/v1/images/generations'||req.url==='/v1/images/edits'){generateCalls++;lastImageBody=raw;lastImageType=req.headers['content-type'];lastImageBytes=bytes;if(failImage){res.statusCode=500;return res.end(JSON.stringify({error:'fixture-secret'}));}const values=lastImageType.includes('multipart')?Object.fromEntries(await new Response(bytes,{headers:{'content-type':lastImageType}}).formData()):JSON.parse(raw);if(values.fixture_fail){res.statusCode=422;return res.end(JSON.stringify({error:'unsupported parameter fixture_fail'}));}return res.end(JSON.stringify({data:Array.from({length:Number(values.n||1)},()=>({b64_json:png.toString('base64')}))}));}
    if(req.url==='/v1/videos'&&req.method==='POST'){generateCalls++;lastVideoBody=raw;lastVideoType=req.headers['content-type'];lastVideoBytes=bytes;return res.end(JSON.stringify({id:'fixture-video',status:'queued'}));}
    if(req.url==='/v1/videos/fixture-video')return res.end(JSON.stringify({id:'fixture-video',status:'completed'}));
    if(req.url==='/v1/videos/fixture-video/content'){res.setHeader('Content-Type','video/mp4');return res.end(video);}
    res.statusCode=404;res.end('{}');
  });
  const upstream=await listen(fixture),dir=await mkdtemp(join(tmpdir(),'cloudheron-test-')),app=createApp({dataDir:dir,pollMs:1}),base=await listen(app.server);let adminCookie,editorCookie,viewerCookie,adminId,editorId,viewerId,p,modelId,wf,chat,aid,pub;
  const call=async(path,method='GET',data,cookie=adminCookie,headers={})=>{const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json','X-CloudHeron':'1',...(cookie?{cookie}:{}),...headers},...(data!==undefined?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const done=async jid=>{for(let i=0;i<100;i++){const r=await call('jobs/'+jid);if(['failed','completed'].includes(r.body.status))return r.body;await new Promise(r=>setTimeout(r,20));}throw Error('任务未在开发验证期限内结束');};
  try{
    await t.test('首次初始化只允许一次，认证持久化且会话不含密码',async()=>{
      assert.equal((await call('bootstrap')).body.setup_required,true);assert.equal(app.db.one('SELECT COUNT(*) n FROM projects').n,0);
      const r=await call('setup','POST',{team:'测试团队',name:'管理员',email:'admin@fixture.test',password:'fixture-password-123'},null);assert.equal(r.status,201);adminCookie=r.cookie;adminId=r.body.user.id;
      assert.equal('password'in r.body.user,false);assert.equal((await call('setup','POST',{team:'x',name:'x',email:'x@fixture.test',password:'fixture-password-123'})).status,409);
      assert.equal((await call('login','POST',{email:'admin@fixture.test',password:'wrong'},null)).status,401);assert.equal((await call('me','GET',undefined,'cloudheron=forged')).status,401);
      assert.equal((await call('me')).body.team,'测试团队');
    });
    await t.test('一次性邀请与查看者权限上限',async()=>{
      for(const [role,email]of [['editor','editor@fixture.test'],['viewer','viewer@fixture.test']]){const r=await call('users','POST',{name:role,email,role});const tok=r.body.invite_path.split('/').at(-1);const join=await call('join','POST',{token:tok,password:'fixture-password-123'},null);assert.equal(join.status,200);if(role==='editor'){editorCookie=join.cookie;editorId=join.body.user.id;}else{viewerCookie=join.cookie;viewerId=join.body.user.id;}assert.equal((await call('join','POST',{token:tok,password:'fixture-password-123'},null)).status,400);}
      assert.equal((await call('projects','POST',{name:'viewer-project',visibility:'team'},viewerCookie)).status,403);
    });
    await t.test('项目与资产访问隔离，ACL 编辑受角色限制',async()=>{
      const r=await call('projects','POST',{name:'私有项目',visibility:'private'});p=r.body;
      assert.equal((await call('projects/'+p.id+'/contents','GET',undefined,editorCookie)).status,403);
      await call('projects/'+p.id,'PATCH',{name:p.name,visibility:'private',acl:{[editorId]:'edit',[viewerId]:'edit'}});
      const a=await call('assets','POST',{project_id:p.id,name:'参考角色',kind:'character',visibility:'team',mime:'image/png',filename:'reference.png',base64:png.toString('base64')});assert.equal(a.status,201);aid=a.body.id;
      assert.equal((await call('assets','GET',undefined,editorCookie)).body.length,1);
      const outsider=await call('projects','POST',{name:'独立私有项目',visibility:'private'},editorCookie);assert.equal((await call('projects/'+outsider.body.id+'/contents','GET',undefined,viewerCookie)).status,403);
      assert.equal((await call('assets','POST',{project_id:p.id,name:'bad',kind:'image',visibility:'team',mime:'image/png',filename:'bad.png',base64:Buffer.from('not-a-real-image').toString('base64')})).status,400);
    });
    await t.test('模型凭据加密、掩码、连接测试，编辑者无配置权限',async()=>{
      const m=await call('models','POST',{name:'夹具模型',api_key:'fixture-secret',spec:{protocol:'vLLM-Omni',base_url:upstream+'/v1',model:'fixture',capabilities:['text','image','image_edit','video']}});assert.equal(m.status,201);modelId=m.body.id;
      assert.equal(JSON.stringify((await call('models')).body).includes('fixture-secret'),false);assert.equal(app.db.one('SELECT secret FROM models WHERE id=?',modelId).secret.includes('fixture-secret'),false);
      assert.equal((await call('models/'+modelId+'/check','POST',{})).body.ok,true);assert.equal((await call('models','POST',{},editorCookie)).status,403);
    });
    await t.test('JSON 保存、版本冲突与查看者禁止运行',async()=>{
      const doc=template('集成工作流');doc.nodes[0].params.prompt='雨夜';doc.nodes[1].params.model_id=modelId;
      const r=await call('workflows','POST',{name:doc.name,project_id:p.id,document:doc},editorCookie);assert.equal(r.status,201);wf=r.body;
      assert.equal((await call('workflows/'+wf.id+'/run','POST',{revision:wf.revision},viewerCookie)).status,403);
      const saved=await call('workflows/'+wf.id,'PUT',{revision:wf.revision,document:doc});assert.equal(saved.status,200);wf=saved.body;
      assert.equal((await call('workflows/'+wf.id,'PUT',{revision:1,document:doc})).status,409);
    });
    await t.test('AI 分析不改配置；整批确认只修改，不执行任务',async()=>{
      const before=app.db.one('SELECT COUNT(*) n FROM jobs').n,calls=generateCalls;
      const analyzed=await call('workflows/'+wf.id+'/assist','POST',{mode:'analyze',model_id:modelId,prompt:'分析流程'});assert.equal(analyzed.status,200);assert.equal((await call('workflows/'+wf.id)).body.revision,wf.revision);
      proposalDoc=structuredClone(wf.document);proposalDoc.nodes[0].params.prompt='晨曦';
      const r=await call('workflows/'+wf.id+'/assist','POST',{mode:'modify',model_id:modelId,prompt:'改成晨曦'});assert.equal(r.status,200);
      assert.equal((await call('workflows/'+wf.id)).body.document.nodes[0].params.prompt,'雨夜');
      const confirmed=await call('proposals/'+r.body.id+'/confirm','POST',{});assert.equal(confirmed.status,200);wf=confirmed.body;
      assert.equal(wf.document.nodes[0].params.prompt,'晨曦');assert.equal(app.db.one('SELECT COUNT(*) n FROM jobs').n,before);assert.equal(generateCalls,calls);const versions=(await call('workflows/'+wf.id+'/versions')).body;assert.equal(versions[0].action,'ai_modify');assert.equal(versions.length,wf.revision);assert.equal((await call('workflows/'+wf.id+'/versions/'+wf.revision)).body.document.nodes[0].params.prompt,'晨曦');
      assert.equal((await call('proposals/'+r.body.id+'/confirm','POST',{})).status,409);
      const stale=await call('workflows/'+wf.id+'/assist','POST',{mode:'modify',model_id:modelId,prompt:'修改'});wf=(await call('workflows/'+wf.id,'PUT',{revision:wf.revision,document:wf.document})).body;assert.equal((await call('proposals/'+stale.body.id+'/confirm','POST',{})).status,409);
    });
    await t.test('显式运行生成媒体，项目产物区分来源',async()=>{
      const r=await call('workflows/'+wf.id+'/run','POST',{revision:wf.revision});assert.equal(r.status,202);const job=await done(r.body.id);assert.equal(job.status,'completed');assert.equal(job.outputs.length,1);
      const media=await fetch(base+'/api/assets/'+job.outputs[0]+'/media',{headers:{cookie:adminCookie}});assert.equal(media.status,200);assert.deepEqual(Buffer.from(await media.arrayBuffer()),png);
      const contents=(await call('projects/'+p.id+'/contents')).body;assert.equal(contents.find(c=>c.id===wf.id).source,'workflow');
    });
    await t.test('对话历史、Skill 与视频异步轮询传递参考文件',async()=>{
      chat=(await call('chats','POST',{project_id:p.id,title:'视频对话'})).body;
      const r=await call('chats/'+chat.id+'/messages','POST',{prompt:'白鹭起飞',config:{agent:'video',kind:'video',model_id:modelId,asset_ids:[aid],skill_ids:['skill_motion'],seconds:4,size:'1280x720'}});assert.equal(r.status,202);const job=await done(r.body.id);assert.equal(job.status,'completed');assert.equal(lastVideoBody.includes('name="input_reference"'),true);assert.equal(lastVideoBody.includes('明确主体动作'),true);
      const c=(await call('chats/'+chat.id)).body;assert.equal(c.messages.length,2);assert.equal(c.messages[1].outputs.length,1);
      assert.equal((await call('projects/'+p.id+'/contents')).body.find(c=>c.id===chat.id).source,'chat');
      const range=await fetch(base+'/api/assets/'+job.outputs[0]+'/media',{headers:{cookie:adminCookie,range:'bytes=0-9'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,10);
    });
    await t.test('工作流报错定位到节点，反射密钥被隐藏',async()=>{
      failImage=true;const r=await call('workflows/'+wf.id+'/run','POST',{revision:wf.revision});const j=await done(r.body.id);assert.equal(j.status,'failed');assert.equal(j.steps.image.status,'failed');assert.equal(j.steps.output,undefined);assert.equal(j.error.includes('fixture-secret'),false);assert.match(j.error,/500/);failImage=false;
    });
    await t.test('JSON 导入校验不存储；有效资产新版本不覆盖原媒体',async()=>{
      const count=app.db.one('SELECT COUNT(*) n FROM workflows').n;
      assert.equal((await call('workflows/validate','POST',{project_id:p.id,document:{...wf.document,schema_version:'bad'}})).status,400);
      assert.equal((await call('workflows/validate','POST',{project_id:p.id,document:wf.document})).body.ok,true);
      assert.equal(app.db.one('SELECT COUNT(*) n FROM workflows').n,count);
      const next=await call('assets','POST',{parent_id:aid,project_id:p.id,name:'参考角色新版本',kind:'character',visibility:'team',mime:'image/png',filename:'reference-v2.png',base64:png.toString('base64')});
      assert.equal(next.body.version,2);assert.notEqual(next.body.id,aid);assert.equal(app.db.one('SELECT version FROM assets WHERE id=?',aid).version,1);
      const third=await call('assets','POST',{parent_id:aid,project_id:p.id,name:'参考角色第三版',kind:'character',visibility:'team',mime:'image/png',filename:'reference-v3.png',base64:png.toString('base64')});assert.equal(third.body.version,3);
    });
    await t.test('图片参考编辑与提示词 Agent 实际走上游接口',async()=>{
      const c=(await call('chats','POST',{project_id:p.id,title:'图片编辑'})).body;
      const r=await call('chats/'+c.id+'/messages','POST',{prompt:'将参考角色改成雨夜背景',config:{agent:'image',kind:'image',model_id:modelId,asset_ids:[aid],skill_ids:[],size:'1024x1024'}});assert.equal((await done(r.body.id)).status,'completed');
      const prompt=(await call('chats','POST',{project_id:p.id,title:'提示词整理'})).body;
      const job=await call('chats/'+prompt.id+'/messages','POST',{prompt:'云海',config:{agent:'prompt',kind:'image',model_id:modelId,asset_ids:[],skill_ids:['skill_visual']}});assert.equal((await done(job.body.id)).status,'completed');
      assert.equal((await call('chats/'+prompt.id)).body.messages[1].text,'明亮的晨曦画面');
    });
    await t.test('API 固定快照、异步生成、下载隔离与撤销',async()=>{
      pub=(await call('publications','POST',{workflow_id:wf.id,name:'测试接口',version:'v1'})).body;assert.ok(pub.token);const snapshot=app.db.one('SELECT document FROM publications WHERE id=?',pub.id).document;
      const changed=structuredClone(wf.document);changed.nodes[0].params.prompt='草稿新修改';wf=(await call('workflows/'+wf.id,'PUT',{revision:wf.revision,document:changed})).body;assert.equal(app.db.one('SELECT document FROM publications WHERE id=?',pub.id).document,snapshot);
      const headers={authorization:'Bearer '+pub.token};const r=await call('v1/endpoints/'+pub.id+'/runs','POST',{prompt:'API故事'},null,headers);assert.equal(r.status,202);await done(r.body.id);
      const result=await call('v1/runs/'+r.body.id,'GET',undefined,null,headers);assert.equal(result.body.status,'completed');const out=await fetch(base+result.body.outputs[0].url,{headers});assert.equal(out.status,200);
      assert.equal((await call('v1/runs/'+r.body.id+'/assets/'+aid,'GET',undefined,null,headers)).status,404);
      await call('publications/'+pub.id,'PATCH',{});assert.equal((await call('v1/runs/'+r.body.id,'GET',undefined,null,headers)).status,401);
    });
    await t.test('手动测试工作区幂等，示例不执行模型，查看者不能载入',async()=>{
      const jobs=app.db.one('SELECT COUNT(*) n FROM jobs').n,calls=generateCalls;
      const a=await call('test-workspace','POST',{},editorCookie),b=await call('test-workspace','POST',{},editorCookie);
      assert.equal(a.status,200);assert.deepEqual(a.body,b.body);assert.equal(Object.keys(a.body.workflows).length,4);assert.equal(Object.keys(a.body.chats).length,3);assert.equal(a.body.assets.length,2);const cases=await call('projects/'+a.body.project_id+'/test-cases','GET',undefined,editorCookie);assert.equal(cases.status,200);assert.equal(cases.body.length,42);assert.equal(cases.body.find(c=>c.id==='TST-009').entry_path,'#workflow/'+a.body.workflows.error);const isolated=app.db.one('SELECT id FROM projects WHERE owner_id=? AND visibility=?',editorId,'private');assert.equal((await call('projects/'+isolated.id+'/test-cases','GET',undefined,viewerCookie)).status,403);
      assert.equal(app.db.one('SELECT COUNT(*) n FROM jobs').n,jobs);assert.equal(generateCalls,calls);assert.equal((await call('test-workspace','POST',{},viewerCookie)).status,403);
      const missing=await call('workflows/'+a.body.workflows.image+'/run','POST',{revision:1},editorCookie);const j=await done(missing.body.id);assert.equal(j.status,'failed');assert.equal(j.steps.image.status,'failed');assert.match(j.error,/模型/);
    });
    await t.test('专家管理校验、多个 Skill 按顺序组合去重并持久化对话配置',async()=>{
      const agents=(await call('agents')).body;assert.equal(agents.length,3);assert.equal(agents.find(x=>x.id==='image').fields.includes('seconds'),false);
      assert.equal((await call('experts')).body.length,3);
      assert.equal((await call('experts','POST',{name:'bad',task:'image',skill_ids:['skill_visual']})).status,400);
      assert.equal((await call('experts','POST',{name:'跨任务组合',task:'image',skill_ids:['skill_visual','skill_motion']})).status,201);
      assert.equal((await call('experts','POST',{name:'x',task:'image',skill_ids:['skill_visual','skill_reference']},editorCookie)).status,403);
      const e=await call('experts','POST',{name:'组合专家',task:'image',skill_ids:['skill_reference','skill_visual']});assert.equal(e.status,201);
      const c=(await call('chats','POST',{project_id:p.id,title:'专家验证'})).body;
      const j=await call('chats/'+c.id+'/messages','POST',{prompt:'白鹭',config:{agent:'image',kind:'video',model_id:modelId,expert_id:e.body.id,asset_ids:[],skill_ids:['skill_visual'],seconds:99}});assert.equal(j.status,202);assert.equal((await done(j.body.id)).status,'completed');
      const cfg=(await call('chats/'+c.id)).body.messages[0].config;assert.equal(cfg.kind,'image');assert.equal(cfg.seconds,undefined);assert.deepEqual(cfg.skill_ids,['skill_reference','skill_visual']);assert.equal(cfg.expert_snapshot.name,'组合专家');assert.equal((lastImageBody.match(/主体、环境、光线与构图/g)||[]).length,1);
      assert.equal((await call('experts/'+e.body.id,'PUT',{name:'更新专家',task:'image',skill_ids:['skill_visual','skill_reference']})).status,200);
      const wrong=await call('chats/'+c.id+'/messages','POST',{prompt:'x',config:{agent:'video',model_id:modelId,expert_id:e.body.id,asset_ids:[],skill_ids:[]}});assert.equal(wrong.status,400);
      const pc=(await call('chats','POST',{project_id:p.id,title:'提示词专家'})).body;
      const pj=await call('chats/'+pc.id+'/messages','POST',{prompt:'白鹭起飞',config:{agent:'prompt',kind:'video',model_id:modelId,expert_id:'expert_prompt',asset_ids:['invalid'],seconds:99,size:'huge',text_model_id:'invalid'}});assert.equal(pj.status,202);assert.equal((await done(pj.body.id)).status,'completed');const pCfg=(await call('chats/'+pc.id)).body.messages[0].config;assert.deepEqual(pCfg.asset_ids,[]);assert.equal(pCfg.seconds,undefined);assert.equal(pCfg.text_model_id,undefined);
      assert.equal((await call('chats/'+c.id+'/messages','POST',{prompt:'x',config:{agent:'video',model_id:modelId,seconds:0}})).status,400);
    });
    await t.test('视频文件参考在对话和工作流中传递；JSON 与 multipart 可配置',async()=>{
      const va=(await call('assets','POST',{project_id:p.id,name:'参考视频',kind:'video',visibility:'team',mime:'video/mp4',filename:'reference.mp4',base64:video.toString('base64')})).body;
      const spec={protocol:'OpenAI',base_url:upstream+'/v1',model:'fixture',capabilities:['video','video_reference'],video_format:'multipart',reference_fields:{image:'input_reference',video:'source_video'}};
      const vm=(await call('models','POST',{name:'参考视频模型',spec})).body;
      const c=(await call('chats','POST',{project_id:p.id,title:'视频文件参考'})).body;
      let r=await call('chats/'+c.id+'/messages','POST',{prompt:'沿用参考视频的动作',config:{agent:'video',model_id:vm.id,asset_ids:[va.id],skill_ids:['skill_visual','skill_concise']}});
      assert.equal((await done(r.body.id)).status,'completed');assert.match(lastVideoBody,/name="source_video"/);assert.match(lastVideoBody,/Content-Type: video\/mp4/i);assert.ok(lastVideoBody.includes(video.toString()));
      const doc={schema_version:'1.0',name:'视频参考工作流',nodes:[{id:'ref',type:'reference_asset',label:'视频参考',params:{asset_id:va.id},position:{x:20,y:20}},{id:'generate',type:'video_generate',label:'视频生成',params:{model_id:vm.id,prompt:'延续动作',skill_ids:['skill_visual']},position:{x:300,y:20}},{id:'output',type:'media_output',label:'输出',params:{},position:{x:600,y:20}}],edges:[{source:'ref',target:'generate'},{source:'generate',target:'output'}]};
      const wfRef=(await call('workflows','POST',{project_id:p.id,name:doc.name,document:doc})).body;
      r=await call('workflows/'+wfRef.id+'/run','POST',{revision:1});assert.equal((await done(r.body.id)).status,'completed');assert.match(lastVideoBody,/name="source_video"/);
      await call('models/'+vm.id,'PUT',{name:'JSON 视频参考模型',spec:{...spec,video_format:'json'}});
      r=await call('chats/'+c.id+'/messages','POST',{prompt:'延续动作',config:{agent:'video',model_id:vm.id,asset_ids:[aid,va.id]}});assert.equal((await done(r.body.id)).status,'completed');const jsonRef=JSON.parse(lastVideoBody);assert.equal(jsonRef.source_video,'data:video/mp4;base64,'+video.toString('base64'));assert.equal(jsonRef.input_reference,'data:image/png;base64,'+png.toString('base64'));
      r=await call('chats/'+c.id+'/messages','POST',{prompt:'能力校验',config:{agent:'video',model_id:modelId,asset_ids:[va.id]}});const bad=await done(r.body.id);assert.equal(bad.status,'failed');assert.match(bad.error,/参考视频能力/);
      r=await call('chats/'+c.id+'/messages','POST',{prompt:'图片输入校验',config:{agent:'image',model_id:modelId,asset_ids:[va.id]}});const img=await done(r.body.id);assert.equal(img.status,'failed');assert.match(img.error,/图片生成仅支持参考图片/);
    });
    await t.test('三个 Agent 可选择全部内置 Skill',async()=>{
      const all=(await call('skills')).body.map(s=>s.id);
      for(const agent of ['image','video','prompt']){const c=(await call('chats','POST',{project_id:p.id,title:'全部 Skill '+agent})).body;const r=await call('chats/'+c.id+'/messages','POST',{prompt:'测试画面',config:{agent,model_id:modelId,skill_ids:all}});assert.equal(r.status,202);assert.equal((await done(r.body.id)).status,'completed');assert.deepEqual((await call('chats/'+c.id)).body.messages[0].config.skill_ids,all);}
    });
    await t.test('提示词工作流节点实际应用所选 Skill',async()=>{
      const doc={schema_version:'1.0',name:'文字工作流',nodes:[{id:'prompt',type:'prompt_agent',label:'提示词',params:{model_id:modelId,prompt:'白鹭',skill_ids:['skill_motion','skill_concise']},position:{x:20,y:20}}],edges:[]};
      const w=(await call('workflows','POST',{project_id:p.id,name:doc.name,document:doc})).body;const r=await call('workflows/'+w.id+'/run','POST',{revision:1});assert.equal((await done(r.body.id)).status,'completed');assert.match(JSON.parse(lastTextBody).messages[1].content,/明确主体动作/);assert.match(JSON.parse(lastTextBody).messages[1].content,/去除重复描述/);
    });
    await t.test('任务参数 schema 与图片对话传递；多图保存及历史配置',async()=>{
      assert.equal((await call('task-options','GET',undefined,null)).status,401);const schema=await call('task-options');assert.equal(schema.status,200);assert.ok(schema.body.image.some(f=>f.key==='n'));assert.ok(schema.body.text.some(f=>f.key==='temperature'));
      const cid=(await call('chats','POST',{project_id:p.id,title:'图片参数对话'})).body.id;
      const config={agent:'image',model_id:modelId,text_model_id:modelId,text_options:{temperature:0,top_p:0.9,max_tokens:80,api_params:{text_tag:'understand'}},n:2,quality:'high',style:'natural',background:'opaque',output_format:'png',response_format:'b64_json',negative_prompt:'模糊',guidance_scale:0,num_inference_steps:12,seed:0,api_params:{watermark:false,vendor:{weights:[0,0.5]},custom_flag:true}};
      const r=await call('chats/'+cid+'/messages','POST',{prompt:'晨光双图',config});assert.equal(r.status,202);const j=await done(r.body.id);assert.equal(j.status,'completed');assert.equal(j.outputs.length,2);
      const image=JSON.parse(lastImageBody),text=JSON.parse(lastTextBody);assert.equal(image.n,2);assert.equal(image.quality,'high');assert.equal(image.guidance_scale,0);assert.equal(image.seed,0);assert.equal(image.watermark,false);assert.deepEqual(image.vendor.weights,[0,0.5]);assert.equal(image.model,'fixture');assert.equal('asset_ids'in image,false);assert.equal('text_options'in image,false);assert.equal(text.temperature,0);assert.equal(text.max_tokens,80);assert.equal(text.text_tag,'understand');assert.equal('n'in text,false);
      const stored=(await call('chats/'+cid)).body.messages.find(m=>m.role==='user').config;assert.equal(stored.n,2);assert.equal(stored.text_options.temperature,0);assert.deepEqual(stored.api_params.vendor,config.api_params.vendor);
    });
    await t.test('视频对话 multipart/JSON 参数、参考文件与类型正确传递',async()=>{
      const m=await call('models','POST',{name:'参数视频模型',spec:{protocol:'SGLang',base_url:upstream+'/v1',model:'fixture',capabilities:['video'],video_format:'multipart',extra:{fps:12,watermark:true},reference_fields:{image:'input_reference',video:'source_clip'}}});const mid=m.body.id;
      const cid=(await call('chats','POST',{project_id:p.id,title:'视频参数对话'})).body.id;
      const config={agent:'video',model_id:mid,asset_ids:[aid],seconds:4,fps:24,aspect_ratio:'16:9',negative_prompt:'闪烁',guidance_scale:7,num_inference_steps:20,api_params:{watermark:false,vendor:{motion:0.5},tags:['cloud','bird']}};
      let r=await call('chats/'+cid+'/messages','POST',{prompt:'视频参数',config});assert.equal((await done(r.body.id)).status,'completed');
      const fields=await new Response(lastVideoBytes,{headers:{'content-type':lastVideoType}}).formData();assert.equal(fields.get('fps'),'24');assert.equal(fields.get('seconds'),'4');assert.equal(fields.get('watermark'),'false');assert.deepEqual(JSON.parse(fields.get('vendor')),{motion:0.5});assert.deepEqual(JSON.parse(fields.get('tags')),['cloud','bird']);assert.deepEqual(Buffer.from(await fields.get('input_reference').arrayBuffer()),png);
      await call('models/'+mid,'PUT',{name:'参数视频模型',spec:{protocol:'SGLang',base_url:upstream+'/v1',model:'fixture',capabilities:['video'],video_format:'json',extra:{fps:12,watermark:true},reference_fields:{image:'input_reference',video:'source_clip'}}});
      r=await call('chats/'+cid+'/messages','POST',{prompt:'JSON 视频参数',config});assert.equal((await done(r.body.id)).status,'completed');const body=JSON.parse(lastVideoBody);assert.equal(body.fps,24);assert.equal(body.watermark,false);assert.deepEqual(body.vendor,{motion:0.5});assert.equal(body.input_reference,'data:image/png;base64,'+png.toString('base64'));
      const before=app.db.one('SELECT COUNT(*) n FROM jobs').n;const bad=await call('chats/'+cid+'/messages','POST',{prompt:'冲突参考字段',config:{...config,api_params:{source_clip:'override'}}});assert.equal(bad.status,400);assert.equal(app.db.one('SELECT COUNT(*) n FROM jobs').n,before);
    });
    await t.test('提示词对话、工作流文本/图像节点和 AI 助手均传递配置',async()=>{
      const cid=(await call('chats','POST',{project_id:p.id,title:'文本参数对话'})).body.id;let r=await call('chats/'+cid+'/messages','POST',{prompt:'整理晨光',config:{agent:'prompt',model_id:modelId,temperature:0,top_p:0.8,top_k:10,max_tokens:64,presence_penalty:-1,frequency_penalty:1,repetition_penalty:1.1,stop:['END'],seed:0,api_params:{vendor_mode:'prompt'}}});assert.equal((await done(r.body.id)).status,'completed');let text=JSON.parse(lastTextBody);assert.equal(text.temperature,0);assert.equal(text.max_tokens,64);assert.equal(text.seed,0);assert.deepEqual(text.stop,['END']);assert.equal(text.stream,false);assert.equal(text.vendor_mode,'prompt');
      const doc=template('工作流 API 参数');doc.nodes.splice(1,0,{id:'text',type:'prompt_agent',params:{model_id:modelId,temperature:0.2,max_tokens:96,api_params:{vendor_mode:'node'}},position:{x:200,y:80}});doc.nodes[2].params={model_id:modelId,size:'1024x1024',n:2,quality:'medium',output_format:'jpeg',output_compression:0,api_params:{watermark:false}};doc.edges=[{source:'prompt',target:'text'},{source:'text',target:'image'},{source:'image',target:'output'}];doc.nodes[0].params.prompt='工作流参数';
      const w=(await call('workflows','POST',{name:doc.name,project_id:p.id,document:doc})).body;r=await call('workflows/'+w.id+'/run','POST',{revision:1});const job=await done(r.body.id);assert.equal(job.status,'completed');assert.equal(job.outputs.length,2);text=JSON.parse(lastTextBody);assert.equal(text.temperature,0.2);assert.equal(text.vendor_mode,'node');assert.equal(JSON.parse(lastImageBody).output_compression,0);
      const fixed=(await call('publications','POST',{workflow_id:w.id,name:'参数快照 API',version:'1'})).body;r=await call('v1/endpoints/'+fixed.id+'/runs','POST',{prompt:'固定参数'},null,{authorization:'Bearer '+fixed.token});assert.equal(r.status,202);assert.equal((await done(r.body.id)).status,'completed');assert.equal(JSON.parse(lastImageBody).n,2);
      const before=app.db.one('SELECT COUNT(*) n FROM jobs').n;r=await call('workflows/'+w.id+'/assist','POST',{mode:'analyze',model_id:modelId,prompt:'只分析',params:{temperature:0,max_tokens:100,api_params:{vendor_mode:'assist'}}});assert.equal(r.status,200);text=JSON.parse(lastTextBody);assert.equal(text.temperature,0);assert.equal(text.max_tokens,100);assert.equal(text.vendor_mode,'assist');assert.equal(app.db.one('SELECT COUNT(*) n FROM jobs').n,before);assert.equal((await call('workflows/'+w.id)).body.revision,1);
      const ref=structuredClone(doc);ref.nodes.splice(1,1);ref.nodes.push({id:'ref',type:'reference_asset',params:{asset_id:aid},position:{x:40,y:300}});ref.edges=[{source:'prompt',target:'image'},{source:'ref',target:'image'},{source:'image',target:'output'}];const refW=(await call('workflows','POST',{name:'图片参考参数',project_id:p.id,document:ref})).body;r=await call('workflows/'+refW.id+'/run','POST',{revision:1});assert.equal((await done(r.body.id)).outputs.length,2);const fields=await new Response(lastImageBytes,{headers:{'content-type':lastImageType}}).formData();assert.equal(fields.get('n'),'2');assert.equal(fields.get('output_compression'),'0');assert.equal(fields.get('watermark'),'false');assert.deepEqual(Buffer.from(await fields.get('image').arrayBuffer()),png);
    });
    await t.test('非法参数不创建任务或历史；上游不支持参数返回真实错误',async()=>{
      const cid=(await call('chats','POST',{project_id:p.id,title:'参数错误检查'})).body.id,before=app.db.one('SELECT COUNT(*) n FROM jobs').n,calls=generateCalls;
      for(const options of [{n:5},{quality:'bad'},{api_params:[]},{api_params:{model:'bad'}},{api_params:{n:8}},{api_params:{image:'bad'}}]){const r=await call('chats/'+cid+'/messages','POST',{prompt:'禁止无效调用',config:{agent:'image',model_id:modelId,...options}});assert.equal(r.status,400);}
      assert.equal(app.db.one('SELECT COUNT(*) n FROM jobs').n,before);assert.equal(generateCalls,calls);assert.equal((await call('chats/'+cid)).body.messages.length,0);
      const doc=structuredClone(wf.document);doc.nodes.find(n=>n.type==='image_generate').params.n=5;const rev=wf.revision;assert.equal((await call('workflows/'+wf.id,'PUT',{revision:rev,document:doc})).status,400);assert.equal((await call('workflows/'+wf.id)).body.revision,rev);
      const r=await call('chats/'+cid+'/messages','POST',{prompt:'错误展示',config:{agent:'image',model_id:modelId,api_params:{fixture_fail:true}}});const job=await done(r.body.id);assert.equal(job.status,'failed');assert.match(job.error,/HTTP 422.*unsupported parameter fixture_fail/);assert.equal(job.outputs.length,0);assert.match((await call('chats/'+cid)).body.messages.at(-1).text,/HTTP 422/);
    });
    await t.test('停用成员撤销已有会话，最后管理员受到保护',async()=>{
      assert.equal((await call('users/'+adminId,'PATCH',{role:'viewer',active:true})).status,400);
      assert.equal((await call('users/'+editorId,'PATCH',{role:'editor',active:false})).status,200);assert.equal((await call('me','GET',undefined,editorCookie)).status,401);
      const without=await fetch(base+'/api/projects',{method:'POST',headers:{cookie:adminCookie,'Content-Type':'application/json'},body:JSON.stringify({name:'forged',visibility:'team'})});assert.equal(without.status,403);
    });
    await t.test('SQLite 与加密密钥可以重新打开；没有预填演示项目',async()=>{
      const n=app.db.one('SELECT COUNT(*) n FROM projects').n;assert.equal(n,3);await app.close();const reopened=createApp({dataDir:dir});assert.equal(reopened.db.one('SELECT COUNT(*) n FROM projects').n,n);assert.equal(reopened.db.one('SELECT COUNT(*) n FROM users').n,3);await reopened.close();
    });
  }finally{if(app.server.listening)await app.close();await new Promise(r=>fixture.close(r));await rm(dir,{recursive:true,force:true});}
});
