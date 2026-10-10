import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {createApp} from '../server.mjs';
import {integerSetting,runtimeLock} from '../lib/runtime.mjs';
import {template} from '../lib/workflow.mjs';

const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r('http://127.0.0.1:'+server.address().port)));
const wait=async fn=>{const until=Date.now()+5000;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('等待夹具状态超时');};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKwAAAABJRU5ErkJggg==';

test('后端运行参数限制与目录锁',async()=>{
  for(const v of ['',0,9,1.5,'bad'])assert.throws(()=>integerSetting(v,'workers',1,8));
  assert.equal(integerSetting('2','workers',1,8),2);
  const dir=await mkdtemp(join(tmpdir(),'cloudheron-lock-'));
  let app;
  try{
    app=createApp({dataDir:dir});assert.throws(()=>createApp({dataDir:dir}),/已有服务/);
    await app.close();await assert.rejects(access(join(dir,'.runtime.lock')));
    const exited=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(exited.status,0);
    await writeFile(join(dir,'.runtime.lock'),JSON.stringify({pid:exited.pid,token:'stale'}));
    app=createApp({dataDir:dir});await app.close();
    await writeFile(join(dir,'.runtime.lock'),'broken');assert.throws(()=>runtimeLock(dir),/格式有误/);
    assert.throws(()=>createApp({dataDir:dir,workerConcurrency:0}),/CLOUDHERON_WORKERS/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('后端实际 HTTP、队列、重启与幂等提交',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cloudheron-backend-')),received=[],held=[];
  let hold=false,app,base,cookie,editorCookie,viewerCookie,p,m,w,chat,pub;
  const fixture=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    if(req.url!=='/v1/images/generations'){res.writeHead(404);res.end('{}');return;}
    const body=JSON.parse(Buffer.concat(chunks));received.push(body);
    if(hold)await new Promise(resolve=>held.push(resolve));
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({data:[{b64_json:png}]}));
  });
  const upstream=await listen(fixture);
  const start=async()=>{app=createApp({dataDir:dir,workerConcurrency:1,maxPending:2,pollMs:1});base=await listen(app.server);};
  const call=async(path,method='GET',body,auth=cookie,key)=>{
    const headers={'Content-Type':'application/json','X-CloudHeron':'1',...(auth?{cookie:auth}:{}),...(key!==undefined?{'Idempotency-Key':key}:{})};
    const response=await fetch(base+'/api/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],replayed:response.headers.get('idempotency-replayed')};
  };
  const done=async jid=>{let j;await wait(async()=>{j=(await call('jobs/'+jid)).body;return ['completed','failed'].includes(j.status);});return j;};
  const message=prompt=>({prompt,config:{agent:'image',model_id:m.id,n:1}});
  const endpoint=async(body,key)=>{const response=await fetch(base+'/api/v1/endpoints/'+pub.id+'/runs',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer '+pub.token,'Idempotency-Key':key},body:JSON.stringify(body)});return {status:response.status,body:await response.json(),replayed:response.headers.get('idempotency-replayed')};};
  try{
    await start();const setup=await call('setup','POST',{team:'后端夹具',name:'QA',email:'admin@fixture.test',password:'fixture-password-123'},null);cookie=setup.cookie;
    for(const role of ['editor','viewer']){const invited=await call('users','POST',{name:role,email:role+'@fixture.test',role});const joined=await call('join','POST',{token:invited.body.invite_path.split('/').at(-1),password:'fixture-password-123'},null);if(role==='editor')editorCookie=joined.cookie;else viewerCookie=joined.cookie;}
    p=(await call('projects','POST',{name:'任务夹具',visibility:'team'})).body;
    m=(await call('models','POST',{name:'本机夹具',spec:{protocol:'OpenAI',base_url:upstream+'/v1',model:'fixture',capabilities:['image']}})).body;
    const doc=template('队列工作流');doc.nodes[1].params.model_id=m.id;
    w=(await call('workflows','POST',{project_id:p.id,name:doc.name,document:doc})).body;
    chat=(await call('chats','POST',{project_id:p.id,title:'去重对话'})).body;
    pub=(await call('publications','POST',{workflow_id:w.id,name:'去重 API',version:'1'})).body;

    await t.test('公开健康检查无敏感信息；运行状态仅管理员访问',async()=>{
      assert.deepEqual((await call('health','GET',undefined,null)).body,{status:'ok',version:'0.1.6'});
      assert.equal((await call('ready','GET',undefined,null)).body.status,'ready');
      assert.equal((await call('system/status','GET',undefined,null)).status,401);
      assert.equal((await call('system/status','GET',undefined,viewerCookie)).status,403);
      const status=await call('system/status');assert.equal(status.body.workers.concurrency,1);assert.equal(status.body.max_pending_per_user,2);
      assert.equal('models' in status.body,false);
    });

    await t.test('同时重复对话提交只产生一次调用、消息和任务',async()=>{
      hold=true;const before=received.length,body=message('幂等对话');
      const results=await Promise.all([call('chats/'+chat.id+'/messages','POST',body,cookie,'chat-1'),call('chats/'+chat.id+'/messages','POST',{config:body.config,prompt:body.prompt},cookie,'chat-1')]);
      assert.ok(results.every(r=>r.status===202));assert.equal(results[0].body.id,results[1].body.id);assert.ok(results.some(r=>r.replayed==='true'));
      await wait(()=>held.length===1);assert.equal(received.length,before+1);
      assert.equal((await call('chats/'+chat.id)).body.messages.filter(m=>m.role==='user').length,1);
      assert.equal((await call('chats/'+chat.id+'/messages','POST',message('不同请求'),cookie,'chat-1')).status,409);
      hold=false;held.shift()();assert.equal((await done(results[0].body.id)).status,'completed');
      const replay=await call('chats/'+chat.id+'/messages','POST',body,cookie,'chat-1');assert.equal(replay.body.id,results[0].body.id);assert.equal(received.length,before+1);
    });

    await t.test('工作流旧版本重放、账号隔离、API 固定版本去重',async()=>{
      const first=await call('workflows/'+w.id+'/run','POST',{revision:1},cookie,'wf-1');await done(first.body.id);
      const doc=structuredClone(w.document);doc.nodes[0].params.prompt='改后的版本';w=(await call('workflows/'+w.id,'PUT',{revision:1,document:doc})).body;
      const replay=await call('workflows/'+w.id+'/run','POST',{revision:1},cookie,'wf-1');assert.equal(replay.body.id,first.body.id);assert.equal(replay.replayed,'true');
      const another=await call('workflows/'+w.id+'/run','POST',{revision:2},editorCookie,'wf-1');assert.equal(another.status,202);assert.notEqual(another.body.id,first.body.id);await done(another.body.id);
      const api=await endpoint({prompt:'固定版本'},'api-1');assert.equal(api.status,202);await done(api.body.id);
      const count=received.length;assert.equal((await endpoint({prompt:'固定版本'},'api-1')).body.id,api.body.id);assert.equal((await endpoint({prompt:'另一请求'},'api-1')).status,409);assert.equal(received.length,count);
      assert.equal((await call('workflows/'+w.id+'/run','POST',{revision:2},viewerCookie,'wf-1')).status,403);
    });

    await t.test('并发一、pending 上限二；重放不消耗队列配额',async()=>{
      hold=true;const count=received.length;
      const a=await call('workflows/'+w.id+'/run','POST',{revision:2},cookie,'limit-1');await wait(()=>held.length===1);
      const b=await call('workflows/'+w.id+'/run','POST',{revision:2},cookie,'limit-2');assert.equal(b.status,202);
      const status=(await call('system/status')).body;assert.equal(status.running,1);assert.equal(status.queued,1);assert.equal(status.workers.active,1);assert.equal(received.length,count+1);
      assert.equal((await call('workflows/'+w.id+'/run','POST',{revision:2},cookie,'limit-3')).status,429);
      assert.equal((await call('workflows/'+w.id+'/run','POST',{revision:2},cookie,'limit-1')).body.id,a.body.id);
      hold=false;held.shift()();await done(a.body.id);await done(b.body.id);assert.equal(received.length,count+2);
    });

    await t.test('非法幂等键和事务失败均不遗留任务或对话输入',async()=>{
      const count=app.db.one('SELECT count(*) n FROM jobs').n;
      const messages=(await call('chats/'+chat.id)).body.messages.length,keys=app.db.one('SELECT count(*) n FROM request_keys').n;
      for(const key of ['', 'bad key','x'.repeat(129)])assert.equal((await call('chats/'+chat.id+'/messages','POST',message('非法键'),cookie,key)).status,400);
      app.db.db.exec("CREATE TRIGGER reject_request_keys BEFORE INSERT ON request_keys BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;");
      assert.equal((await call('chats/'+chat.id+'/messages','POST',message('回滚'),cookie,'rollback')).status,400);
      app.db.db.exec('DROP TRIGGER reject_request_keys');
      assert.equal(app.db.one('SELECT count(*) n FROM jobs').n,count);assert.equal((await call('chats/'+chat.id)).body.messages.length,messages);
      assert.equal(app.db.one('SELECT count(*) n FROM request_keys').n,keys);
    });

    await t.test('正常停机等待当前任务，queued 保留，重启自动接续',async()=>{
      hold=true;const count=received.length;
      const a=await call('workflows/'+w.id+'/run','POST',{revision:2},cookie,'shutdown-1');await wait(()=>held.length===1);
      const b=await call('workflows/'+w.id+'/run','POST',{revision:2},cookie,'shutdown-2');let stopped=false;
      const closing=app.close();assert.equal(app.close(),closing);closing.then(()=>{stopped=true;});assert.equal(stopped,false);
      hold=false;held.shift()();await closing;
      const db=new DatabaseSync(join(dir,'cloudheron.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(a.body.id).status,'completed');assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(b.body.id).status,'queued');db.close();assert.equal(received.length,count+1);
      await start();assert.equal((await done(b.body.id)).status,'completed');assert.equal(received.length,count+2);
      assert.equal((await call('workflows/'+w.id+'/run','POST',{revision:2},cookie,'shutdown-2')).body.id,b.body.id);assert.equal(received.length,count+2);
    });

    await t.test('中断的运行任务失败并定位节点；对话提示一次且不自动重试',async()=>{
      const c=(await call('chats','POST',{project_id:p.id,title:'重启中断'})).body;
      const owner=app.db.one('SELECT id FROM users WHERE email=?','admin@fixture.test').id;
      const stamp=new Date().toISOString(),step=JSON.stringify({done:{status:'completed'},agent:{status:'running'}});
      app.db.run('INSERT INTO jobs(id,project_id,owner_id,source,source_id,snapshot,status,steps,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)','interrupted',p.id,owner,'chat',c.id,'{}','running',step,stamp,stamp);
      const count=received.length;await app.close();await start();
      const failed=await call('jobs/interrupted');assert.equal(failed.body.status,'failed');assert.match(failed.body.error,/重启中断/);assert.equal(failed.body.steps.agent.status,'failed');assert.equal(failed.body.steps.done.status,'completed');assert.equal(received.length,count);
      assert.equal((await call('chats/'+c.id)).body.messages.filter(m=>m.job_id==='interrupted').length,1);
      await app.close();await start();assert.equal((await call('chats/'+c.id)).body.messages.filter(m=>m.job_id==='interrupted').length,1);
    });

    await t.test('终态与对话完成消息同事务；失败键重放不再次调用模型',async()=>{
      const c=(await call('chats','POST',{project_id:p.id,title:'终态事务'})).body,count=received.length;
      app.db.db.exec("CREATE TRIGGER reject_completion BEFORE UPDATE OF status ON jobs WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'fixture completion rollback'); END;");
      const body=message('终态回滚'),first=await call('chats/'+c.id+'/messages','POST',body,cookie,'failed-key');
      const failed=await done(first.body.id);app.db.db.exec('DROP TRIGGER reject_completion');
      assert.equal(failed.status,'failed');assert.equal(received.length,count+1);
      const messages=(await call('chats/'+c.id)).body.messages;assert.equal(messages.filter(m=>m.role==='assistant').length,1);assert.match(messages.at(-1).text,/生成失败/);assert.equal(messages.some(m=>m.text==='图片已生成。'),false);
      const again=await call('chats/'+c.id+'/messages','POST',body,cookie,'failed-key');assert.equal(again.body.id,first.body.id);assert.equal(again.body.status,'failed');assert.equal(received.length,count+1);
    });

    await t.test('项目权限撤销后既有键不绕过授权',async()=>{
      const privateProject=(await call('projects','POST',{name:'私有任务',visibility:'private'})).body;
      const doc=structuredClone(w.document);const other=(await call('workflows','POST',{project_id:privateProject.id,name:'私有流程',document:doc})).body;
      const first=await call('workflows/'+other.id+'/run','POST',{revision:1},cookie,'private');await done(first.body.id);
      assert.equal((await call('workflows/'+other.id+'/run','POST',{revision:1},editorCookie,'private')).status,403);
      const editor=app.db.one('SELECT id FROM users WHERE email=?','editor@fixture.test');
      await call('projects/'+privateProject.id,'PATCH',{name:privateProject.name,visibility:'private',acl:{[editor.id]:'edit'}});
      const granted=await call('workflows/'+other.id+'/run','POST',{revision:1},editorCookie,'granted');assert.equal(granted.status,202);await done(granted.body.id);
      await call('projects/'+privateProject.id,'PATCH',{name:privateProject.name,visibility:'private',acl:{}});
      assert.equal((await call('workflows/'+other.id+'/run','POST',{revision:1},editorCookie,'granted')).status,403);
      const revoke=await call('publications/'+pub.id,'PATCH',{});assert.equal(revoke.status,200);assert.equal((await endpoint({prompt:'固定版本'},'api-1')).status,401);
    });
  }finally{hold=false;for(const release of held.splice(0))release();if(app)await app.close();await new Promise(r=>fixture.close(r));await rm(dir,{recursive:true,force:true});}
});

test('启动脚本、健康探测和 SIGTERM 实际子进程验证',async()=>{
  const {spawn}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const dir=await mkdtemp(join(tmpdir(),'cloudheron-process-'));
  const startScript=fileURLToPath(new URL('../scripts/start.sh',import.meta.url)),healthScript=fileURLToPath(new URL('../scripts/healthcheck.mjs',import.meta.url));
  let child,output='';
  try{
    const probe=http.createServer(),url=await listen(probe),port=new URL(url).port;await new Promise(r=>probe.close(r));
    const env={...process.env,CLOUDHERON_NODE_BIN:process.execPath,CLOUDHERON_DATA:dir,PORT:port,HOST:'127.0.0.1',CLOUDHERON_WORKERS:'1',CLOUDHERON_MAX_PENDING_PER_USER:'3'};
    child=spawn('/bin/sh',[startScript],{env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});
    await wait(()=>output.includes('http://127.0.0.1:'));
    const ready=await fetch(url+'/api/ready');assert.equal(ready.status,200);assert.equal((await ready.json()).version,'0.1.6');
    const health=spawnSync(process.execPath,[healthScript],{env:{...env,CLOUDHERON_HEALTH_URL:url},encoding:'utf8'});assert.equal(health.status,0,health.stderr);assert.match(health.stdout,/CloudHeron ready 0.1.6/);
    const exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));child.kill('SIGTERM');assert.deepEqual(await exited,{code:0,signal:null});await assert.rejects(access(join(dir,'.runtime.lock')));
    const invalid=spawnSync('/bin/sh',[startScript],{env:{...env,CLOUDHERON_WORKERS:'0'},encoding:'utf8',timeout:5000});assert.equal(invalid.status,1);assert.match(invalid.stderr,/CLOUDHERON_WORKERS/);await assert.rejects(access(join(dir,'.runtime.lock')));
  }finally{if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await ended;}await rm(dir,{recursive:true,force:true});}
});
