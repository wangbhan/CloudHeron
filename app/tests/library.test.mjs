import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {template,validateWorkflow} from '../lib/workflow.mjs';
import {builtinTemplates,copyTemplate} from '../lib/workflow-library.mjs';

test('内置模板有效，复制保留结构且默认清空绑定',()=>{
  assert.equal(builtinTemplates.length,3);
  for(const t of builtinTemplates)validateWorkflow(JSON.parse(t.document));
  const source=template('原流程');source.nodes[1].params.model_id='original-model';source.nodes.push({id:'ref',type:'reference_asset',params:{asset_id:'original-asset'},position:{x:0,y:300}});
  const clean=copyTemplate(source,'副本'),bound=copyTemplate(source,'绑定副本',{keepBindings:true});
  assert.equal(clean.nodes[1].params.model_id,'');assert.equal(clean.nodes.at(-1).params.asset_id,'');assert.deepEqual(clean.edges,source.edges);
  assert.equal(bound.nodes[1].params.model_id,'original-model');assert.equal(source.name,'原流程');assert.equal(source.nodes.at(-1).params.asset_id,'original-asset');
});

test('模板与版本的 HTTP、权限及升级回归',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cloudheron-library-'));let app=createApp({dataDir:dir});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  let adminCookie,viewerCookie,editorCookie,viewerId,editorId,p,w,tpl;
  const call=async(path,method='GET',data,cookie=adminCookie)=>{const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json','X-CloudHeron':'1',...(cookie?{cookie}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  const jobs=()=>app.db.one('SELECT COUNT(*) n FROM jobs').n;
  try{
    const setup=await call('setup','POST',{team:'版本夹具',name:'管理员',email:'admin@fixture.test',password:'fixture-password-123'});assert.equal(setup.status,201);adminCookie=setup.cookie;
    for(const role of ['viewer','editor']){const invitation=await call('users','POST',{name:role,email:role+'@fixture.test',role}),joined=await call('join','POST',{token:invitation.body.invite_path.split('/').at(-1),password:'fixture-password-123'});assert.equal(joined.status,200);if(role==='viewer'){viewerCookie=joined.cookie;viewerId=joined.body.user.id;}else{editorCookie=joined.cookie;editorId=joined.body.user.id;}}
    p=(await call('projects','POST',{name:'模板源项目',visibility:'private'})).body;
    await t.test('模板复用创建独立工作流和首版，零任务副作用',async()=>{
      const list=await call('workflow-templates');assert.equal(list.body.length,3);assert.equal('document' in list.body[0],false);
      const r=await call('workflow-templates/builtin_image/instantiate','POST',{project_id:p.id,name:'测试工作流',revision:1});assert.equal(r.status,201);w=r.body;
      assert.equal(w.revision,1);assert.equal(w.document.nodes[1].params.model_id,'');assert.equal(jobs(),0);
      const versions=await call('workflows/'+w.id+'/versions');assert.deepEqual(versions.body.map(v=>v.action),['template']);
      assert.equal((await call('workflow-templates/builtin_video/instantiate','POST',{project_id:p.id,name:'冲突副本',revision:0})).status,409);
      assert.equal((await call('workflow-templates/builtin_image/instantiate','POST',{project_id:p.id,name:'无效绑定',revision:1,keep_bindings:'true'})).status,400);
    });
    await t.test('保存模板固定 JSON，来源修改与副本修改均相互独立',async()=>{
      const r=await call('workflow-templates','POST',{workflow_id:w.id,revision:w.revision,name:'晨光模板',description:'固定首版'});assert.equal(r.status,201);tpl=r.body;
      const doc=structuredClone(w.document);doc.nodes[0].params.prompt='来源已变更';w=(await call('workflows/'+w.id,'PUT',{revision:w.revision,document:doc})).body;
      assert.equal((await call('workflow-templates/'+tpl.id)).body.document.nodes[0].params.prompt,tpl.document.nodes[0].params.prompt);
      const copied=await call('workflow-templates/'+tpl.id+'/instantiate','POST',{project_id:p.id,name:'独立副本',revision:1});assert.equal(copied.status,201);assert.notEqual(copied.body.id,w.id);
      copied.body.document.nodes[0].params.prompt='只修改副本';assert.equal((await call('workflows/'+copied.body.id,'PUT',{revision:1,document:copied.body.document})).status,200);
      assert.equal((await call('workflows/'+w.id)).body.document.nodes[0].params.prompt,'来源已变更');assert.equal(jobs(),0);
      assert.equal((await call('workflow-templates','POST',{workflow_id:w.id,revision:1,name:'过期模板'})).status,409);
    });
    await t.test('恢复生成新版本，旧记录与 API 快照固定，冲突不新增记录',async()=>{
      const pub=await call('publications','POST',{workflow_id:w.id,name:'固定接口',version:'1'});assert.equal(pub.status,201);
      const snapshot=app.db.one('SELECT document FROM publications WHERE id=?',pub.body.id).document;
      const v1=(await call('workflows/'+w.id+'/versions/1')).body.document;
      const r=await call('workflows/'+w.id+'/restore','POST',{revision:w.revision,source_revision:1});assert.equal(r.status,200);w=r.body;assert.equal(w.revision,3);assert.deepEqual(w.document,v1);
      let hist=(await call('workflows/'+w.id+'/versions')).body;assert.deepEqual(hist.map(v=>v.revision),[3,2,1]);assert.equal(hist[0].action,'restore');assert.equal(hist[0].source_revision,1);assert.equal(hist[0].actor_name,'管理员');
      assert.equal((await call('workflows/'+w.id+'/versions/2')).body.document.nodes[0].params.prompt,'来源已变更');assert.equal(app.db.one('SELECT document FROM publications WHERE id=?',pub.body.id).document,snapshot);
      assert.equal((await call('workflows/'+w.id+'/restore','POST',{revision:2,source_revision:1})).status,409);
      assert.equal((await call('workflows/'+w.id+'/restore','POST',{revision:3,source_revision:999})).status,404);
      assert.equal((await call('workflows/'+w.id+'/restore','POST',{revision:3,source_revision:0})).status,400);
      assert.equal((await call('workflows/'+w.id+'/versions')).body.length,3);assert.equal(jobs(),0);
    });
    await t.test('私有模板与历史隔离，查看者可预览但禁止复用恢复',async()=>{
      for(const cookie of [viewerCookie,editorCookie]){
        assert.equal((await call('workflow-templates',undefined,undefined,cookie)).body.length,3);
        assert.equal((await call('workflow-templates/'+tpl.id,'GET',undefined,cookie)).status,403);
        assert.equal((await call('workflows/'+w.id+'/versions/1','GET',undefined,cookie)).status,403);
      }
      await call('projects/'+p.id,'PATCH',{name:p.name,visibility:'private',acl:{[viewerId]:'edit',[editorId]:'read'}});
      assert.equal((await call('workflow-templates/'+tpl.id,'GET',undefined,viewerCookie)).status,200);
      assert.equal((await call('workflows/'+w.id+'/versions','GET',undefined,viewerCookie)).status,200);
      for(const cookie of [viewerCookie,editorCookie]){
        assert.equal((await call('workflow-templates','POST',{workflow_id:w.id,revision:3,name:'未授权'},cookie)).status,403);
        assert.equal((await call('workflow-templates/'+tpl.id+'/instantiate','POST',{project_id:p.id,name:'未授权',revision:1},cookie)).status,403);
        assert.equal((await call('workflows/'+w.id+'/restore','POST',{revision:3,source_revision:1},cookie)).status,403);
      }
      assert.equal(jobs(),0);
    });
    await t.test('默认清空失效模型，选择保留时重新校验且失败不创建',async()=>{
      const m=await call('models','POST',{name:'仅存储配置',spec:{protocol:'OpenAI',base_url:'http://127.0.0.1:9/v1',model:'unused',capabilities:['image']}});assert.equal(m.status,201);
      const doc=template('模型模板');doc.nodes[1].params.model_id=m.body.id;
      const source=(await call('workflows','POST',{project_id:p.id,name:doc.name,document:doc})).body;
      const saved=(await call('workflow-templates','POST',{workflow_id:source.id,revision:1,name:'模型绑定模板'})).body;
      app.db.run('UPDATE models SET enabled=0 WHERE id=?',m.body.id);
      const count=app.db.one('SELECT COUNT(*) n FROM workflows').n;
      const bad=await call('workflow-templates/'+saved.id+'/instantiate','POST',{project_id:p.id,name:'绑定副本',revision:1,keep_bindings:true});assert.ok(bad.status>=400);assert.match(bad.body.error,/模型/);assert.equal(app.db.one('SELECT COUNT(*) n FROM workflows').n,count);
      const clean=await call('workflow-templates/'+saved.id+'/instantiate','POST',{project_id:p.id,name:'清空副本',revision:1});assert.equal(clean.status,201);assert.equal(clean.body.document.nodes[1].params.model_id,'');assert.equal(jobs(),0);
      const assetProject=(await call('projects','POST',{name:'私有参考项目',visibility:'private'})).body;
      const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKwAAAABJRU5ErkJggg==';
      const asset=await call('assets','POST',{project_id:assetProject.id,name:'私有参考',kind:'character',visibility:'private',mime:'image/png',filename:'ref.png',base64:png});assert.equal(asset.status,201);
      const refDoc=template('带私有参考的模板');refDoc.nodes.push({id:'ref',type:'reference_asset',params:{asset_id:asset.body.id},position:{x:40,y:300}});refDoc.edges.push({source:'ref',target:'image'});
      const refWf=(await call('workflows','POST',{project_id:p.id,name:refDoc.name,document:refDoc})).body;
      const refTpl=(await call('workflow-templates','POST',{workflow_id:refWf.id,revision:1,name:'私有参考模板'})).body;
      const target=(await call('projects','POST',{name:'编辑者目标项目',visibility:'private'},editorCookie)).body;
      const countBefore=app.db.one('SELECT COUNT(*) n FROM workflows').n;
      assert.equal((await call('workflow-templates/'+refTpl.id+'/instantiate','POST',{project_id:target.id,name:'保留未授权参考',revision:1,keep_bindings:true},editorCookie)).status,403);
      assert.equal(app.db.one('SELECT COUNT(*) n FROM workflows').n,countBefore);
      const without=await call('workflow-templates/'+refTpl.id+'/instantiate','POST',{project_id:target.id,name:'不保留参考副本',revision:1},editorCookie);assert.equal(without.status,201);assert.equal(without.body.document.nodes.at(-1).params.asset_id,'');assert.equal(jobs(),0);

    });
    await t.test('升级只登记现有当前版本；重启不重复，测试工作区创建即有历史',async()=>{
      const seed=await call('test-workspace','POST',{});assert.equal(seed.status,200);
      for(const wid of Object.values(seed.body.workflows))assert.equal((await call('workflows/'+wid+'/versions')).body.length,1);
      app.db.run('DELETE FROM workflow_versions WHERE workflow_id=?',w.id);app.db.run('UPDATE workflows SET revision=7 WHERE id=?',w.id);
      await app.close();app=createApp({dataDir:dir});
      const baseline=app.db.all('SELECT * FROM workflow_versions WHERE workflow_id=?',w.id);assert.equal(baseline.length,1);assert.equal(baseline[0].revision,7);assert.equal(baseline[0].action,'baseline');assert.equal(baseline[0].actor_id,null);
      await app.close();app=createApp({dataDir:dir});assert.equal(app.db.all('SELECT * FROM workflow_versions WHERE workflow_id=?',w.id).length,1);assert.equal(app.db.one('SELECT COUNT(*) n FROM workflow_templates').n,3);
    });
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
