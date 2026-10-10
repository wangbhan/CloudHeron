import {taskOptions,normalizeApiOptions} from './lib/api-options.mjs';
import {runtimeLock,scheduler,integerSetting} from './lib/runtime.mjs';
import {idempotency} from './lib/idempotency.mjs';
import http from 'node:http';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join,resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {database} from './lib/database.mjs';
import {id,token,hash,password,verify,vault,permission,roles} from './lib/security.mjs';
import {validateWorkflow,template,nodeTypes,executeWorkflow} from './lib/workflow.mjs';
import {provider,validateModel} from './lib/provider.mjs';
import {agents,normalizeChatConfig} from './lib/agents.mjs';
import {builtinTemplates,copyTemplate} from './lib/workflow-library.mjs';
import {seedManualWorkspace} from './lib/manual-fixtures.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const now=()=>new Date().toISOString();
const cleanUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,active:!!u.active});
class APIError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,msg)=>{throw new APIError(status,msg);};
const text=(v,label,max=200)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,`${label}须为 1–${max} 个字符`);return v.trim();};
const json=v=>JSON.stringify(v);
const parse=v=>JSON.parse(v);
export function sniff(data,mime) {
  const signatures={
    'image/png':()=>data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/jpeg':()=>data[0]===255&&data[1]===216&&data[2]===255,
    'image/webp':()=>data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP',
    'image/gif':()=>/^GIF8[79]a$/.test(data.subarray(0,6).toString()),
    'video/mp4':()=>data.subarray(4,8).toString()==='ftyp',
    'video/webm':()=>data.subarray(0,4).equals(Buffer.from([26,69,223,163]))
  };
  if(!signatures[mime]?.())throw Error('文件格式与内容不符；支持 PNG、JPEG、WebP、GIF、MP4、WebM');
  if(data.length<10||data.length>100*1024*1024)throw Error('媒体文件大小须为 10 字节–100 MB');return mime;
}

export function createApp({dataDir=process.env.CLOUDHERON_DATA||join(root,'data'),pollMs=2500,workerConcurrency=process.env.CLOUDHERON_WORKERS??2,maxPending=process.env.CLOUDHERON_MAX_PENDING_PER_USER??10}={}) {
  const concurrency=integerSetting(workerConcurrency,'CLOUDHERON_WORKERS',1,8),pendingLimit=integerSetting(maxPending,'CLOUDHERON_MAX_PENDING_PER_USER',1,100);
  const unlock=runtimeLock(resolve(dataDir));let d;
  try{d=database(resolve(dataDir));}catch(e){unlock();throw e;}
  const v=vault(d.key);let closing=false,closePromise=null;
  const runtime=scheduler({concurrency,claim:()=>d.tx(()=>{const j=d.one("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1");if(!j)return null;return d.run("UPDATE jobs SET status='running',updated_at=? WHERE id=? AND status='queued'",now(),j.id).changes?j.id:null;}),execute:runJob,onError:markJobFailed});
  const requestRecord=(req,u,scope,b)=>idempotency(d,{key:req.headers['idempotency-key'],owner:u.id,scope,body:b},fail);
  const replay=(res,record)=>{if(!record.replay)return false;res.setHeader('Idempotency-Replayed','true');send(res,jobView(record.replay),202);return true;};
  const project=(u,pid,edit=false)=>{const p=d.one('SELECT * FROM projects WHERE id=?',pid);if(!p)fail(404,'项目不存在');if(!permission(u,p,edit))fail(403,'当前账号缺少项目权限');return p;};
  const editor=u=>{if(u.role==='viewer')fail(403,'查看者仅可查看，操作需要编辑者或管理员权限');};
  const admin=u=>{if(u.role!=='admin')fail(403,'此操作需要管理员权限');};
  const resource=(table,u,rid,edit=false)=>{const r=d.one(`SELECT * FROM ${table} WHERE id=?`,rid);if(!r)fail(404,'内容不存在');project(u,r.project_id,edit);return r;};
  const asset=(u,aid)=>{if(typeof aid!=='string'||!aid)fail(400,'请选择参考资产版本');const a=d.one('SELECT * FROM assets WHERE id=?',aid);if(!a)fail(404,'参考资产不存在');if(a.project_id)project(u,a.project_id);else if(!permission(u,a))fail(403,'当前账号缺少资产权限');return a;};
  const model=mid=>{if(typeof mid!=='string'||!mid)throw Error('请先在模型配置中接入并启用对应模型');const m=d.one('SELECT * FROM models WHERE id=? AND enabled=1',mid);if(!m)throw Error('请先在模型配置中接入并启用对应模型');return m;};
  const modelView=(m,u)=>({id:m.id,name:m.name,enabled:!!m.enabled,has_key:!!m.secret,...(u.role==='admin'?{spec:parse(m.spec)}:{spec:{source:parse(m.spec).source,protocol:parse(m.spec).protocol,capabilities:parse(m.spec).capabilities,model:parse(m.spec).model}})});
  const assetView=a=>({...a,metadata:parse(a.metadata),url:'/api/assets/'+a.id+'/media'});
  const jobView=j=>({...j,snapshot:undefined,steps:parse(j.steps),outputs:parse(j.outputs)});
  const wfView=w=>({...w,document:parse(w.document)});
  const recordVersion=(w,u,action,sourceRevision=null)=>d.run('INSERT INTO workflow_versions(workflow_id,revision,document,actor_id,action,source_revision,saved_at) VALUES(?,?,?,?,?,?,?)',w.id,w.revision,w.document,u?.id||null,action,sourceRevision,w.updated_at);
  const createWorkflow=(u,pid,name,document,action='create')=>d.tx(()=>{const wid=id('wf');d.run('INSERT INTO workflows(id,project_id,name,document,updated_at) VALUES(?,?,?,?,?)',wid,pid,name,json({...document,name}),now());const w=d.one('SELECT * FROM workflows WHERE id=?',wid);recordVersion(w,u,action);return w;});
  const storeWorkflow=(w,u,revision,document,action,sourceRevision=null)=>d.tx(()=>{const name=text(document.name||w.name,'工作流名称');const changed=d.run('UPDATE workflows SET name=?,document=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',name,json(document),now(),w.id,revision);if(!changed.changes)fail(409,'工作流已被他人修改，请刷新后重试');const saved=d.one('SELECT * FROM workflows WHERE id=?',w.id);recordVersion(saved,u,action,sourceRevision);return saved;});
  const templateResource=(u,tid)=>builtinTemplates.find(t=>t.id===tid)||resource('workflow_templates',u,tid);
  const templateView=(t,detail=false)=>{const doc=parse(t.document);return {...t,builtin:!!t.builtin,document:detail?doc:undefined,node_count:doc.nodes.length,edge_count:doc.edges.length};};
  const wfResources=(u,w)=>{validateWorkflow(w);for(const n of w.nodes){if(n.type==='reference_asset'&&n.params.asset_id)asset(u,n.params.asset_id);if(n.params.model_id){const m=model(n.params.model_id);if(['prompt_agent','image_generate','video_generate'].includes(n.type))normalizeApiOptions(n.type==='prompt_agent'?'text':n.type==='image_generate'?'image':'video',n.params,{referenceFields:Object.values(parse(m.spec).reference_fields||{})});}}};
  const applySkills=(kind,prompt,ids=[],target=kind)=>{if(!Array.isArray(ids)||ids.length>20)throw Error('Skill 列表有误');for(const sid of new Set(ids)){const s=d.one('SELECT * FROM skills WHERE id=?',sid);if(!s)throw Error('Skill 不存在');prompt=s.template.replaceAll('{{prompt}}',prompt);}return prompt;};
  async function saveAsset(data,kind,mime,job) {
    const supported=kind==='image'?['image/png','image/jpeg','image/webp','image/gif']:['video/mp4','video/webm'];
    mime=supported.find(type=>{try{sniff(data,type);return true;}catch{return false;}});
    if(!mime)throw Error('模型返回的内容不是支持的图片或视频文件');
    const aid=id('asset'),file=aid+({ 'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','video/mp4':'.mp4','video/webm':'.webm'}[mime]);
    await writeFile(join(d.dir,'media',file),data,{mode:0o600,flag:'wx'});
    d.run('INSERT INTO assets(id,project_id,owner_id,name,kind,visibility,mime,file,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',aid,job.project_id,job.owner_id,(kind==='image'?'生成图片':'生成视频')+' · '+now().slice(11,19),kind,'private',mime,file,json({job_id:job.id,source:job.source,source_id:job.source_id,family_id:aid}),now());
    return assetView(d.one('SELECT * FROM assets WHERE id=?',aid));
  }
  const adapters=job=>provider({secret:v.decrypt,loadMedia:a=>readFile(join(d.dir,'media',a.file)),saveMedia:(data,kind,mime)=>saveAsset(data,kind,mime,job),pollMs});
  function enqueue(u,{project_id,source,source_id,snapshot,publication_id=null}) {
    project(u,project_id,true);
    if(closing)fail(503,'服务正在停止，请稍后提交');
    if(d.one("SELECT COUNT(*) n FROM jobs WHERE owner_id=? AND status IN ('queued','running')",u.id).n>=pendingLimit)fail(429,`当前账号已有 ${pendingLimit} 个待完成任务，请等待后再提交`);
    const jid=id('job');d.run('INSERT INTO jobs(id,project_id,owner_id,source,source_id,publication_id,snapshot,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',jid,project_id,u.id,source,source_id,publication_id,json(snapshot),'queued',now(),now());runtime.kick();return jobView(d.one('SELECT * FROM jobs WHERE id=?',jid));
  }
  function markJobFailed(jid,e){
    const j=d.one('SELECT * FROM jobs WHERE id=?',jid);if(!j)return;
    const error=String(e.message||e).slice(0,500),steps=parse(j.steps);
    for(const step of Object.values(steps))if(step.status==='running'){step.status='failed';step.error=error;}
    d.tx(()=>{d.run("UPDATE jobs SET status='failed',error=?,steps=?,updated_at=? WHERE id=?",error,json(steps),now(),jid);
      if(j.source==='chat'){const c=d.one('SELECT messages FROM chats WHERE id=?',j.source_id);if(c){const messages=parse(c.messages);if(!messages.some(m=>m.role==='assistant'&&m.job_id===jid)){messages.push({id:id('msg'),role:'assistant',text:'生成失败：'+error,job_id:jid,at:now()});d.run('UPDATE chats SET messages=?,updated_at=? WHERE id=?',json(messages),now(),j.source_id);}}}
    });
  }
  async function runJob(jid) {
    const j=d.one('SELECT * FROM jobs WHERE id=?',jid),snap=parse(j.snapshot),steps={};
    const principal=()=>{const u=d.one('SELECT * FROM users WHERE id=?',j.owner_id);project(u,j.project_id,true);return u;};
    const onStep=async(n,state,out,error)=>{steps[n]={status:state,...(out?{output:out}:{}),...(error?{error}:{} )};d.run('UPDATE jobs SET steps=?,updated_at=? WHERE id=?',json(steps),now(),jid);};
    try {
      principal();const api=adapters(j),generate=async(kind,mid,prompt,refs,p)=>{principal();return api.generate(model(mid),kind,applySkills(kind,prompt,p.skill_ids||[]),refs,p);};
      let outputs=[],assistant=null;
      if(j.source==='chat') {
        const config=snap.config;await onStep('agent','running');
        const refs=(config.asset_ids||[]).map(a=>asset(principal(),a));
        const history=snap.messages.filter(m=>['user','assistant'].includes(m.role)&&m.text).slice(-20).map(m=>({role:m.role,content:m.text}));
        let result;
        if(config.agent==='prompt')result=await api.chat(model(config.model_id),[{role:'system',content:'你是云鹭提示词 Agent，结合对话上下文整理图片或视频提示词，只回复可用的提示词。'},...history.slice(0,-1),{role:'user',content:applySkills('prompt',snap.prompt,config.skill_ids||[],config.kind)}],config);
        else {
          let prompt=snap.prompt;
          if(config.text_model_id)prompt=await api.chat(model(config.text_model_id),[{role:'system',content:'你是云鹭创作 Agent。结合创作历史，将用户要求整理为一段可直接传入生成模型的画面或动作提示词。只回复提示词。'},...history],config.text_options||{});
          else if(history.length>1)prompt=history.map(m=>m.role+': '+m.content).join('\n');
          outputs=await generate(config.kind,config.model_id,prompt,refs,config);result=(config.kind==='image'?'图片':'视频')+'已生成。';
        }
        await onStep('agent','completed');
        assistant={id:id('msg'),role:'assistant',text:result,outputs:outputs.map(a=>a.id),job_id:jid,at:now()};
      }else outputs=await executeWorkflow(snap.document,{input:snap.input,resolveAsset:aid=>asset(principal(),aid),generate,chat:(mid,prompt,params)=>api.chat(model(mid),[{role:'system',content:'你是云鹭提示词 Agent，整理可用提示词。'}, {role:'user',content:applySkills('prompt',prompt,params.skill_ids||[])}],params),onStep});
      d.tx(()=>{if(assistant){const c=d.one('SELECT messages FROM chats WHERE id=?',j.source_id),messages=parse(c.messages);messages.push(assistant);d.run('UPDATE chats SET messages=?,updated_at=? WHERE id=?',json(messages),now(),j.source_id);}d.run("UPDATE jobs SET status='completed',outputs=?,updated_at=? WHERE id=?",json(outputs.map(a=>a.id)),now(),jid);});
    }catch(e){markJobFailed(jid,e);}
  }
  const attempts=new Map();
  function rate(ip) {const old=attempts.get(ip),entry=!old||Date.now()>old.until?{n:0,until:Date.now()+60000}:old;entry.n++;attempts.set(ip,entry);if(attempts.size>2000)for(const [k,a]of attempts)if(a.until<Date.now())attempts.delete(k);if(entry.n>15)fail(429,'操作过于频繁，请一分钟后再试');}
  const session=(res,u)=>{const t=token();d.run('DELETE FROM sessions WHERE expires<?',Date.now());d.run('INSERT INTO sessions VALUES(?,?,?)',hash(t),u.id,Date.now()+7*86400000);res.setHeader('Set-Cookie',`cloudheron=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return {user:cleanUser(u)};};
  async function body(req) {let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>32*1024*1024)fail(413,'请求超过 32 MB');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail(400,'请求须为有效 JSON');}}
  const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(json(data));};
  function bearer(req) {const value=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!value)fail(401,'请提供 API 调用凭据');const p=d.one('SELECT * FROM publications WHERE key_hash=? AND enabled=1',hash(value));if(!p)fail(401,'API 凭据无效或已撤销');const u=d.one('SELECT * FROM users WHERE id=? AND active=1',p.owner_id);if(!u)fail(403,'发布者账号已停用');project(u,p.project_id,true);return {p,u};}
  async function mediaResponse(req,res,a) {
    const file=join(d.dir,'media',a.file),info=await stat(file),range=req.headers.range;
    const headers={'Content-Type':a.mime,'Content-Length':info.size,'Cache-Control':'private, no-store','Accept-Ranges':'bytes','Content-Disposition':'inline'};
    if(range){const m=range.match(/^bytes=(\d+)-(\d*)$/);if(!m)fail(416,'请求范围有误');const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),info.size-1):info.size-1;if(start>=info.size||end<start)fail(416,'请求范围超出文件');const buffer=await readFile(file);headers['Content-Length']=end-start+1;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;res.writeHead(206,headers);res.end(buffer.subarray(start,end+1));}else{res.writeHead(200,headers);res.end(await readFile(file));}
  }
  for(const j of d.all("SELECT id FROM jobs WHERE status='running'"))markJobFailed(j.id,Error('服务重启中断任务，请检查当前产物后重新运行'));
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try{
      const path=new URL(req.url,'http://localhost').pathname,method=req.method;let m;
      if(!path.startsWith('/api/')){
        if(method!=='GET'&&method!=='HEAD')fail(405,'请求方式有误');
        const rel=decodeURIComponent(path),p=resolve(root,'public',rel==='/'?'index.html':'.'+rel);
        if(!p.startsWith(join(root,'public')+'/'))fail(403,'文件路径有误');
        const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json'}[extname(p)]||'application/octet-stream';
        try{const file=await readFile(p);res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:file);}catch{fail(404,'页面或文件不存在');}return;
      }
      if(method==='GET'&&(path==='/api/health'||path==='/api/ready')){try{d.one('SELECT 1');}catch{fail(503,'服务尚未就绪');}send(res,{status:closing?'draining':path==='/api/ready'?'ready':'ok',version:'0.1.6'},closing?503:200);return;}
      if(path.startsWith('/api/v1/')) {
        const {p,u}=bearer(req);
        if(method==='POST'&&(m=path.match(/^\/api\/v1\/endpoints\/([^/]+)\/runs$/))){if(m[1]!==p.id)fail(403,'凭据与接口不匹配');const b=await body(req),record=requestRecord(req,u,'endpoint:'+p.id,b);if(replay(res,record))return;if(typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>32000)fail(400,'prompt 须为 1–32000 个字符');wfResources(u,parse(p.document));send(res,d.tx(()=>{const j=enqueue(u,{project_id:p.project_id,source:'workflow',source_id:p.workflow_id,publication_id:p.id,snapshot:{document:parse(p.document),input:{prompt:b.prompt}}});record.record(j.id);return j;}),202);return;}
        if(method==='GET'&&(m=path.match(/^\/api\/v1\/runs\/([^/]+)$/))){const j=d.one('SELECT * FROM jobs WHERE id=? AND publication_id=?',m[1],p.id);if(!j)fail(404,'任务不存在');const view=jobView(j);view.outputs=view.outputs.map(aid=>({asset_id:aid,url:'/api/v1/runs/'+j.id+'/assets/'+aid}));send(res,view);return;}
        if(method==='GET'&&(m=path.match(/^\/api\/v1\/runs\/([^/]+)\/assets\/([^/]+)$/))){const j=d.one('SELECT * FROM jobs WHERE id=? AND publication_id=?',m[1],p.id);if(!j||!parse(j.outputs).includes(m[2]))fail(404,'产物不存在');await mediaResponse(req,res,asset(u,m[2]));return;}
        fail(404,'API 路径不存在');
      }
      if(!['GET','HEAD'].includes(method)) {
        if(req.headers['x-cloudheron']!=='1')fail(403,'缺少请求保护头');
        if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)fail(403,'请求来源不匹配');
      }
      if(path==='/api/bootstrap'&&method==='GET'){send(res,{setup_required:!d.one('SELECT id FROM users LIMIT 1'),team:d.one("SELECT value FROM meta WHERE key='team'")?.value||'云鹭团队',node_types:nodeTypes});return;}
      if(path==='/api/setup'&&method==='POST') {
        rate(req.socket.remoteAddress);const b=await body(req),email=text(b.email,'邮箱').toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))fail(400,'邮箱格式有误');const encoded=password(b.password),uid=id('usr');
        d.tx(()=>{if(d.one('SELECT id FROM users LIMIT 1'))fail(409,'团队已初始化');d.run('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)',uid,text(b.name,'姓名'),email,encoded,'admin',now());d.run('INSERT INTO meta VALUES(?,?)','team',text(b.team,'团队名称'));});send(res,session(res,d.one('SELECT * FROM users WHERE id=?',uid)),201);return;
      }
      if(path==='/api/login'&&method==='POST'){rate(req.socket.remoteAddress);const b=await body(req),u=d.one('SELECT * FROM users WHERE email=? AND active=1',String(b.email||'').toLowerCase().trim());if(!verify(b.password,u?.password||'0123456789abcdef:'+ '00'.repeat(64))||!u)fail(401,'邮箱或密码有误，或账号已停用');send(res,session(res,u));return;}
      if(path==='/api/join'&&method==='POST'){rate(req.socket.remoteAddress);const b=await body(req),key='invite:'+hash(String(b.token)),inv=d.one('SELECT value FROM meta WHERE key=?',key);if(!inv)fail(400,'邀请链接无效或已使用');const item=parse(inv.value);if(item.expires<Date.now())fail(400,'邀请链接已过期');const encoded=password(b.password);d.tx(()=>{d.run('UPDATE users SET password=?,active=1 WHERE id=?',encoded,item.user_id);d.run('DELETE FROM meta WHERE key=?',key);});send(res,session(res,d.one('SELECT * FROM users WHERE id=?',item.user_id)));return;}
      const st=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('cloudheron='))?.slice(11),u=st?d.one('SELECT users.* FROM users JOIN sessions ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>? AND users.active=1',hash(st),Date.now()):null;
      if(!u)fail(401,'请登录团队账号');
      if(path==='/api/me'&&method==='GET'){send(res,{user:cleanUser(u),team:d.one("SELECT value FROM meta WHERE key='team'").value});return;}
      if(path==='/api/logout'&&method==='POST'){d.run('DELETE FROM sessions WHERE hash=?',hash(st));res.setHeader('Set-Cookie','cloudheron=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');send(res,{ok:true});return;}
      if(path==='/api/password'&&method==='POST'){const b=await body(req);if(!verify(b.current,u.password))fail(400,'当前密码有误');d.tx(()=>{d.run('UPDATE users SET password=? WHERE id=?',password(b.password),u.id);d.run('DELETE FROM sessions WHERE user_id=?',u.id);});send(res,session(res,u));return;}
      if(path==='/api/users'&&method==='GET'){send(res,d.all('SELECT * FROM users ORDER BY created_at').map(cleanUser));return;}
      if(path==='/api/users'&&method==='POST'){admin(u);const b=await body(req),uid=id('usr'),email=text(b.email,'邮箱').toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!roles.includes(b.role))fail(400,'邮箱或角色有误');const t=token();d.tx(()=>{if(d.one('SELECT id FROM users WHERE email=?',email))fail(409,'该邮箱已登记');d.run('INSERT INTO users(id,name,email,password,role,active,created_at) VALUES(?,?,?,?,?,0,?)',uid,text(b.name,'姓名'),email,password(token()),b.role,now());d.run('INSERT INTO meta VALUES(?,?)','invite:'+hash(t),json({user_id:uid,expires:Date.now()+7*86400000}));});send(res,{user:cleanUser(d.one('SELECT * FROM users WHERE id=?',uid)),invite_path:'/#join/'+t},201);return;}
      if((m=path.match(/^\/api\/users\/([^/]+)$/))&&method==='PATCH'){admin(u);const b=await body(req),target=d.one('SELECT * FROM users WHERE id=?',m[1]);if(!target)fail(404,'成员不存在');if(!roles.includes(b.role)||typeof b.active!=='boolean')fail(400,'角色或状态有误');if(target.role==='admin'&&target.active&&(b.role!=='admin'||!b.active)&&d.one("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").n<=1)fail(400,'请至少保留一位有效管理员');d.tx(()=>{d.run('UPDATE users SET role=?,active=?,name=? WHERE id=?',b.role,b.active?1:0,text(b.name||target.name,'姓名'),target.id);if(!b.active||b.password){if(b.password)d.run('UPDATE users SET password=? WHERE id=?',password(b.password),target.id);d.run('DELETE FROM sessions WHERE user_id=?',target.id);}});send(res,cleanUser(d.one('SELECT * FROM users WHERE id=?',target.id)));return;}
      if(path==='/api/projects'&&method==='GET') {send(res,d.all('SELECT * FROM projects ORDER BY created_at DESC').filter(p=>permission(u,p)).map(p=>({...p,acl:parse(p.acl),can_edit:permission(u,p,true)})));return;}
      if(path==='/api/projects'&&method==='POST'){editor(u);const b=await body(req),pid=id('project');if(!['team','private'].includes(b.visibility))fail(400,'共享范围有误');d.run('INSERT INTO projects(id,name,owner_id,visibility,created_at) VALUES(?,?,?,?,?)',pid,text(b.name,'项目名称'),u.id,b.visibility,now());send(res,d.one('SELECT * FROM projects WHERE id=?',pid),201);return;}
      if((m=path.match(/^\/api\/projects\/([^/]+)$/))&&method==='PATCH'){const p=project(u,m[1],true);if(u.role!=='admin'&&p.owner_id!==u.id)fail(403,'仅管理员或项目创建者可管理共享设置');const b=await body(req);if(!['team','private'].includes(b.visibility)||!b.acl||typeof b.acl!=='object'||Array.isArray(b.acl))fail(400,'共享配置有误');for(const [uid,level]of Object.entries(b.acl))if(!['read','edit'].includes(level)||!d.one('SELECT id FROM users WHERE id=?',uid))fail(400,'授权成员或权限有误');d.run('UPDATE projects SET name=?,visibility=?,acl=? WHERE id=?',text(b.name,'项目名称'),b.visibility,json(b.acl),p.id);send(res,{ok:true});return;}
      if((m=path.match(/^\/api\/projects\/([^/]+)\/contents$/))&&method==='GET'){project(u,m[1]);const get=(table,source)=>d.all(`SELECT * FROM ${table} WHERE project_id=? ORDER BY updated_at DESC`,m[1]).map(r=>{const j=d.one('SELECT * FROM jobs WHERE source_id=? ORDER BY created_at DESC LIMIT 1',r.id);return {id:r.id,project_id:r.project_id,source,title:r.name||r.title,status:j?.status||'draft',outputs:j?parse(j.outputs):[]};});send(res,[...get('chats','chat'),...get('workflows','workflow')]);return;}
      if((m=path.match(/^\/api\/projects\/([^/]+)\/test-cases$/))&&method==='GET'){project(u,m[1]);send(res,d.all('SELECT definition FROM project_test_cases WHERE project_id=? ORDER BY test_id',m[1]).map(x=>parse(x.definition)));return;}
      if(path==='/api/workflow-templates'&&method==='GET'){
        const saved=d.all('SELECT * FROM workflow_templates ORDER BY updated_at DESC').filter(t=>permission(u,d.one('SELECT * FROM projects WHERE id=?',t.project_id)));
        send(res,[...builtinTemplates,...saved].map(t=>templateView(t)));return;
      }
      if(path==='/api/workflow-templates'&&method==='POST'){
        editor(u);const b=await body(req),w=resource('workflows',u,b.workflow_id,true);
        if(b.revision!==w.revision)fail(409,'工作流已更新，请刷新后再保存模板');
        const tid=id('tpl'),description=b.description===undefined?'':String(b.description).trim();if(description.length>2000)fail(400,'模板描述最多 2000 字');
        d.run('INSERT INTO workflow_templates(id,project_id,owner_id,name,description,document,source_workflow_id,source_revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',tid,w.project_id,u.id,text(b.name,'模板名称'),description,w.document,w.id,w.revision,now());
        send(res,templateView(d.one('SELECT * FROM workflow_templates WHERE id=?',tid),true),201);return;
      }
      if((m=path.match(/^\/api\/workflow-templates\/([^/]+)$/))&&method==='GET'){send(res,templateView(templateResource(u,m[1]),true));return;}
      if((m=path.match(/^\/api\/workflow-templates\/([^/]+)\/instantiate$/))&&method==='POST'){
        editor(u);const t=templateResource(u,m[1]),b=await body(req);project(u,b.project_id,true);
        if(b.revision!==t.revision)fail(409,'模板版本已变化，请重新打开模板');
        if(b.keep_bindings!==undefined&&typeof b.keep_bindings!=='boolean')fail(400,'保留配置须为布尔值');
        const name=text(b.name,'工作流名称'),doc=copyTemplate(parse(t.document),name,{keepBindings:b.keep_bindings===true});wfResources(u,doc);
        send(res,wfView(createWorkflow(u,b.project_id,name,doc,'template')),201);return;
      }
      if((m=path.match(/^\/api\/workflows\/([^/]+)\/versions$/))&&method==='GET'){
        resource('workflows',u,m[1]);send(res,d.all('SELECT v.revision,v.actor_id,v.action,v.source_revision,v.saved_at,users.name AS actor_name FROM workflow_versions v LEFT JOIN users ON users.id=v.actor_id WHERE v.workflow_id=? ORDER BY v.revision DESC',m[1]));return;
      }
      if((m=path.match(/^\/api\/workflows\/([^/]+)\/versions\/(\d+)$/))&&method==='GET'){
        resource('workflows',u,m[1]);const v=d.one('SELECT * FROM workflow_versions WHERE workflow_id=? AND revision=?',m[1],Number(m[2]));if(!v)fail(404,'该历史版本不存在');send(res,{...v,document:parse(v.document)});return;
      }
      if((m=path.match(/^\/api\/workflows\/([^/]+)\/restore$/))&&method==='POST'){
        const w=resource('workflows',u,m[1],true),b=await body(req);if(!Number.isSafeInteger(b.source_revision)||b.source_revision<1)fail(400,'请选择有效历史版本');
        const v=d.one('SELECT * FROM workflow_versions WHERE workflow_id=? AND revision=?',w.id,b.source_revision);if(!v)fail(404,'该历史版本不存在');
        const doc=parse(v.document);wfResources(u,doc);send(res,wfView(storeWorkflow(w,u,b.revision,doc,'restore',v.revision)));return;
      }
      if(path==='/api/workflows/validate'&&method==='POST'){editor(u);const b=await body(req);project(u,b.project_id,true);wfResources(u,b.document);send(res,{ok:true});return;}
      if(path==='/api/workflows'&&method==='GET'){send(res,d.all('SELECT * FROM workflows ORDER BY updated_at DESC').filter(w=>{const p=d.one('SELECT * FROM projects WHERE id=?',w.project_id);return permission(u,p);}).map(wfView));return;}
      if(path==='/api/workflows'&&method==='POST'){editor(u);const b=await body(req);project(u,b.project_id,true);const name=text(b.name,'工作流名称'),w=b.document||template(name);wfResources(u,w);send(res,wfView(createWorkflow(u,b.project_id,name,w)),201);return;}
      if((m=path.match(/^\/api\/workflows\/([^/]+)$/))&&method==='GET'){const w=resource('workflows',u,m[1]);send(res,{...wfView(w),can_edit:permission(u,d.one('SELECT * FROM projects WHERE id=?',w.project_id),true),job:jobViewOrNull(d.one('SELECT * FROM jobs WHERE source_id=? ORDER BY created_at DESC LIMIT 1',w.id))});return;}
      if((m=path.match(/^\/api\/workflows\/([^/]+)$/))&&method==='PUT'){const w=resource('workflows',u,m[1],true),b=await body(req);wfResources(u,b.document);send(res,wfView(storeWorkflow(w,u,b.revision,b.document,'save')));return;}
      if((m=path.match(/^\/api\/workflows\/([^/]+)\/run$/))&&method==='POST'){const w=resource('workflows',u,m[1],true),b=await body(req),record=requestRecord(req,u,'workflow:'+w.id,b);if(replay(res,record))return;if(b.revision!==w.revision)fail(409,'请保存或刷新当前工作流再运行');const document=parse(w.document);validateWorkflow(document);send(res,d.tx(()=>{const j=enqueue(u,{project_id:w.project_id,source:'workflow',source_id:w.id,snapshot:{document,input:{}}});record.record(j.id);return j;}),202);return;}
      if((m=path.match(/^\/api\/workflows\/([^/]+)\/assist$/))&&method==='POST'){
        const w=resource('workflows',u,m[1],true),b=await body(req);if(!['analyze','modify'].includes(b.mode))fail(400,'请选择分析或修改');const prompt=text(b.prompt,'对话内容',10000),api=adapters(null);
        const instruction=b.mode==='analyze'?'仅分析工作流，说明问题与建议。禁止执行任务。':`你是工作流编辑助手。只返回 JSON 对象 {"explanation":"修改摘要","document":完整工作流JSON}。schema_version 为 1.0，节点类型限定 ${Object.keys(nodeTypes).join(',')}。保留已有模型和资产编号，完整返回所有节点与连线，不执行任何任务。`;
        const options=normalizeApiOptions('text',b.params||{});const result=await api.chat(model(b.model_id),[{role:'system',content:instruction},{role:'user',content:json({workflow:parse(w.document),request:prompt})}],options);
        if(b.mode==='analyze'){send(res,{analysis:result});return;}
        let proposal;try{proposal=JSON.parse(result.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{fail(422,'AI 返回格式有误，请重试；当前工作流保持原样');}
        wfResources(u,proposal.document);const pid=id('proposal');d.run('INSERT INTO proposals(id,workflow_id,user_id,base_revision,document,explanation,expires) VALUES(?,?,?,?,?,?,?)',pid,w.id,u.id,w.revision,json(proposal.document),text(proposal.explanation,'修改摘要',4000),Date.now()+3600000);
        send(res,{id:pid,base_revision:w.revision,explanation:proposal.explanation,before:parse(w.document),after:proposal.document});return;
      }
      if((m=path.match(/^\/api\/proposals\/([^/]+)\/confirm$/))&&method==='POST'){
        const p=d.one('SELECT * FROM proposals WHERE id=? AND user_id=?',m[1],u.id);if(!p||p.status!=='pending'||p.expires<Date.now())fail(409,'提案已失效，请重新请求修改');resource('workflows',u,p.workflow_id,true);wfResources(u,parse(p.document));
        d.tx(()=>{const result=d.run('UPDATE workflows SET document=?,name=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',p.document,text(parse(p.document).name||'工作流','名称'),now(),p.workflow_id,p.base_revision);if(!result.changes)fail(409,'工作流已改变，提案未应用，请重新请求修改');recordVersion(d.one('SELECT * FROM workflows WHERE id=?',p.workflow_id),u,'ai_modify');d.run("UPDATE proposals SET status='confirmed' WHERE id=?",p.id);});send(res,wfView(d.one('SELECT * FROM workflows WHERE id=?',p.workflow_id)));return;
      }
      if(path==='/api/chats'&&method==='GET'){send(res,d.all('SELECT * FROM chats ORDER BY updated_at DESC').filter(c=>permission(u,d.one('SELECT * FROM projects WHERE id=?',c.project_id))).map(c=>({...c,messages:undefined})));return;}
      if(path==='/api/chats'&&method==='POST'){const b=await body(req);project(u,b.project_id,true);const cid=id('chat');d.run('INSERT INTO chats(id,project_id,title,updated_at) VALUES(?,?,?,?)',cid,b.project_id,text(b.title,'对话名称'),now());send(res,d.one('SELECT * FROM chats WHERE id=?',cid),201);return;}
      if((m=path.match(/^\/api\/chats\/([^/]+)$/))&&method==='GET'){const c=resource('chats',u,m[1]);send(res,{...c,messages:parse(c.messages),can_edit:permission(u,d.one('SELECT * FROM projects WHERE id=?',c.project_id),true),job:jobViewOrNull(d.one('SELECT * FROM jobs WHERE source_id=? ORDER BY created_at DESC LIMIT 1',c.id))});return;}
      if((m=path.match(/^\/api\/chats\/([^/]+)\/messages$/))&&method==='POST'){
        const c=resource('chats',u,m[1],true),b=await body(req),record=requestRecord(req,u,'chat:'+c.id,b);if(replay(res,record))return;const prompt=text(b.prompt,'创作描述',32000),config=normalizeChatConfig(b.config,{getModel:model,getSkill:sid=>d.one('SELECT * FROM skills WHERE id=?',sid),getExpert:eid=>d.one('SELECT * FROM experts WHERE id=?',eid)});
        for(const aid of config.asset_ids)asset(u,aid);
        if(d.one("SELECT id FROM jobs WHERE source_id=? AND status IN ('queued','running')",c.id))fail(409,'当前对话正在生成，请完成后再发送');
        const messages=parse(c.messages);messages.push({id:id('msg'),role:'user',text:prompt,config,at:now()});
        const job=d.tx(()=>{const j=enqueue(u,{project_id:c.project_id,source:'chat',source_id:c.id,snapshot:{prompt,config,messages}});record.record(j.id);d.run('UPDATE chats SET messages=?,updated_at=? WHERE id=?',json(messages),now(),c.id);return j;});send(res,job,202);return;
      }
      if(path==='/api/assets'&&method==='GET'){send(res,d.all('SELECT * FROM assets ORDER BY created_at DESC').filter(a=>a.project_id?permission(u,d.one('SELECT * FROM projects WHERE id=?',a.project_id)):permission(u,a)).map(assetView));return;}
      if(path==='/api/assets'&&method==='POST'){editor(u);const b=await body(req);if(b.project_id)project(u,b.project_id,true);if(!['image','video','character','scene','prop','style'].includes(b.kind)||!['team','private'].includes(b.visibility))fail(400,'资产类型或共享范围有误');const data=Buffer.from(String(b.base64||''),'base64');if(data.length>20*1024*1024)fail(413,'上传文件上限为 20 MB');sniff(data,b.mime);let version=1,parent=null;if(b.parent_id){parent=asset(u,b.parent_id);if(parent.owner_id!==u.id&&u.role!=='admin')fail(403,'仅资产创建者或管理员可上传新版本');version=parent.version+1;}
        const aid=id('asset'),file=aid+extname(String(b.filename||''));await writeFile(join(d.dir,'media',file),data,{mode:0o600,flag:'wx'});const family=parent?(parse(parent.metadata).family_id||parent.id):aid;if(parent)version=Math.max(parent.version,d.one("SELECT COALESCE(MAX(version),0) n FROM assets WHERE id=? OR json_extract(metadata,'$.family_id')=?",family,family).n)+1;d.run('INSERT INTO assets(id,project_id,owner_id,name,kind,version,visibility,mime,file,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',aid,parent?.project_id||b.project_id||null,u.id,text(b.name,'资产名称'),b.kind,version,b.visibility,b.mime,file,json({family_id:family,parent_id:b.parent_id||null,filename:text(b.filename||'media','文件名'),description:String(b.description||'').slice(0,4000)}),now());send(res,assetView(d.one('SELECT * FROM assets WHERE id=?',aid)),201);return;}
      if((m=path.match(/^\/api\/assets\/([^/]+)\/media$/))&&method==='GET'){await mediaResponse(req,res,asset(u,m[1]));return;}
      if((m=path.match(/^\/api\/assets\/([^/]+)$/))&&method==='PATCH'){editor(u);const a=asset(u,m[1]);if(a.project_id)project(u,a.project_id,true);else if(u.role!=='admin'&&a.owner_id!==u.id)fail(403,'仅创建者或管理员可修改独立资产');const b=await body(req);if(!['team','private'].includes(b.visibility))fail(400,'共享范围有误');d.run('UPDATE assets SET name=?,visibility=?,metadata=? WHERE id=?',text(b.name,'资产名称'),b.visibility,json({...parse(a.metadata),description:String(b.description||'').slice(0,4000)}),a.id);send(res,{ok:true});return;}
      if(path==='/api/models'&&method==='GET'){send(res,d.all('SELECT * FROM models ORDER BY updated_at DESC').map(m=>modelView(m,u)));return;}
      if(path==='/api/models'&&method==='POST'){admin(u);const b=await body(req),mid=id('model');validateModel(b.spec);d.run('INSERT INTO models(id,name,spec,secret,updated_at) VALUES(?,?,?,?,?)',mid,text(b.name,'配置名称'),json(b.spec),v.encrypt(String(b.api_key||'')),now());send(res,modelView(d.one('SELECT * FROM models WHERE id=?',mid),u),201);return;}
      if((m=path.match(/^\/api\/models\/([^/]+)$/))&&method==='PUT'){admin(u);const old=d.one('SELECT * FROM models WHERE id=?',m[1]);if(!old)fail(404,'模型不存在');const b=await body(req);validateModel(b.spec);d.run('UPDATE models SET name=?,spec=?,secret=?,enabled=?,updated_at=? WHERE id=?',text(b.name,'配置名称'),json(b.spec),b.api_key===undefined?old.secret:v.encrypt(String(b.api_key)),b.enabled===false?0:1,now(),old.id);send(res,modelView(d.one('SELECT * FROM models WHERE id=?',old.id),u));return;}
      if((m=path.match(/^\/api\/models\/([^/]+)\/check$/))&&method==='POST'){admin(u);const mod=model(m[1]);const result=await adapters(null).request(mod,parse(mod.spec).paths?.models||'/models');send(res,{ok:true,models:(result.data||[]).map(x=>x.id),note:'服务连接成功；生成能力以实际任务结果为准'});return;}
      if(path==='/api/system/status'&&method==='GET'){admin(u);send(res,{version:'0.1.6',state:closing?'draining':'ready',workers:runtime.state(),max_pending_per_user:pendingLimit,queued:d.one("SELECT COUNT(*) n FROM jobs WHERE status='queued'").n,running:d.one("SELECT COUNT(*) n FROM jobs WHERE status='running'").n});return;}
      if(path==='/api/task-options'&&method==='GET'){send(res,taskOptions);return;}
      if(path==='/api/agents'&&method==='GET'){send(res,agents);return;}
      if(path==='/api/experts'&&method==='GET'){send(res,d.all('SELECT * FROM experts ORDER BY builtin DESC,name').map(x=>({...x,skill_ids:parse(x.skill_ids)})));return;}
      if((path==='/api/experts'&&method==='POST')||((m=path.match(/^\/api\/experts\/([^/]+)$/))&&method==='PUT')){
        admin(u);const b=await body(req);if(!['image','video','prompt','all'].includes(b.task)||!Array.isArray(b.skill_ids)||b.skill_ids.length<2||b.skill_ids.length>20||new Set(b.skill_ids).size!==b.skill_ids.length)fail(400,'专家须组合 2–20 个不同 Skill');
        for(const sid of b.skill_ids){const sk=d.one('SELECT * FROM skills WHERE id=?',sid);if(!sk)fail(400,'专家组合包含不存在的 Skill');}
        const eid=method==='PUT'?m[1]:id('expert');if(method==='PUT'&&!d.one('SELECT id FROM experts WHERE id=?',eid))fail(404,'专家不存在');
        if(method==='POST')d.run('INSERT INTO experts(id,name,task,skill_ids) VALUES(?,?,?,?)',eid,text(b.name,'专家名称'),b.task,json(b.skill_ids));else d.run('UPDATE experts SET name=?,task=?,skill_ids=? WHERE id=?',text(b.name,'专家名称'),b.task,json(b.skill_ids),eid);
        const row=d.one('SELECT * FROM experts WHERE id=?',eid);send(res,{...row,skill_ids:parse(row.skill_ids)},method==='POST'?201:200);return;
      }
      if(path==='/api/test-workspace'&&(method==='GET'||method==='POST')){
        const key='manual_workspace_'+u.id;let value=d.one('SELECT value FROM meta WHERE key=?',key);let workspace=value?parse(value.value):null;
        if(workspace&&!d.one('SELECT id FROM projects WHERE id=?',workspace.project_id))workspace=null;
        if(method==='POST'){editor(u);workspace=seedManualWorkspace(d,u);}
        send(res,workspace);return;
      }
      if(path==='/api/skills'&&method==='GET'){send(res,d.all('SELECT * FROM skills ORDER BY builtin DESC,name'));return;}
      if(path==='/api/skills'&&method==='POST'){admin(u);const b=await body(req);if(!['image','video','prompt','all'].includes(b.task)||!String(b.template).includes('{{prompt}}'))fail(400,'Skill 须指定任务并包含 {{prompt}} 占位符');const sid=id('skill');d.run('INSERT INTO skills(id,name,task,template) VALUES(?,?,?,?)',sid,text(b.name,'Skill 名称'),b.task,text(b.template,'提示词模板',5000));send(res,d.one('SELECT * FROM skills WHERE id=?',sid),201);return;}
      if((m=path.match(/^\/api\/skills\/([^/]+)$/))&&method==='PUT'){admin(u);const s=d.one('SELECT * FROM skills WHERE id=?',m[1]);if(!s)fail(404,'Skill 不存在');const b=await body(req);if(!['image','video','prompt','all'].includes(b.task)||!String(b.template).includes('{{prompt}}'))fail(400,'Skill 格式有误');d.run('UPDATE skills SET name=?,task=?,template=? WHERE id=?',text(b.name,'名称'),b.task,text(b.template,'模板',5000),s.id);send(res,{ok:true});return;}
      if(path==='/api/publications'&&method==='GET'){send(res,d.all('SELECT * FROM publications ORDER BY created_at DESC').filter(p=>permission(u,d.one('SELECT * FROM projects WHERE id=?',p.project_id))).map(p=>({...p,key_hash:undefined,document:undefined})));return;}
      if(path==='/api/publications'&&method==='POST'){editor(u);const b=await body(req),w=resource('workflows',u,b.workflow_id,true);wfResources(u,parse(w.document));const pid=id('endpoint'),t=token();d.run('INSERT INTO publications(id,project_id,workflow_id,owner_id,name,version,document,key_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)',pid,w.project_id,w.id,u.id,text(b.name,'API 名称'),text(b.version,'版本',60),w.document,hash(t),now());send(res,{id:pid,token:t,path:'/api/v1/endpoints/'+pid+'/runs',version:b.version},201);return;}
      if((m=path.match(/^\/api\/publications\/([^/]+)$/))&&method==='PATCH'){const p=resource('publications',u,m[1],true);if(p.owner_id!==u.id&&u.role!=='admin')fail(403,'仅发布者或管理员可撤销接口');d.run('UPDATE publications SET enabled=0 WHERE id=?',p.id);send(res,{ok:true});return;}
      if((m=path.match(/^\/api\/jobs\/([^/]+)$/))&&method==='GET'){const j=resource('jobs',u,m[1]);send(res,jobView(j));return;}
      fail(404,'请求路径不存在');
    }catch(e){if(!res.headersSent)send(res,{error:e.status?e.message:(e.message.includes('UNIQUE')?'记录已存在':e.message)},e.status||400);else res.end();}
  });
  function jobViewOrNull(j){return j?jobView(j):null;}
  server.requestTimeout=300000;server.headersTimeout=20000;
  server.on('listening',()=>{if(!closing)runtime.start();});
  const close=()=>{if(closePromise)return closePromise;closing=true;runtime.pause();closePromise=(async()=>{await Promise.all([new Promise(r=>server.close(r)),runtime.drain()]);try{d.db.close();}finally{unlock();}})();return closePromise;};
  return {server,db:d,close};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createApp(),port=integerSetting(process.env.PORT??8800,'PORT',1,65535),host=process.env.HOST||'127.0.0.1';
  app.server.listen(port,host,()=>console.log(`云鹭 · CloudHeron http://${host}:${port}`));
  const shutdown=()=>{app.close().catch(e=>{console.error(e.message);process.exitCode=1;});};
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  app.server.once('error',e=>{console.error(e.message);process.exitCode=1;shutdown();});
}
