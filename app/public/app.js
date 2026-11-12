import {createWorkflowHistory,workflowHistoryShortcut} from './features/workflow-history.js';
import {createProjectContext} from './features/project-context.js';
import {createStudioFeature} from './features/studio/index.js';
import {createModelFeature} from './features/models/index.js';
const $=s=>document.querySelector(s),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={creations:[],creation:null,modelStyles:[],modelCategory:'all',modelQuery:'',modelChecks:{},collectionProject:{workflow:'',create:''},queries:{},user:null,projects:[],agents:[],experts:[],chatConfigs:{},models:[],assets:[],skills:[],users:[],workflows:[],chats:[],publications:[],templates:[],taskOptions:{},workflowView:'list',theme:localStorage.getItem('cloudheron-theme')||'light',route:'projects',id:null,w:null,c:null,selected:null,dirty:false,filter:'all',analysis:'',proposal:null,connecting:null,zoom:.8};
const names={studio:'集成创作 · 批量生成',projects:'项目',workflow:'工作流',create:'对话创作',assets:'资产库',skills:'Agent、Skill 与专家',models:'模型配置',team:'成员与权限',api:'工作流 API',testing:'手动测试'};
const roleName={admin:'管理员',editor:'编辑者',viewer:'查看者'},statusName={pending:'待执行',draft:'待生成',queued:'排队中',running:'生成中',completed:'已完成',failed:'失败'};
const nodeNames={prompt_input:'提示词输入',reference_asset:'参考资产',prompt_agent:'提示词 Agent',image_generate:'图片生成',video_generate:'视频生成',media_output:'产物输出'};
const nodeTone={prompt_input:'text',reference_asset:'assets',prompt_agent:'spark',image_generate:'image',video_generate:'film',media_output:'save'};
const iconPaths={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',workflow:'M4 5h6v5H4z M14 14h6v5h-6z M7 10v6h7 M10 7h7v7',chat:'M4 4h16v12H9l-5 4z',film:'M3 5h18v14H3z M7 5v14 M17 5v14',assets:'M3 6h7l2 2h9v12H3z',spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',model:'M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10',users:'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M8.5 3a4 4 0 1 0 0 8 M18 8a3 3 0 0 1 0 6',api:'M8 6L2 12l6 6 M16 6l6 6-6 6 M14 3l-4 18',plus:'M12 5v14 M5 12h14',play:'M8 4l12 8-12 8z',save:'M4 3h13l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8',image:'M3 3h18v18H3z M3 16l5-5 5 5 3-3 5 5 M15 7h.01',text:'M4 5h16 M12 5v15 M8 20h8',logout:'M9 3H3v18h6 M13 7l5 5-5 5 M7 12h11',settings:'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3',close:'M6 6l12 12 M18 6L6 18',arrow:'M5 12h14 M13 6l6 6-6 6'};
const I=n=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[n]||iconPaths.spark}"/></svg>`;
const btn=(label,action,cls='',extra='',icon='')=>`<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${icon?I(icon):''}${label}</button>`;
const badge=(s,c='')=>`<span class="badge ${c}">${escape(s)}</span>`;
const input=(label,name,value='',type='text',extra='')=>`<div class="form-field"><label for="${name}">${label}</label><input class="input" id="${name}" name="${name}" type="${type}" value="${escape(value)}" ${extra}></div>`;
const select=(label,name,options,value='')=>`<div class="form-field"><label for="${name}">${label}</label><select class="input" id="${name}" name="${name}">${options.map(o=>{const [v,t]=Array.isArray(o)?o:[o,o];return `<option value="${escape(v)}" ${v===value?'selected':''}>${escape(t)}</option>`;}).join('')}</select></div>`;
const area=(label,name,value='',extra='')=>`<div class="form-field"><label for="${name}">${label}</label><textarea class="input" id="${name}" name="${name}" ${extra}>${escape(value)}</textarea></div>`;
const head=(title,desc,actions='')=>`<div class="page-head"><div><h1>${escape(title)}</h1><p>${escape(desc)}</p></div><div class="head-actions">${actions}</div></div>`;
const empty=(message,action='')=>`<div class="empty product-empty"><div>${I('image')}</div><h3>${escape(message)}</h3>${action}</div>`;
const editable=()=>state.user?.role!=='viewer';
const optionsProjects=()=>state.projects.filter(p=>p.can_edit).map(p=>[p.id,p.name]);
const projectName=id=>state.projects.find(p=>p.id===id)?.name||'项目';
const modelOptions=cap=>[['','请选择模型'],...state.models.filter(m=>m.enabled&&m.spec.capabilities.includes(cap)).map(m=>[m.id,m.name])];
const assetOptions=(kind='image')=>[['','未选择'],...state.assets.filter(a=>a.mime.startsWith('image/')||(kind==='video'&&a.mime.startsWith('video/'))).map(a=>[a.id,a.name+' · v'+a.version+' · '+(a.mime.startsWith('video/')?'视频':'图片')])];
const urlAsset=id=>'/api/assets/'+encodeURIComponent(id)+'/media';
const preview=id=>{const a=state.assets.find(a=>a.id===id);return a?.mime.startsWith('video/')?`<video src="${urlAsset(id)}" controls preload="metadata" playsinline></video>`:a?`<img src="${urlAsset(id)}" alt="${escape(a.name)}" loading="lazy">`:'';};
async function api(path,method='GET',data,options={}){const r=await fetch('/api/'+path,{...options,method,headers:{'Content-Type':'application/json','X-CloudHeron':'1',...options.headers},...(data!==undefined?{body:JSON.stringify(data)}:{})});const out=await r.json();if(!r.ok){const e=new Error(out.error||'请求失败');e.status=r.status;throw e;}return out;}
function toast(s){$('#toast').textContent=s;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),4000);}
function applyTheme(){document.body.classList.toggle('light',state.theme==='light');localStorage.setItem('cloudheron-theme',state.theme);}
const goto=(r,id='')=>location.hash='#'+r+(id?'/'+id:'');
function modal(title,content,onSubmit,submit='保存'){
  const d=$('#dialog');if(d.open)d.close();d.innerHTML=`<form method="dialog" id="modal-form"><header><h2>${escape(title)}</h2>${btn('关闭','close-dialog','','aria-label="关闭弹窗"','close')}</header><div class="dialog-body">${content}<p class="form-error" role="alert"></p></div><footer>${btn('取消','close-dialog')}<button class="btn primary" type="submit">${submit}</button></footer></form>`;
  d.showModal();$('#modal-form').onsubmit=async e=>{if(!onSubmit)return;e.preventDefault();const b=e.submitter;b.disabled=true;try{await onSubmit(Object.fromEntries(new FormData(e.target)),e.target);d.close();}catch(err){d.querySelector('.form-error').textContent=err.message;}finally{b.disabled=false;}};
}
const modelUI=createModelFeature({state,$,escape,head,btn,badge,input,select,area,modal,api,loadCommon,render,toast,redraw:()=>{shell(modelsPage());bindForms();},optionsProjects,goto});
const projectContext=createProjectContext({state,api,modal,area,select,escape,toast});
const studioUI=createStudioFeature({contextPicker:projectContext.picker,state,$,escape,head,btn,input,select,area,modal,api,loadCommon,render,toast,modelOptions,mediaList,jobPanel,optionsProjects,goto,redraw:()=>{shell(studioUI.page());bindForms();}});
async function loadCommon(){const [projects,models,assets,skills,users,workflows,chats,publications,agents,experts,testWorkspace,templates,taskOptions,modelStyles,creations]=await Promise.all(['projects','models','assets','skills','users','workflows','chats','publications','agents','experts','test-workspace','workflow-templates','task-options','model-styles','creations'].map(p=>p==='creations'?api(p).catch(e=>{if(e.status===404)return [];throw e;}):p==='model-styles'?api(p).catch(e=>{if(e.status!==404)throw e;return [{id:'legacy',name:'现有自定义配置',capabilities:['text','image','image_edit','video','video_reference'],base_hint:'https://your-service.example/v1',note:'旧版服务保留原有接口配置'}];}):api(p)));Object.assign(state,{projects,models,assets,skills,users,workflows,chats,publications,agents,experts,testWorkspace,templates,taskOptions,modelStyles,creations});}
function loginPage(setup=false,joinToken=null){
  $('#app').innerHTML=`<div class="login-layout" data-req="REQ-016 REQ-026 REQ-031 REQ-032"><section class="login-art">${window.loginBackdrop()}<div class="brand"><div class="brandmark">${window.brandIcon()}</div><div><strong>云鹭 · CloudHeron</strong><small>图片与视频创作平台</small></div></div><div class="login-brand-copy"><h1>云鹭</h1><span class="brand-english">CloudHeron</span><p>图片与视频创作平台</p></div><div class="note">${escape(state.team||'团队创作空间')}</div></section><section class="login-form"><div class="login-mobile-brand">${window.brandIcon()}<div><strong>云鹭</strong><small>CloudHeron</small></div></div><div class="login-theme">${btn(state.theme==='light'?'浅色':'深色','theme','','','settings')}</div><div><h1>${setup?'创建你的团队':joinToken?'加入团队':'进入工作台'}</h1><p>${setup?'首次使用，创建团队与管理员账号。':joinToken?'设置密码，激活你的团队账号。':'使用团队账号，继续你的创作。'}</p><form id="auth-form">${setup?input('团队名称','team','','text','required')+input('你的姓名','name','','text','required'):''}${!joinToken?input('邮箱','email','','email','required autocomplete="username"'):''}${input(joinToken?'设置密码':'密码','password','','password',`required minlength="10" maxlength="200" autocomplete="${setup||joinToken?'new-password':'current-password'}"`)}<p class="form-error" role="alert"></p><button class="btn primary" type="submit">${setup?'创建团队':joinToken?'激活账号':'进入工作台'} ${I('arrow')}</button></form><div class="login-foot">${setup?'密码至少 10 位；此账号为团队管理员。':joinToken?'邀请链接有效期为 7 天，使用后立即失效。':'账号由团队管理员邀请<br>忘记密码请联系团队管理员重置。'}</div></div></section></div>`;
  $('#auth-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const values=Object.fromEntries(new FormData(e.target));const result=await api(setup?'setup':joinToken?'join':'login','POST',{...values,...(joinToken?{token:joinToken}:{})});state.user=result.user;const me=await api('me');state.team=me.team;await loadCommon();if(location.hash.startsWith('#join')||location.hash==='#login')goto('projects');else render();}catch(err){e.target.querySelector('.form-error').textContent=err.message;}finally{b.disabled=false;}};
}
function shell(content){
  const groups=[['创作空间',[['projects','grid'],['studio','spark'],['create','chat'],['workflow','workflow']]],['创作资源',[['assets','assets'],['skills','spark']]],['团队管理',[['models','model'],['team','users'],['api','api']]]];
  $('#app').innerHTML=`<aside class="sidebar"><a class="brand" href="#projects"><div class="brandmark">${window.brandIcon()}</div><div><strong>云鹭</strong><small>CloudHeron</small></div></a><div class="team-picker">${escape(state.team)}</div>${groups.map(([title,list])=>`<div class="nav-label">${title}</div>${list.map(([r,i])=>`<a class="nav-item ${state.route===r?'active':''}" href="#${r}" ${state.route===r?'aria-current="page"':''}>${I(i)}<span>${names[r]}</span></a>`).join('')}`).join('')}<div class="user-block"><div class="avatar">${escape(state.user.name.slice(0,1))}</div><button type="button" class="user-name" data-action="password"><strong>${escape(state.user.name)}</strong><small>${roleName[state.user.role]}</small></button>${btn('','logout','ghost','aria-label="退出登录"','logout')}</div></aside><main class="main"><header class="topbar"><div class="crumb">${escape(state.team)} <span>/</span> <b>${names[state.route]||'项目'}</b></div><div class="top-actions"><a class="btn small" href="#testing">手动测试</a><div class="mobile-account">${btn('账号','password','small')}${btn('退出','logout','small')}</div>${btn(state.theme==='light'?'浅色':'深色','theme','theme-btn','','settings')}</div></header>${content}</main>`;
}
function projectPicker(route,pid=''){
  return `<select class="input compact" data-collection-project="${route}" aria-label="${route==='workflow'?'工作流':'对话'}所属项目"><option value="">全部项目</option>${state.projects.map(p=>`<option value="${p.id}" ${p.id===pid?'selected':''}>${escape(p.name)}</option>`).join('')}</select>`;
}
function collectionGroups(route,items,renderItem,compact=false){
  const pid=state.collectionProject[route],projects=state.projects.filter(p=>!pid||p.id===pid);
  return projects.map(p=>{const entries=items.filter(x=>x.project_id===p.id);return `<section class="project-group ${compact?'compact-group':''}" data-project-group="${p.id}"><header><a href="#${route}/project/${p.id}">${escape(p.name)}</a>${badge(entries.length+(route==='workflow'?' 个工作流':' 个对话'))}${p.can_edit?btn('新建',route==='workflow'?'workflow-new':'chat-new','small',`data-project="${p.id}" aria-label="在${escape(p.name)}中新建${route==='workflow'?'工作流':'对话'}"`,'plus'):''}</header><div class="${compact?'group-threads':'list-cards'}">${entries.length?entries.map(renderItem).join(''):`<p class="note group-empty">${route==='workflow'?'还没有工作流':'还没有对话'}</p>`}</div></section>`;}).join('');
}
async function projectsPage(){
  const selected=state.projects.find(p=>p.id===state.id),list=selected?[selected]:state.projects;const projectCases=selected?await api('projects/'+selected.id+'/test-cases'):[];
  const contents=(await Promise.all(list.map(p=>api('projects/'+p.id+'/contents')))).flat().filter(c=>state.filter==='all'||c.source===state.filter);
  return `<div class="page project-page" data-req="REQ-001 REQ-002 REQ-027 REQ-046 REQ-047">${projectCases.length?`<div class="notice">本项目已预置 ${projectCases.length} 条手动测试用例，以及工作流、对话和参考资产。<a class="btn small" href="#testing/${selected.id}">打开项目测试用例</a></div>`:''}<section class="project-banner">${head(selected?selected.name:'云鹭创作工作台',selected?'在同一项目中管理设定、对话、工作流和创作成果。':'管理项目，用对话、批量生成或画布创作图片和视频。',(selected?btn('项目设定','project-context','',`data-id="${selected.id}"`):'')+(editable()?btn('新建项目','project-new','','','plus')+btn('新建内容','content-new','primary','','plus'):''))}</section><div class="toolbar"><div class="segmented">${[['all','全部'],['chat','对话创作'],['workflow','工作流'],['creation','集成创作']].map(([v,t])=>btn(t,'filter',state.filter===v?'active':'',`data-value="${v}"`)).join('')}</div><select id="project-filter" class="input compact" aria-label="项目筛选"><option value="">全部项目</option>${state.projects.map(p=>`<option value="${p.id}" ${state.id===p.id?'selected':''}>${escape(p.name)}</option>`).join('')}</select>${selected?btn('共享设置','project-share','',`data-id="${selected.id}"`):''}<div class="search"><input class="product-search" aria-label="搜索项目内容" placeholder="搜索项目内容" value="${escape(state.queries.projects||'')}"></div><span class="note" id="content-count">${contents.length} 项内容</span></div>${!list.length?empty('创建第一个项目，开始积累你的创作。',editable()?btn('新建项目','project-new','primary'):''):''}<div class="project-collections"><a class="btn small" href="#projects">全部项目</a>${state.projects.map(p=>`<div class="project-collection ${p.id===state.id?'active':''}"><a href="#projects/${p.id}">${escape(p.name)}</a>${badge(p.visibility==='team'?'团队共享':'指定成员')}${btn('共享设置','project-share','small',`data-id="${p.id}"`)}</div>`).join('')}</div><div class="grid3">${contents.map(c=>`<article class="card project-output-card" data-card-search="${escape(c.title+' '+projectName(c.project_id))}"><a class="project-content-button" href="#${c.source==='creation'?'studio':c.source==='chat'?'create':'workflow'}/${c.id}"><div class="art-frame">${c.outputs.length?preview(c.outputs[0]):`<div class="media-placeholder">${I(c.source==='chat'?'chat':'workflow')}<span>${statusName[c.status]}</span></div>`}</div><div class="project-info"><small>${escape(projectName(c.project_id))}</small><div class="row between">${badge(c.source==='creation'?'集成创作':c.source==='chat'?'对话创作':'工作流',c.source==='chat'?'blue':'')}${badge(statusName[c.status],c.status==='failed'?'red':'')}</div><h2>${escape(c.title)}</h2><p>打开${c.source==='creation'?'集成创作与产物':c.source==='chat'?'对话历史':'工作流与产物'} ${I('arrow')}</p></div></a></article>`).join('')}</div>${list.length&&!contents.length?empty('这个项目还没有创作内容。',editable()?btn('新建内容','content-new','primary'):''):''}</div>`;
}
function mediaList(ids){return ids.map(aid=>`<div class="output-media">${preview(aid)}<div class="row between"><span class="note">${escape(state.assets.find(a=>a.id===aid)?.name||'生成产物')}</span><a class="btn small" href="${urlAsset(aid)}" download>下载</a>${btn('资产详情','asset-edit','small',`data-id="${aid}"`)}</div></div>`).join('');}
function stepLabel(id){if(state.creation){if(id==='plan')return '整理画面';if(id==='output')return '收集产物';if(id.startsWith('ref_'))return '读取参考资产';const m=id.match(/^(scene|generate)_(\d+)$/);if(m)return (m[1]==='scene'?'准备':'生成')+' · '+(state.creation.document.cards[Number(m[2])-1]?.title||'画面'+m[2]);}return state.w?.document.nodes.find(n=>n.id===id)?.label||id;}
function stepOrder(id){if(state.creation){if(id==='plan')return 0;if(id==='output')return 10000;if(id.startsWith('ref_'))return 1;const m=id.match(/^(scene|generate)_(\d+)$/);if(m)return Number(m[2])*2+(m[1]==='generate'?1:0);}const i=state.w?.document.nodes.findIndex(n=>n.id===id);return i>=0?i:10000;}
function jobSteps(j){const steps={...(j.steps||{})};if(state.creation&&j.source==='creation'){for(const i of (state.creation.run_card_indices||state.creation.document.cards.map((_,i)=>i)).map(i=>i+1))for(const id of ['scene_'+i,'generate_'+i])steps[id]??={status:'pending'};steps.output??={status:'pending'};}return Object.entries(steps).sort((a,b)=>stepOrder(a[0])-stepOrder(b[0]));}
function jobPanel(j){if(!j)return '';const partial=Object.values(j.steps||{}).flatMap(s=>s.output?.asset_ids||s.output?.media||[]).map(a=>typeof a==='string'?a:a.id);const ids=[...new Set([...(j.outputs||[]),...partial])];return `<div class="job-status ${j.status==='failed'?'failed':''}"><div class="row between"><strong>${statusName[j.status]}</strong><span class="note">${escape(j.id.slice(-8))}</span></div>${jobSteps(j).map(([id,s])=>`<div class="step ${s.status}"><span>${escape(stepLabel(id))}</span><span>${statusName[s.status]}</span>${s.error?`<p class="form-error">${escape(s.error)}</p>`:''}</div>`).join('')}${j.error?`<p class="form-error" role="alert">${escape(j.error)}</p>`:''}${mediaList(ids)}</div>`;}
function workflowPage(){
  if(state.workflowView==='templates')return templateLibraryPage();
  const w=state.w;if(!w)return `<div class="page" data-req="REQ-036">${head('节点工作流','按项目管理工作流，保存 JSON 后手动运行。',btn('模板库','templates-open')+(editable()?btn('导入 JSON','workflow-import-new')+btn('新建工作流','workflow-new','primary','','plus'):''))}<div class="toolbar">${projectPicker('workflow',state.collectionProject.workflow)}</div><div class="project-groups">${collectionGroups('workflow',state.workflows,w=>`<a class="card list-card" href="#workflow/${w.id}"><div>${I('workflow')}<h3>${escape(w.name)}</h3></div>${I('arrow')}</a>`)}</div>${!state.projects.length?empty('还没有项目，可新建工作流并同时创建项目。',editable()?btn('新建工作流','workflow-new','primary'):''):''}</div>`;
  const n=w.document.nodes.find(n=>n.id===state.selected),can=w.can_edit;
  return `<div class="workflow-product" data-req="REQ-005 REQ-006 REQ-007 REQ-008 REQ-009 REQ-010 REQ-011"><div class="wf-heading"><div><a href="#workflow/project/${w.project_id}" class="note">工作流 / ${escape(projectName(w.project_id))}</a>${projectPicker('workflow',w.project_id)}<h2><span id="workflow-name">${escape(w.name)}</span> <span class="note" id="dirty-label" aria-live="polite">${state.dirty?'未保存':'已保存 · r'+w.revision}</span></h2></div><div class="row">${(can?btn('导入 JSON','workflow-import'):'')+btn('查看 JSON','workflow-json')}${btn('导出 JSON','workflow-export')}${btn('版本历史','workflow-versions')}${can?btn('撤销','workflow-undo','','title="撤销 (Ctrl/⌘+Z)" aria-keyshortcuts="Control+Z Meta+Z" '+(state.workflowHistory.canUndo?'':'disabled'))+btn('重做','workflow-redo','','title="重做 (Ctrl/⌘+Shift+Z)" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" '+(state.workflowHistory.canRedo?'':'disabled'))+btn('保存为模板','template-save')+btn('新建','workflow-new')+btn('AI 修改','workflow-ai')+btn('另存为','workflow-clone')+btn('保存','workflow-save','','','save')+btn('手动运行','workflow-run','primary',w.job&&['running','queued'].includes(w.job.status)?'disabled':'','play'):''}</div></div><div id="workflow-run-summary" class="wf-run-summary">${runSummary(w.job)}</div>${can&&state.contextVersions?.length?`<div class="workflow-context">${projectContext.picker('workflow-context',state.workflowContext?.[w.id])}</div>`:''}<div class="wf-body"><aside class="node-library"><h3>任务节点</h3><p class="note">点击添加到画布</p>${Object.entries(nodeNames).map(([type,name])=>btn(name,'node-add','node-library-item',`data-type="${type}" ${can?'':'disabled'}`,nodeTone[type])).join('')}<div class="node-hint">选择输出端口，再点击目标节点的输入端口连接。拖动节点标题调整位置。</div></aside><section class="canvas-area"><div class="canvas-scroller"><div class="canvas-extent" style="width:${canvasSize().width*state.zoom}px;height:${canvasSize().height*state.zoom}px"><div class="workflow-canvas" id="workflow-canvas" style="transform:scale(${state.zoom})"><svg id="edges" width="${canvasSize().width}" height="${canvasSize().height}" aria-label="节点连线">${edgesSVG()}</svg>${w.document.nodes.map(nodeHTML).join('')}</div></div></div><div class="canvas-footer"><div class="row"><select id="canvas-zoom" aria-label="画布缩放" class="zoom-select">${[.4,.6,.8,1,1.2].map(z=>`<option value="${z}" ${state.zoom===z?'selected':''}>${Math.round(z*100)}%</option>`).join('')}</select><span id="connect-hint">${state.connecting?'请选择目标输入端口':'节点 '+w.document.nodes.length+' · 连线 '+w.document.edges.length}</span></div><span class="note" id="workflow-save-hint">${state.dirty?'更改后先保存，再运行':'JSON 是工作流的完整配置'}</span></div></section><aside class="workflow-side"><div class="tabs">${[['params','节点参数'],['ai','AI 分析与修改'],['run','执行结果']].map(([v,t])=>`<button data-action="side-tab" data-value="${v}" class="${(state.sideTab||'params')===v?'active':''}">${t}</button>`).join('')}</div><div class="workflow-side-content" ${state.sideTab==='run'?'hidden':''}>${state.sideTab==='ai'?assistForm():n?nodeForm(n):'<p class="note">点击节点编辑参数。</p>'}</div><div id="job-panel" ${state.sideTab==='run'?'':'hidden'}>${w.job?jobPanel(w.job):'<p class="note job-status">尚未运行。保存后点击“手动运行”。错误与产物显示在这里。</p>'}</div></aside></div></div>`;
}
function canvasSize(){return {width:Math.max(1600,...state.w.document.nodes.map(n=>n.position.x+300)),height:Math.max(1100,...state.w.document.nodes.map(n=>n.position.y+220))};}
function nodeHTML(n){const s=state.w.job?.steps?.[n.id]?.status;return `<article class="product-node ${state.selected===n.id?'selected':''} ${s||''}" data-node="${n.id}" style="left:${n.position.x}px;top:${n.position.y}px"><header data-drag="${n.id}">${I(nodeTone[n.type])}<strong>${escape(n.label||nodeNames[n.type])}</strong></header><div class="product-node-body"><span class="note">${nodeNames[n.type]}</span><p>${escape(n.params.prompt?.slice(0,65)||state.models.find(m=>m.id===n.params.model_id)?.name||state.assets.find(a=>a.id===n.params.asset_id)?.name||'点击配置')}</p></div><footer>${!['prompt_input','reference_asset'].includes(n.type)?`<button class="port in" data-action="connect-in" data-id="${n.id}" aria-label="${escape(n.label)}输入端口">输入</button>`:'<span></span>'}${n.type!=='media_output'?`<button class="port out" data-action="connect-out" data-id="${n.id}" aria-label="${escape(n.label)}输出端口">输出</button>`:''}</footer></article>`;}
function edgesSVG(moving){return state.w.document.edges.map((e,i)=>{const s=state.w.document.nodes.find(n=>n.id===e.source),t=state.w.document.nodes.find(n=>n.id===e.target);if(!s||!t)return '';const start=s.id===moving?.id?moving.position:s.position,end=t.id===moving?.id?moving.position:t.position;const x=start.x+228,y=start.y+133,tx=end.x,ty=end.y+133;return `<path data-edge="${i}" d="M${x} ${y} C${x+85} ${y},${tx-85} ${ty},${tx} ${ty}"/><circle data-edge="${i}" cx="${(x+tx)/2}" cy="${(y+ty)/2}" r="6"><title>点击删除连线</title></circle>`;}).join('');}
function apiOptionFields(kind,prefix,values={},title='API 可选参数'){
  const field=f=>{const name=prefix+f.key,value=values[f.key]??'';if(f.type==='select')return select(f.label,name,[['','不设置'],...f.values.map(v=>[v,v])],value);if(f.type==='number')return input(f.label,name,value,'number',`min="${f.min}" max="${f.max}" step="${f.integer?1:'any'}"`);return area(f.label,name,f.type==='lines'&&Array.isArray(value)?value.join('\n'):value,`rows="2" ${f.maxLength?'maxlength="'+f.maxLength+'"':''}`);};
  const custom=values.api_params??'';
  return `<details class="api-options"><summary>${escape(title)}</summary><p class="note">仅发送填写的选项；具体参数需由所选模型支持。</p>${(state.taskOptions[kind]||[]).map(field).join('')}${area('额外 API 参数（JSON 对象，选填）',prefix+'api_params',typeof custom==='string'?custom:JSON.stringify(custom,null,2),'rows="4" spellcheck="false" placeholder="例如 {&quot;scheduler&quot;:&quot;euler&quot;}"')}<p class="note">标准参数使用上方字段。JSON 可填写部署服务的其他参数；模型、提示词和参考文件由平台传递。</p></details>`;
}
function optionDraft(root,kind,prefix){const draft={};for(const f of [...(state.taskOptions[kind]||[]),{key:'api_params'}]){const el=root.querySelector('[name="'+prefix+f.key+'"]');if(el)draft[f.key]=el.value;}return draft;}
function readApiOptions(root,kind,prefix){const draft=optionDraft(root,kind,prefix),out={};for(const f of state.taskOptions[kind]||[]){const value=draft[f.key];if(value===undefined||value==='')continue;if(f.type==='number'){const n=Number(value);if(!Number.isFinite(n))throw Error(f.label+'须为有效数值');out[f.key]=n;}else if(f.type==='lines')out[f.key]=value.split('\n').filter(x=>x.length);else out[f.key]=value;}if(draft.api_params?.trim()){try{out.api_params=JSON.parse(draft.api_params);}catch{throw Error('额外 API 参数 JSON 格式有误');}if(!out.api_params||typeof out.api_params!=='object'||Array.isArray(out.api_params))throw Error('额外 API 参数须为 JSON 对象');}return out;}
function nodeForm(n){
  const cap=n.type==='video_generate'?'video':n.type==='image_generate'?'image':'text',p=n.params;
  const extra=n.type==='prompt_input'?area('提示词','node-prompt',p.prompt):n.type==='reference_asset'?select('参考资产版本','node-asset_id',assetOptions('video'),p.asset_id):n.type==='media_output'?'<p class="note">收集连线输入的图片与视频，在项目和资产库保存。</p>':select('模型','node-model_id',modelOptions(cap),p.model_id)+area('提示词（无文本连线时使用）','node-prompt',p.prompt||'')+(cap!=='text'?input('分辨率','node-size',p.size|| (cap==='video'?'1280x720':'1024x1024'))+(cap==='video'?input('时长（秒）','node-seconds',p.seconds||4,'number','min="1" max="120"'):'')+input('随机种子（选填）','node-seed',p.seed??'','number')+select('Skill（选填）','node-skill', [['','不使用'],...state.skills.map(s=>[s.id,s.name])],p.skill_ids?.[0]||''):'');
  const links=state.w.document.edges.filter(e=>e.target===n.id||e.source===n.id);
  return `<form id="node-form"><p class="note">${escape(n.id)}</p>${input('节点名称','node-label',n.label||nodeNames[n.type])}${extra}${['prompt_agent','image_generate','video_generate'].includes(n.type)?apiOptionFields(cap,'node-',p):''}<p class="form-error" role="alert"></p>${state.w.can_edit?'<button class="btn" type="submit">应用参数</button>':''}</form><div class="node-links">${links.map(e=>`<div class="row between"><span>${escape(e.source)} → ${escape(e.target)}</span>${state.w.can_edit?btn('移除','edge-remove','small',`data-index="${state.w.document.edges.indexOf(e)}"`):''}</div>`).join('')}</div>${state.w.can_edit?btn('删除节点','node-remove','danger',`data-id="${n.id}"`):''}`;
}
function assistForm(){const d=state.assistDraft?.workflow_id===state.w.id?state.assistDraft:{};return `<form id="assist-form">${select('模式','assist-mode',[['analyze','分析工作流'],['modify','修改工作流']],d.mode)}${select('文本模型','assist-model',modelOptions('text'),d.model_id)}${area('你的要求','assist-prompt',d.prompt||'','required placeholder="例如：把图片生成之后连接一个视频生成节点"')}${projectContext.picker('assist-context',d.context_revision)}${apiOptionFields('text','assist-',d.params||{})}<p class="note">AI 只分析或修改工作流；修改批次由你确认，运行请使用上方按钮。</p><button type="submit" class="btn primary" ${state.w.can_edit?'':'disabled'}>发送</button><p class="form-error"></p></form>${state.analysis?`<div class="analysis-result">${escape(state.analysis)}</div>`:''}`;}
function chatSettings(){
  const a=state.chatAgent||'image',prompt=a==='prompt';
  const expert=state.experts.find(e=>e.id===state.chatExpert);
  return `<div class="card-body"><h3>${escape(state.agents.find(x=>x.id===a)?.name||'生成设置')} 配置</h3>${select('Agent','chat-agent',state.agents.map(x=>[x.id,x.name]),a)}${select(prompt?'文本模型':a==='video'?'视频模型':'图片模型','chat-model',modelOptions(prompt?'text':a),state.chatModel||'')}${state.c?projectContext.picker('chat-context',state.chatContext):''}${prompt?select('提示词目标用途','chat-kind',[['image','图片提示词'],['video','视频提示词']],state.chatKind||'image'):select('理解对话的文本模型（选填）','chat-text-model',modelOptions('text'),state.chatTextModel||'')+select(a==='video'?'参考图片或视频版本':'参考图片版本','chat-asset',assetOptions(a),state.chatAsset||'')}${select('专家（多个 Skill 的组合）','chat-expert',[['','不使用专家'],...state.experts.filter(e=>['all',a].includes(e.task)).map(e=>[e.id,e.name])],state.chatExpert||'')}${expert?`<p class="note">包含 Skill：${expert.skill_ids.map(id=>escape(state.skills.find(x=>x.id===id)?.name||id)).join('、')}</p>`:''}<fieldset class="skill-picker"><legend>附加 Skill（可多选）</legend>${state.skills.map(x=>`<label><input type="checkbox" name="chat-skills" value="${x.id}" ${(state.chatSkills||[]).includes(x.id)?'checked':''}> ${escape(x.name)}</label>`).join('')}</fieldset>${prompt?'<p class="note">此 Agent 只返回文字提示词。全部 Skill 均可选择。</p>':input('分辨率','chat-size',state.chatSize||(a==='video'?'1280x720':'1024x1024'))+(a==='video'?input('视频时长（秒）','chat-seconds',state.chatSeconds||4,'number','min="1" max="120"'):'')+input('随机种子（选填）','chat-seed',state.chatSeed??'','number')+(a==='video'?'<p class="note">可参考图片或视频文件。视频文件需要模型启用参考视频输入；字段在模型配置中设置。</p>':'')+'<p class="note">专家与附加 Skill 合并使用；重复 Skill 只应用一次。</p>'}${apiOptionFields(prompt?'text':a,'chat-api-',state.chatOptionsDraft||{})}${!prompt&&state.chatTextModel?apiOptionFields('text','chat-text-',state.chatTextOptionsDraft||{},'理解对话的文本 API 参数'):''}</div>`;
}
function chatPage(){const c=state.c;return `<div class="page" data-req="REQ-012 REQ-013 REQ-014 REQ-033 REQ-034">${head('对话创作','对话历史按项目整理；右侧显示所选 Agent 的配置。',editable()?btn('新对话','chat-new','primary','','plus'):'')}<div class="create-layout"><aside class="card create-thread"><h3>项目与对话</h3>${projectPicker('create',state.collectionProject.create)}<div class="create-hiprompt">${collectionGroups('create',state.chats,c=>`<a class="thread-link ${state.id===c.id?'active':''}" href="#create/${c.id}"><strong>${escape(c.title)}</strong></a>`,true)}</div></aside><section class="chat-stage"><div class="chat-title">${escape(c?.title||'开始新的创作对话')}${c?badge(projectName(c.project_id)):''}</div><div class="chat-feed" id="chat-feed">${c?chatFeed(c):empty('创建对话后描述你想生成的画面。',editable()?btn('新对话','chat-new','primary'):'')}</div>${c?`<form id="chat-form" class="creator-compose">${area('创作描述','chat-prompt','','required placeholder="描述图片内容、视频动作，或要求整理提示词…"')}<div class="row between"><span class="note" id="chat-output-hint">${state.chatAgent==='prompt'?'返回文字提示词':'生成结果加入项目与资产库'}</span><button class="btn primary" type="submit" ${!c.can_edit||c.job&&['running','queued'].includes(c.job.status)?'disabled':''}>${c.job&&['running','queued'].includes(c.job.status)?'生成中…':state.chatAgent==='prompt'?'发送并整理':'发送并生成'}</button></div><p class="form-error"></p></form>`:''}</section><aside id="chat-settings" class="card create-settings">${chatSettings()}</aside></div></div>`;}
function chatFeed(c){return c.messages.map(m=>`<div class="message ${m.role==='user'?'user':''}"><div class="${m.role==='user'?'avatar':'chat-avatar'}">${m.role==='user'?'你':I('spark')}</div><div class="bubble"><div class="message-text">${escape(m.text)}</div>${mediaList(m.outputs||[])}</div></div>`).join('')+(c.job?.status==='failed'?`<div class="notice">本次生成失败：${escape(c.job.error)}<p>已完成产物会保留。你可以恢复上次输入和配置，修改后手动提交新任务。</p>${c.can_edit?btn('恢复上次输入与配置','chat-restore'):''}</div>`:'')+(c.job&&['queued','running'].includes(c.job.status)?`<div class="notice">${statusName[c.job.status]}，请稍候…</div>`:'');}
function assetsPage(){return `<div class="page" data-req="REQ-003 REQ-018 REQ-019">${head('可复用的创作资产','参考图片按版本保存，生成时使用选定版本。',editable()?btn('上传资产','asset-new','primary','','plus'):'')}<div class="tabs">${[['all','全部'],['character','角色'],['scene','场景'],['prop','道具'],['style','风格'],['image','图片'],['video','视频'],['video_reference','参考视频输入']].map(([v,t])=>`<button data-action="asset-filter" data-value="${v}" class="${(state.assetFilter||'all')===v?'active':''}">${t}</button>`).join('')}</div><div class="toolbar"><div class="search"><input class="product-search" aria-label="搜索资产" placeholder="搜索资产名称" value="${escape(state.queries.assets||'')}"></div></div><div class="grid4 asset-grid">${state.assets.filter(a=>!state.assetFilter||state.assetFilter==='all'||a.kind===state.assetFilter).map(a=>`<article class="card asset-card" data-card-search="${escape(a.name)}"><button class="asset-preview" type="button" data-action="asset-edit" data-id="${a.id}"><div class="art-frame">${a.mime.startsWith('video/')?`<video src="${a.url}" preload="metadata"></video>`:`<img src="${a.url}" alt="${escape(a.name)}" loading="lazy">`}</div><div class="asset-title"><div><h3>${escape(a.name)}</h3><small>v${a.version} · ${escape(a.project_id?projectName(a.project_id):a.visibility==='team'?'团队共享':'个人资产')}</small></div>${I('arrow')}</div></button></article>`).join('')}</div>${!state.assets.length?empty('上传角色、场景或风格，作为生成参考。',editable()?btn('上传资产','asset-new','primary'):''):''}</div>`;}
function modelsPage(){return modelUI.page();}
async function checkModel(id,button){return modelUI.check(id,button);}
function teamPage(){return `<div class="page" data-req="REQ-004 REQ-017">${head('成员与权限','管理员管理账号；项目按团队共享或指定成员授权。',state.user.role==='admin'?btn('邀请成员','user-new','primary','','plus'):'')}<div class="card"><table class="datatable"><thead><tr><th>成员</th><th>团队角色</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.users.map(u=>`<tr><td><strong>${escape(u.name)}</strong><small>${escape(u.email)}</small></td><td>${roleName[u.role]}</td><td>${badge(u.active?'有效':'待加入／停用',u.active?'green':'amber')}</td><td>${state.user.role==='admin'?btn('账号与权限','user-edit','small',`data-id="${u.id}"`):''}</td></tr>`).join('')}</tbody></table></div><div class="role-notes"><p><strong>管理员</strong>：管理成员、模型、Skill，以及所有项目与资产。</p><p><strong>编辑者</strong>：创建项目，在授权项目内编辑与运行；上传参考资产。</p><p><strong>查看者</strong>：查看授权项目与资产、预览并下载产物。</p></div></div>`;}
function skillsPage(){return `<div class="page" data-req="REQ-013 REQ-014 REQ-034">${head('Agent、Skill 与专家','Agent 执行任务；Skill 是单项能力；专家组合多个 Skill，无需设置顺序。',state.user.role==='admin'?btn('扩展 Skill','skill-new')+btn('新建专家','expert-new','primary','','plus'):'')}<h3 class="section-label">内置 Agent</h3><div class="grid3">${state.agents.map(a=>`<article class="card agent-card"><h3>${escape(a.name)}</h3><p>${escape(a.description)}</p>${btn('使用此 Agent 新建对话','agent-chat-new','small',`data-id="${a.id}"`)}</article>`).join('')}</div><h3 class="section-label">专家组合</h3><div class="grid3">${state.experts.map(e=>`<article class="card agent-card"><h3>${escape(e.name)}</h3><p>${e.skill_ids.map(id=>escape(state.skills.find(s=>s.id===id)?.name||id)).join('、')}</p><footer>${badge(e.task==='prompt'?'提示词':e.task==='video'?'视频':e.task==='image'?'图片':'通用')}${state.user.role==='admin'?btn('编辑组合','expert-edit','small',`data-id="${e.id}"`):''}</footer></article>`).join('')}</div><h3 class="section-label">Skill 模板</h3><div class="grid3">${state.skills.map(s=>`<article class="card agent-card"><h3>${escape(s.name)}</h3><p>${escape(s.template)}</p><footer>${badge(s.builtin?'内置':'团队扩展')}${state.user.role==='admin'?btn('编辑','skill-edit','small',`data-id="${s.id}"`):''}</footer></article>`).join('')}</div></div>`;}
function apiPage(){return `<div class="page" data-req="REQ-021">${head('工作流 API','发布固定版本，外部系统提交提示词并异步获取图片与视频。',editable()?btn('发布工作流','publish-new','primary','','api'):'')}<div class="notice">发布版本保留完整工作流快照。草稿更新不会改变已发布接口；每个版本使用独立凭据。</div><div class="card"><table class="datatable"><thead><tr><th>接口／版本</th><th>来源</th><th>调用路径</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.publications.map(p=>`<tr><td><strong>${escape(p.name)}</strong><small>${escape(p.version)}</small></td><td><a href="#workflow/${p.workflow_id}">${escape(state.workflows.find(w=>w.id===p.workflow_id)?.name||'工作流')}</a></td><td><code>/api/v1/endpoints/${p.id}/runs</code></td><td>${badge(p.enabled?'已发布':'已撤销',p.enabled?'green':'')}</td><td>${btn('使用说明','api-help','small',`data-id="${p.id}"`)}${p.enabled&&(p.owner_id===state.user.id||state.user.role==='admin')?btn('撤销','publish-revoke','small',`data-id="${p.id}"`):''}</td></tr>`).join('')}</tbody></table></div>${!state.publications.length?empty('把已保存的工作流发布成 API。',editable()?btn('发布工作流','publish-new','primary'):''):''}</div>`;}
let renderGeneration=0,poll=null;
async function render(){const gen=++renderGeneration;clearTimeout(poll);applyTheme();if(!state.user)return loginPage(state.setup,location.hash.startsWith('#join/')?location.hash.split('/')[1]:null);const parts=location.hash.slice(1).split('/');state.route=names[parts[0]]?parts[0]:'projects';state.workflowView=state.route==='workflow'&&parts[1]==='templates'?'templates':'list';const collectionRoute=['workflow','create'].includes(state.route)&&parts[1]==='project';if(collectionRoute)state.collectionProject[state.route]=parts[2]||'';state.id=collectionRoute||state.workflowView==='templates'?null:parts[1]||null;state.w=null;state.c=null;state.creation=null;drag=null;try{if(state.route==='studio'&&state.id)state.creation=await api('creations/'+state.id);if(state.route==='workflow'&&state.id){const workflow=await api('workflows/'+state.id);if(gen!==renderGeneration)return;state.w=workflow;state.workflowHistory=createWorkflowHistory(workflow.document);state.connecting=null;if(state.activeWorkflow!==state.w.id){state.analysis='';state.proposal=null;state.activeWorkflow=state.w.id;}state.collectionProject.workflow=state.w.project_id;state.selected=state.w.document.nodes.some(n=>n.id===state.selected)?state.selected:state.w.document.nodes[0]?.id;state.dirty=false;}if(state.route==='create'&&state.id){state.c=await api('chats/'+state.id);state.collectionProject.create=state.c.project_id;restoreChatSettings(state.c);}if(gen!==renderGeneration)return;const contextProject=(state.w||state.c||state.creation)?.project_id;const contextVersions=contextProject?await projectContext.versions(contextProject):[];if(gen!==renderGeneration)return;state.contextVersions=contextVersions;if(state.route==='testing'){const pid=state.id||state.testWorkspace?.project_id;const definitions=await(await fetch('/test-cases.json')).json(),saved=pid?await api('projects/'+pid+'/test-cases'):[];state.manualCases=definitions.map(c=>({...c,entry_path:c.entry_path||saved.find(x=>x.id===c.id)?.entry_path}));}const content=state.route==='projects'?await projectsPage():({studio:()=>studioUI.page(),workflow:workflowPage,create:chatPage,assets:assetsPage,models:modelsPage,team:teamPage,skills:skillsPage,api:apiPage,testing:testingPage}[state.route])();if(gen!==renderGeneration)return;shell(content);bindForms();schedulePoll();}catch(err){if(gen!==renderGeneration)return;if(err.status===401){state.user=null;loginPage(false);}else shell(`<div class="page">${head('内容加载失败',err.message)}<a class="btn" href="#projects">返回项目</a></div>`);}}
function drawCanvas(){if(!state.w)return;$('#workflow-canvas').innerHTML=`<svg id="edges" width="${canvasSize().width}" height="${canvasSize().height}" aria-label="节点连线">${edgesSVG()}</svg>`+state.w.document.nodes.map(nodeHTML).join('');const hint=$('#connect-hint');if(hint)hint.textContent=state.connecting?'请选择目标输入端口':'节点 '+state.w.document.nodes.length+' · 连线 '+state.w.document.edges.length;}
function redrawWorkflow(){
  const canvas = $('.canvas-scroller');
  const position = canvas && [canvas.scrollLeft, canvas.scrollTop];
  shell(workflowPage());
  bindForms();
  if (position) $('.canvas-scroller').scrollTo(...position);
  schedulePoll();
}
function nodeFormEdited(form = $('#node-form')) {
  return !!form && JSON.stringify([...new FormData(form)]) !== form.dataset.initialValues;
}
function updateWorkflowStatus() {
  if (!state.w) return;
  const pending = nodeFormEdited();
  state.dirty = state.workflowHistory.dirty || pending;
  const label = $('#dirty-label');
  if (label) label.textContent = state.dirty ? '未保存' : '已保存 · r' + state.w.revision;
  const hint = $('#workflow-save-hint');
  if (hint) hint.textContent = state.dirty ? '更改后先保存，再运行' : 'JSON 是工作流的完整配置';
  const undo = $('[data-action="workflow-undo"]');
  const redo = $('[data-action="workflow-redo"]');
  if (undo) undo.disabled = !pending && !state.workflowHistory.canUndo;
  if (redo) redo.disabled = pending || !state.workflowHistory.canRedo;
}
function replaceWorkflowDocument(document) {
  if (!state.workflowHistory.record(document)) return false;
  state.w.document = document;
  updateWorkflowStatus();
  return true;
}
function editWorkflow(edit) {
  const document = structuredClone(state.w.document);
  edit(document);
  return replaceWorkflowDocument(document);
}
function moveWorkflowHistory(direction) {
  if (!state.w?.can_edit || drag) return;
  if (nodeFormEdited()) {
    if (direction === 'undo') {
      state.dirty = state.workflowHistory.dirty;
      redrawWorkflow();
    }
    return;
  }
  const document = state.workflowHistory[direction]();
  if (!document) return;
  state.w.document = document;
  state.selected = document.nodes.some(n => n.id === state.selected) ? state.selected : document.nodes[0]?.id;
  state.connecting = null;
  state.dirty = state.workflowHistory.dirty;
  redrawWorkflow();
}
async function applyWorkflowJson(w, document) {
  if (!w?.can_edit || state.w !== w) return;
  await api('workflows/validate', 'POST', {project_id:w.project_id, document});
  if (state.w !== w) return;
  replaceWorkflowDocument(document);
  state.selected = w.document.nodes.some(n => n.id === state.selected) ? state.selected : w.document.nodes[0]?.id;
  state.connecting = null;
  redrawWorkflow();
}
function acceptWorkflowRevision(w, saved) {
  if (state.w !== w) return;
  state.workflowHistory.record(saved.document);
  Object.assign(w, saved);
  state.workflowHistory.markSaved(saved.document);
  state.selected = w.document.nodes.some(n => n.id === state.selected) ? state.selected : w.document.nodes[0]?.id;
  state.connecting = null;
  state.dirty = false;
  redrawWorkflow();
}
async function saveWorkflow() {
  const w = state.w;
  if (!w?.can_edit || state.savingWorkflow === w || drag) return;
  if (applyNodeForm()) drawCanvas();
  state.savingWorkflow = w;
  try {
    const saved = await api('workflows/' + w.id, 'PUT', {revision:w.revision, document:w.document});
    if (state.w !== w) return;
    const {document, ...metadata} = saved;
    Object.assign(w, metadata);
    state.workflowHistory.markSaved(document);
    updateWorkflowStatus();
    const heading = $('#workflow-name');
    if (heading) heading.textContent = w.name;
    await loadCommon();
    toast('工作流已保存');
  } finally {
    if (state.savingWorkflow === w) state.savingWorkflow = null;
  }
}
function applyNodeForm() {
  const form = $('#node-form');
  if (!state.w?.can_edit || !nodeFormEdited(form)) return;
  if (!form.reportValidity()) throw Error('请检查节点参数');
  const values = Object.fromEntries(new FormData(form));
  const initial = Object.fromEntries(JSON.parse(form.dataset.initialValues));
  const changed = key => values['node-' + key] !== initial['node-' + key];
  const applied = editWorkflow(document => {
    const node = document.nodes.find(n => n.id === state.selected);
    const kind = {prompt_agent:'text', image_generate:'image', video_generate:'video'}[node.type];
    if (changed('label')) node.label = values['node-label'];
    for (const key of ['prompt','model_id','asset_id','size','seed','seconds']) {
      if (!changed(key)) continue;
      const value = values['node-' + key];
      node.params[key] = ['seconds','seed'].includes(key) && value !== '' ? Number(value) : value;
    }
    if (changed('skill')) node.params.skill_ids = values['node-skill'] ? [values['node-skill']] : [];
    if (kind) {
      const options = [...(state.taskOptions[kind] || []).map(field => field.key), 'api_params'];
      if (options.some(changed)) {
        const parsed = readApiOptions(form, kind, 'node-');
        for (const key of options.filter(changed)) {
          if (key in parsed) node.params[key] = parsed[key];
          else delete node.params[key];
        }
      }
    }
  });
  form.dataset.initialValues = JSON.stringify([...new FormData(form)]);
  updateWorkflowStatus();
  return applied;
}
function bindForms(){
  modelUI.bind();studioUI.bind();
  const send=$('#chat-form button[type="submit"]');if(send&&state.c){const busy=state.c.job&&['queued','running'].includes(state.c.job.status);send.disabled=!state.c.can_edit||busy;send.textContent=busy?'生成中…':state.chatAgent==='prompt'?'发送并整理':'发送并生成';}
  const search=$('.product-search');if(search){const filter=()=>{state.queries[state.route]=search.value;let count=0;document.querySelectorAll('[data-card-search]').forEach(e=>{e.hidden=!e.dataset.cardSearch.toLowerCase().includes(search.value.toLowerCase().trim());if(!e.hidden)count++;});if($('#content-count'))$('#content-count').textContent=count+' 项内容';};search.oninput=filter;filter();}

  if($('#canvas-zoom'))$('#canvas-zoom').onchange=e=>{state.zoom=Number(e.target.value);const c=$('#workflow-canvas');c.style.transform='scale('+state.zoom+')';c.parentElement.style.width=canvasSize().width*state.zoom+'px';c.parentElement.style.height=canvasSize().height*state.zoom+'px';};
  document.querySelectorAll('[data-collection-project]').forEach(el=>el.onchange=e=>{const r=e.target.dataset.collectionProject;state.collectionProject[r]=e.target.value;location.hash='#'+r+'/project/'+e.target.value;});
  document.querySelectorAll('[data-template-project]').forEach(el=>el.onchange=e=>{state.collectionProject.workflow=e.target.value;render();});
  if($('#workflow-context'))$('#workflow-context').onchange=e=>{(state.workflowContext??={})[state.w.id]=e.target.value;};
  if($('#project-filter'))$('#project-filter').onchange=e=>goto('projects',e.target.value);
  const nodeForm = $('#node-form');
  if (nodeForm) {
    nodeForm.dataset.initialValues ??= JSON.stringify([...new FormData(nodeForm)]);
    nodeForm.onsubmit = e => {
      e.preventDefault();
      try {
        applyNodeForm();
        nodeForm.querySelector('.form-error').textContent = '';
        drawCanvas();
      } catch (err) { nodeForm.querySelector('.form-error').textContent = err.message; }
    };
  }
  if($('#assist-form'))$('#assist-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{if(state.dirty)throw Error('请先保存当前修改，再使用 AI 助手');const values=Object.fromEntries(new FormData(e.target));state.assistDraft={workflow_id:state.w.id,mode:values['assist-mode'],model_id:values['assist-model'],prompt:values['assist-prompt'],params:readApiOptions(e.target,'text','assist-'),...(values['assist-context']?{context_revision:Number(values['assist-context'])}:{})};const {workflow_id,...request}=state.assistDraft;const result=await api('workflows/'+workflow_id+'/assist','POST',request);if(state.w?.id!==workflow_id)return;if(result.analysis){state.analysis=result.analysis;redrawWorkflow();}else{state.proposal=result;showProposal();}}catch(err){const error=e.target.querySelector('.form-error');error.textContent=err.message;if(/模型 HTTP (502|503|504)/.test(err.message)){error.append(document.createElement('br'),document.createTextNode('本次未生成分析结果或修改提案，工作流未被本次请求更改。请先在模型配置中验证生成，成功后再手动重试。'));const link=document.createElement('a');link.href='#models';link.textContent='打开模型配置 →';error.append(document.createElement('br'),link);}}finally{b.disabled=false;}};
  if($('#chat-agent'))$('#chat-agent').onchange=e=>{const next=e.target.value;captureChatSettings();state.chatAgent=next;restoreAgentDraft();$('#chat-settings').innerHTML=chatSettings();if($('#chat-output-hint'))$('#chat-output-hint').textContent=next==='prompt'?'返回文字提示词':'生成结果加入项目与资产库';bindForms();};
  if($('#chat-expert'))$('#chat-expert').onchange=()=>{captureChatSettings();$('#chat-settings').innerHTML=chatSettings();bindForms();};
  if($('#chat-text-model'))$('#chat-text-model').onchange=()=>{captureChatSettings();$('#chat-settings').innerHTML=chatSettings();bindForms();};
  if($('#chat-kind'))$('#chat-kind').onchange=()=>{captureChatSettings();$('#chat-settings').innerHTML=chatSettings();bindForms();};
  document.querySelectorAll('[data-test-result]').forEach(el=>el.onchange=()=>saveManualResult(el.dataset.testResult));
  if($('#chat-form'))$('#chat-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;let accepted=false;b.disabled=true;try{captureChatSettings();const payload={prompt:$('#chat-prompt').value,...(state.chatContext?{context_revision:Number(state.chatContext)}:{}),config:{agent:state.chatAgent||'image',kind:state.chatAgent==='prompt'?(state.chatKind||'image'):state.chatAgent||'image',model_id:state.chatModel,expert_id:state.chatExpert||'',skill_ids:state.chatSkills||[],...readApiOptions($('#chat-settings'),state.chatAgent==='prompt'?'text':state.chatAgent||'image','chat-api-'),...(state.chatAgent==='prompt'?{}:{text_model_id:state.chatTextModel||'',text_options:state.chatTextModel?readApiOptions($('#chat-settings'),'text','chat-text-'):{},asset_ids:state.chatAsset?[state.chatAsset]:[],size:state.chatSize,seed:state.chatSeed,...(state.chatAgent==='video'?{seconds:Number(state.chatSeconds)}:{})})}};const signature=JSON.stringify([state.c.id,payload]);if(state.pendingChat?.signature!==signature)state.pendingChat={signature,key:crypto.randomUUID()};const j=await api('chats/'+state.c.id+'/messages','POST',payload,{headers:{'Idempotency-Key':state.pendingChat.key}});state.pendingChat=null;accepted=true;state.c.job=j;b.textContent='生成中…';$('#chat-prompt').value='';const c=await api('chats/'+state.c.id);state.c=c;$('#chat-feed').innerHTML=chatFeed(c);schedulePoll();}catch(err){e.target.querySelector('.form-error').textContent=accepted?'任务已提交，状态刷新失败，将继续查询：'+err.message:err.message;b.disabled=accepted;if(accepted)schedulePoll();}};
}
function captureChatSettings(){for(const [k,sel]of [['chatModel','#chat-model'],['chatContext','#chat-context'],['chatTextModel','#chat-text-model'],['chatAsset','#chat-asset'],['chatExpert','#chat-expert'],['chatKind','#chat-kind'],['chatSize','#chat-size'],['chatSeconds','#chat-seconds'],['chatSeed','#chat-seed']])if($(sel))state[k]=$(sel).value;state.chatSkills=[...document.querySelectorAll('[name="chat-skills"]:checked')].map(e=>e.value);const a=state.chatAgent||'image';state.chatOptionsDraft=optionDraft($('#chat-settings'),a==='prompt'?'text':a,'chat-api-');if($('#chat-settings [name="chat-text-temperature"]'))state.chatTextOptionsDraft=optionDraft($('#chat-settings'),'text','chat-text-');const key=(state.c?.id||'new')+'/'+a;state.chatConfigs[key]=Object.fromEntries(['chatModel','chatContext','chatTextModel','chatAsset','chatExpert','chatKind','chatSize','chatSeconds','chatSeed','chatSkills','chatOptionsDraft','chatTextOptionsDraft'].map(k=>[k,state[k]]));}
function restoreAgentDraft(){const a=state.chatAgent||'image';Object.assign(state,{chatModel:'',chatContext:'',chatTextModel:'',chatAsset:'',chatExpert:'',chatKind:'image',chatSize:a==='video'?'1280x720':'1024x1024',chatSeconds:4,chatSeed:'',chatSkills:[],chatOptionsDraft:{},chatTextOptionsDraft:{}},state.chatConfigs[(state.c?.id||'new')+'/'+a]||{});}
function restoreChatSettings(c){if(state.activeChat===c.id)return;state.activeChat=c.id;const last=[...c.messages].reverse().find(m=>m.config)?.config;const hint=state.nextChatAgent||Object.entries(state.testWorkspace?.chats||{}).find(([,cid])=>cid===c.id)?.[0];state.chatAgent=last?.agent||hint||'image';state.nextChatAgent=null;if(last&&!state.chatConfigs[c.id+'/'+state.chatAgent])state.chatConfigs[c.id+'/'+state.chatAgent]={chatModel:last.model_id,chatContext:last.context_revision?String(last.context_revision):'',chatTextModel:last.text_model_id||'',chatAsset:last.asset_ids?.[0]||'',chatExpert:last.expert_id||'',chatKind:last.kind,chatSkills:last.additional_skill_ids||last.skill_ids||[],chatSize:last.size,chatSeconds:last.seconds,chatSeed:last.seed??'',chatOptionsDraft:last,chatTextOptionsDraft:last.text_options||{}};restoreAgentDraft();}
function runSummary(j){return j?`<strong>当前任务：${statusName[j.status]}</strong>${j.error?`<span class="form-error">${escape(j.error)}</span>`:''}${btn('查看执行结果','workflow-results','small')}`:'<span>尚未运行。AI 确认只保存修改；运行由“手动运行”按钮触发。</span>';}
function schedulePoll(){clearTimeout(poll);const source=state.w||state.c;if(!source?.job||!['queued','running'].includes(source.job.status))return;const route=state.route,sourceId=source.id;poll=setTimeout(async()=>{try{const j=await api('jobs/'+source.job.id);if(state.route!==route||(state.w||state.c)?.id!==sourceId)return;source.job=j;state.assets=await api('assets');if(route==='workflow'){if(state.w!==source)return;$('#job-panel').innerHTML=jobPanel(j);$('#workflow-run-summary').innerHTML=runSummary(j);if(!drag)drawCanvas();const run=$('[data-action="workflow-run"]');if(run)run.disabled=['running','queued'].includes(j.status);}else{const updated=await api('chats/'+sourceId);Object.assign(state.c,updated);$('#chat-feed').innerHTML=chatFeed(state.c);const b=$('#chat-form button[type="submit"]');if(b){b.disabled=!state.c.can_edit||['running','queued'].includes(j.status);b.textContent=['running','queued'].includes(j.status)?'生成中…':state.chatAgent==='prompt'?'发送并整理':'发送并生成';}}schedulePoll();}catch(err){toast(err.message);}},1500);}
function showProposal(){const p=state.proposal,w=state.w;modal('确认这一批工作流修改',`<p>${escape(p.explanation)}</p><p class="note">确认只保存修改；运行仍由工作流上的按钮触发。</p><div class="diff"><div><h3>修改前</h3><pre>${escape(JSON.stringify(p.before,null,2))}</pre></div><div><h3>修改后</h3><pre>${escape(JSON.stringify(p.after,null,2))}</pre></div></div>`,async()=>{if(state.w!==w||state.dirty||state.savingWorkflow===w)throw Error('请先保存当前画布，再重新生成提案');const saved=await api('proposals/'+p.id+'/confirm','POST',{});if(state.w===w)state.proposal=null;acceptWorkflowRevision(w,saved);await loadCommon();toast('修改已保存，尚未运行');},'确认修改');}
function newContent(source,document=null,projectId=''){const contextProject=projectId||state.w?.project_id||state.c?.project_id||(state.route==='projects'?state.id:state.collectionProject[source==='workflow'?'workflow':'create']);const projects=optionsProjects(),fresh=projects.length===0;modal(source==='workflow'?'新建工作流':'新建对话',select('所属项目','project_id',[...projects,['__new__','同时新建项目']],fresh?'__new__':projects.some(p=>p[0]===contextProject)?contextProject:projects[0][0])+`<div id="new-project-field" ${fresh?'':'hidden'}>${input('新项目名称','new_project_name','我的创作项目')}</div>`+input('名称','name',document?.name||'','text','required'),async b=>{let pid=b.project_id;if(pid==='__new__')pid=(await api('projects','POST',{name:b.new_project_name,visibility:'team'})).id;const c=await api(source==='workflow'?'workflows':'chats','POST',{project_id:pid,...(source==='workflow'?{name:b.name,...(document?{document:{...document,name:b.name}}:{})}:{title:b.name})});await loadCommon();goto(source==='workflow'?'workflow':'create',c.id);});$('#project_id').onchange=e=>$('#new-project-field').hidden=e.target.value!=='__new__';}
function importWorkflow(asNew=false){const w=state.w;if(!asNew)applyNodeForm();modal(asNew?'从 JSON 新建工作流':'导入工作流 JSON',`<p>选择 JSON 文件，或粘贴完整配置。</p><input type="file" id="workflow-file" accept="application/json,.json">${area('完整配置','workflow-json',asNew?'':JSON.stringify(state.w.document,null,2),'rows="15" spellcheck="false"')}<p class="note">导入不执行任务。模型与资产编号须属于本团队。</p>`,async b=>{let doc;try{doc=JSON.parse(b['workflow-json']);}catch{throw Error('JSON 格式有误');}if(asNew){if(doc.schema_version!=='1.0'||!Array.isArray(doc.nodes))throw Error('请选择有效工作流 JSON');setTimeout(()=>newContent('workflow',doc),0);}else await applyWorkflowJson(w,doc);},asNew?'下一步：选择项目':'应用到画布');}
function projectShare(pid){const p=state.projects.find(p=>p.id===pid),can=state.user.role==='admin'||p.owner_id===state.user.id;modal('项目共享 · '+p.name,input('项目名称','name',p.name)+select('访问范围','visibility',[['team','团队共享'],['private','仅创建者与指定成员']],p.visibility)+`<div class="form-field"><label>指定成员权限</label>${state.users.filter(u=>u.id!==p.owner_id).map(u=>select(escape(u.name)+' · '+roleName[u.role],'acl_'+u.id,[['','未授权'],['read','查看'],['edit','编辑']],p.acl[u.id]||'')).join('')}</div><p class="note">查看者的团队角色限制优先；授予编辑权限仍只能查看。项目中的资产继承项目权限。</p>`,can?async b=>{const acl={};for(const [k,v]of Object.entries(b))if(k.startsWith('acl_')&&v)acl[k.slice(4)]=v;await api('projects/'+pid,'PATCH',{name:b.name,visibility:b.visibility,acl});await loadCommon();await render();}:null,can?'保存':'关闭');}
function modelModal(mid){return modelUI.edit(mid);}
async function fileData(file){if(!file)throw Error('请选择文件');if(file.size>20*1024*1024)throw Error('上传上限为 20 MB');return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});}
function uploadModal(parent){modal(parent?'上传资产新版本':'上传资产',input('资产名称','name',parent?.name||'','text','required')+select('资产类别','kind',[['image','图片'],['video','视频'],['character','角色'],['scene','场景'],['prop','道具'],['style','风格']],parent?.kind||'image')+select('归属项目','project_id',[['','独立资产'],...optionsProjects()],parent?.project_id||'')+select('独立资产共享范围','visibility',[['team','团队共享'],['private','仅自己']],parent?.visibility||'team')+area('描述','description',parent?.metadata.description||'')+`<div class="form-field"><label for="upload-file">文件（最多 20 MB）</label><input id="upload-file" type="file" name="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" required></div><p class="note">项目资产继承项目权限。新版本另存一条记录，已有工作流引用保留原版本。</p>`,async(b,form)=>{const f=form.querySelector('[type=file]').files[0],base64=await fileData(f);await api('assets','POST',{...b,file:undefined,mime:f.type,filename:f.name,base64,...(parent?{parent_id:parent.id}:{})});await loadCommon();await render();toast('资产已保存');});}
function assetModal(aid){const a=state.assets.find(a=>a.id===aid);if(!a)return toast('资产尚未加载，请刷新');const can=editable()&&(state.user.role==='admin'||a.owner_id===state.user.id||(a.project_id&&state.projects.find(p=>p.id===a.project_id)?.can_edit));modal('资产详情',`<div class="asset-detail-media">${preview(a.id)}</div>`+input('名称','name',a.name)+area('描述','description',a.metadata.description||'')+select('独立资产共享范围','visibility',[['team','团队共享'],['private','仅自己']],a.visibility)+`<div class="row">${badge('v'+a.version)}${badge(a.mime)}${a.metadata.source_id?`<a class="btn small" href="#${a.metadata.source==='creation'?'studio':a.metadata.source==='chat'?'create':'workflow'}/${a.metadata.source_id}">打开创作来源</a>`:''}<a class="btn small" href="${a.url}" download>下载</a>${editable()&&(a.owner_id===state.user.id||state.user.role==='admin')?btn('上传新版本','asset-version','small',`data-id="${a.id}"`):''}</div><p class="note">资产编号：${escape(a.id)}${a.metadata.parent_id?' · 上一版本 '+escape(a.metadata.parent_id):''}</p>`,can?async b=>{await api('assets/'+aid,'PATCH',b);await loadCommon();await render();}:null,can?'保存':'关闭');}
function userModal(uid){const u=state.users.find(u=>u.id===uid);modal(u?'成员账号':'邀请成员',input('姓名','name',u?.name||'','text','required')+(!u?input('邮箱','email','','email','required'):'<p>'+escape(u.email)+'</p>')+select('角色','role',Object.entries(roleName),u?.role||'editor')+(u?select('账号状态','active',[['yes','有效'],['no','停用']],u.active?'yes':'no')+input('重置密码（留空保持原密码）','password','','password','autocomplete="new-password" minlength="10"'):'<p class="note">创建一次性邀请链接，由你分享给成员；平台不会发送邮件。</p>'),async b=>{if(u){await api('users/'+uid,'PATCH',{...b,active:b.active==='yes'});await loadCommon();await render();}else{const r=await api('users','POST',b);await loadCommon();await render();setTimeout(()=>modal('邀请链接',`<p>复制并分享给 ${escape(b.name)}，7 天内有效。</p>${area('链接','invite-link',location.origin+r.invite_path,'readonly')}`,null,'关闭'),0);}});}
function skillModal(sid){const s=state.skills.find(s=>s.id===sid);modal(s?'编辑 Skill':'扩展 Skill',input('名称','name',s?.name||'','text','required')+select('适用任务','task',[['image','图片'],['video','视频'],['prompt','提示词'],['all','所有 Agent']],s?.task||'all')+area('提示词模板','template',s?.template||'{{prompt}}','required')+'<p class="note">使用 {{prompt}} 引入已有提示词。第一版 Skill 为声明式模板，可在生成设置或节点中选择。</p>',async b=>{await api(s?'skills/'+s.id:'skills',s?'PUT':'POST',b);await loadCommon();await render();});}
function publishModal(){if(!state.workflows.length)return toast('请先保存一个工作流');modal('发布工作流 API',select('工作流','workflow_id',state.workflows.filter(w=>state.projects.find(p=>p.id===w.project_id)?.can_edit).map(w=>[w.id,w.name]))+input('接口名称','name','','text','required')+input('版本','version','v1','text','required')+'<p class="note">固定当前 JSON 快照，并生成仅用于此版本的调用密钥。发布不运行工作流。</p>',async b=>{const p=await api('publications','POST',b);await loadCommon();await render();setTimeout(()=>modal('API 已发布 · 保存调用凭据',`<p>密钥只显示这一次，请妥善保存。</p>${area('调用密钥','api-token',p.token,'readonly')}<pre class="codebox">${escape(`POST ${location.origin}${p.path}\nAuthorization: Bearer ${p.token}\nContent-Type: application/json\n\n{"prompt":"生成雨夜城门图片"}`)}</pre>`,null,'已保存'),0);},'发布');}
function apiHelp(pid){const p=state.publications.find(p=>p.id===pid);modal('API 调用说明',`<pre class="codebox">${escape(`POST ${location.origin}/api/v1/endpoints/${p.id}/runs\nAuthorization: Bearer TOKEN\nContent-Type: application/json\n\n{"prompt":"你的创作描述"}\n\n202 → {"id":"job_…","status":"queued",…}\n\nGET /api/v1/runs/JOB_ID\nAuthorization: Bearer TOKEN\n\n完成后 outputs 中的 url 为产物下载路径，下载同样传入 Bearer TOKEN。`)}</pre><p class="note">调用固定 ${escape(p.version)} 版本；通过多次提交生成批量内容。每账号最多 10 个排队或执行任务。</p>`,null,'关闭');}
document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-action]');if(!button)return;const a=button.dataset.action,x=button.dataset.id;
  try {
    if(a==='chat-restore'){const last=[...state.c.messages].reverse().find(m=>m.role==='user'&&m.config);if(!last)return;state.activeChat=null;delete state.chatConfigs[state.c.id+'/'+last.config.agent];restoreChatSettings(state.c);$('#chat-settings').innerHTML=chatSettings();$('#chat-prompt').value=last.text;bindForms();toast('已恢复输入和配置，请确认后发送');return;}
    if(await studioUI.handle(a,button))return;
    if(a==='model-verify')return modelUI.verify(x);
    if(a==='close-dialog')return $('#dialog').close();
    if(a==='theme'){state.theme=state.theme==='light'?'dark':'light';applyTheme();document.querySelectorAll('[data-action="theme"]').forEach(b=>b.innerHTML=I('settings')+(state.theme==='light'?'浅色':'深色'));return;}
    if(a==='logout'){await api('logout','POST',{});state.user=null;state.w=null;state.c=null;clearTimeout(poll);goto('login');loginPage();return;}
    if(a==='password')return modal('修改登录密码',input('当前密码','current','','password','required')+input('新密码','password','','password','required minlength="10"'),async b=>{await api('password','POST',b);toast('密码已更新，其他登录会话已退出');});
    if(a==='project-context')return await projectContext.open(x);
    if(a==='project-new')return modal('新建项目',input('项目名称','name','','text','required')+select('访问范围','visibility',[['team','团队共享'],['private','指定成员']]),async b=>{const p=await api('projects','POST',b);await loadCommon();goto('projects',p.id);});
    if(a==='project-share')return projectShare(x);
    if(a==='content-new')return modal('选择创作方式',`<div class="content-options">${btn('集成创作 · 新手推荐','studio-new','','','spark')}${btn('对话创作','chat-new','','','chat')}${btn('节点工作流','workflow-new','','','workflow')}</div>`,null,'关闭');
    if(a==='agent-chat-new'){state.nextChatAgent=x;return newContent('chat');}
    if(a==='templates-open'){location.hash='#workflow/templates';return;}
    if(a==='template-use')return templateModal(x);
    if(a==='template-save')return saveTemplateModal();
    if(a==='workflow-versions')return versionsModal();
    if(a==='version-preview')return versionPreview(Number(button.dataset.revision));
    if(a==='workflow-import-new')return importWorkflow(true);
    if(a==='workflow-import')return importWorkflow();
    if(a==='workflow-ai'){applyNodeForm();state.sideTab='ai';return redrawWorkflow();}
    if(a==='workflow-results'){state.sideTab='run';return redrawWorkflow();}
    if(a==='test-workspace'){await api('test-workspace','POST',{});await loadCommon();await render();toast('测试项目已载入，尚未执行任何模型任务');return;}
    if(a==='test-example'){const ws=state.testWorkspace;if(!ws)return toast('请先载入测试项目');if(button.dataset.source==='workflow')goto('workflow',ws.workflows[x]);else{state.nextChatAgent=x;goto('create',ws.chats[x]);}return;}
    if(a==='test-results-export')return exportManualResults();
    if(a==='expert-new'||a==='expert-edit')return expertModal(x);
    if(a==='workflow-new'||a==='chat-new')return newContent(a==='workflow-new'?'workflow':'chat',null,button.dataset.project);
    if(a==='filter'){state.filter=button.dataset.value;return render();}
    if(a==='asset-filter'){state.assetFilter=button.dataset.value;return render();}
    if(a==='model-category'){state.modelCategory=button.dataset.value;shell(modelsPage());bindForms();return;}
    if(a==='model-new'||a==='model-edit')return modelModal(x);
    if(a==='model-check')return await checkModel(x,button);
    if(a==='asset-new'||a==='asset-version')return uploadModal(state.assets.find(a=>a.id===x));
    if(a==='asset-edit')return assetModal(x);
    if(a==='user-new'||a==='user-edit')return userModal(x);
    if(a==='skill-new'||a==='skill-edit')return skillModal(x);
    if(a==='publish-new')return publishModal();
    if(a==='api-help')return apiHelp(x);
    if(a==='publish-revoke')return modal('撤销 API',`<p>撤销后，${escape(state.publications.find(p=>p.id===x).name)} 的调用凭据立即失效。</p>`,async()=>{await api('publications/'+x,'PATCH',{});await loadCommon();await render();},'撤销');
    if(a==='side-tab'){applyNodeForm();state.sideTab=button.dataset.value;return redrawWorkflow();}
    if(a==='workflow-undo'||a==='workflow-redo')return moveWorkflowHistory(a.slice('workflow-'.length));
    if(a==='workflow-save')return await saveWorkflow();
    if(a==='workflow-run'){if(state.savingWorkflow===state.w||state.dirty)return toast('请先保存当前工作流');button.disabled=true;try{state.w.job=await api('workflows/'+state.w.id+'/run','POST',{revision:state.w.revision,...($('#workflow-context')?.value?{context_revision:Number($('#workflow-context').value)}:{})});state.sideTab='run';redrawWorkflow();}finally{button.disabled=false;}return;}
    if(a==='workflow-json'){applyNodeForm();const workflow=state.w;return modal('工作流 JSON',area('完整配置','workflow-json',JSON.stringify(state.w.document,null,2),'rows="20" spellcheck="false"')+`<input type="file" id="workflow-file" accept="application/json,.json"><p class="note">导入或手动修改后应用到画布，再保存；应用不运行工作流。</p>`,state.w.can_edit?async b=>{let w;try{w=JSON.parse(b['workflow-json']);}catch{throw Error('JSON 格式有误');}await applyWorkflowJson(workflow,w);}:null,'应用到画布');}
    if(a==='workflow-export'){applyNodeForm();const blob=new Blob([JSON.stringify(state.w.document,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),link=document.createElement('a');link.href=u;link.download=state.w.name+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(u),1000);return;}
    if(a==='workflow-clone')return modal('另存为工作流',input('名称','name',state.w.name+' · 副本','text','required')+select('所属项目','project_id',optionsProjects(),state.w.project_id),async b=>{const w=await api('workflows','POST',{...b,document:{...state.w.document,name:b.name}});await loadCommon();goto('workflow',w.id);});
    if(a==='node-add'){
      if(!state.w.can_edit)return;
      applyNodeForm();
      const type=button.dataset.type,nid=type+'_'+crypto.randomUUID().slice(0,8);
      editWorkflow(document=>{
        const offset=Math.max(0,document.nodes.length-3);
        document.nodes.push({id:nid,type,label:nodeNames[type],params:{},position:{x:40+offset%2*290,y:310+Math.floor(offset/2)*190}});
      });
      state.selected=nid;
      state.sideTab='params';
      redrawWorkflow();
      document.querySelector('[data-node="'+nid+'"]').scrollIntoView({block:'nearest',inline:'nearest'});
      return;
    }
    if(a==='node-remove'){
      if(!state.w.can_edit)return;
      applyNodeForm();
      editWorkflow(document=>{
        document.nodes=document.nodes.filter(n=>n.id!==x);
        document.edges=document.edges.filter(e=>e.source!==x&&e.target!==x);
      });
      state.selected=state.w.document.nodes[0]?.id;
      state.connecting=null;
      return redrawWorkflow();
    }
    if(a==='edge-remove'){
      if(!state.w.can_edit)return;
      applyNodeForm();
      editWorkflow(document=>document.edges.splice(Number(button.dataset.index),1));
      return redrawWorkflow();
    }
    if(a==='connect-out'){if(!state.w.can_edit)return;state.connecting=x;return drawCanvas();}
    if(a==='connect-in'){
      if(!state.w.can_edit)return;
      if(!state.connecting)return toast('请先选择输出端口');
      const edge={source:state.connecting,target:x};
      if(edge.source===x)return toast('节点不能连接自身');
      applyNodeForm();
      editWorkflow(document=>{
        if(!document.edges.some(e=>e.source===edge.source&&e.target===edge.target))document.edges.push(edge);
      });
      state.connecting=null;
      return redrawWorkflow();
    }
  }catch(err){toast(err.message);}
});
document.addEventListener('change',async e=>{if(e.target.id==='workflow-file'){try{$('#workflow-json').value=await e.target.files[0].text();}catch(err){toast(err.message);}}});
document.addEventListener('click', e => {
  if (e.target.closest('[data-action]') || !state.w) return;
  try {
    const edge = e.target.closest('[data-edge]');
    if (edge && state.w.can_edit) {
      applyNodeForm();
      editWorkflow(document => document.edges.splice(Number(edge.dataset.edge), 1));
      return redrawWorkflow();
    }
    const node = e.target.closest('[data-node]');
    if (node) {
      applyNodeForm();
      state.selected = node.dataset.node;
      state.sideTab = 'params';
      redrawWorkflow();
    }
  } catch (err) { toast(err.message); }
});
let drag = null;
document.addEventListener('pointerdown', e => {
  const header = e.target.closest('[data-drag]');
  if (!header || !state.w?.can_edit || e.button !== 0 || drag) return;
  try { applyNodeForm(); } catch (err) { toast(err.message); return; }
  e.preventDefault();
  const node = state.w.document.nodes.find(n => n.id === header.dataset.drag);
  drag = {
    workflow:state.w, pointer:e.pointerId, id:node.id, x:e.clientX, y:e.clientY,
    start:node.position, position:node.position, element:header.closest('[data-node]'), moved:false,
  };
  header.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', e => {
  if (!drag || drag.pointer !== e.pointerId || state.w !== drag.workflow) return;
  const dx = (e.clientX - drag.x) / state.zoom;
  const dy = (e.clientY - drag.y) / state.zoom;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  drag.moved = true;
  drag.position = {
    x:Math.round(Math.max(0, Math.min(1350, drag.start.x + dx))),
    y:Math.round(Math.max(0, Math.min(930, drag.start.y + dy))),
  };
  drag.element.style.left = drag.position.x + 'px';
  drag.element.style.top = drag.position.y + 'px';
  $('#edges').innerHTML = edgesSVG(drag);
});
function finishNodeDrag(e) {
  if (!drag || e.pointerId !== drag.pointer) return;
  const gesture = drag;
  drag = null;
  if (!gesture.moved || state.w !== gesture.workflow) return;
  if (e.type === 'pointerup') {
    editWorkflow(document => {
      const node = document.nodes.find(n => n.id === gesture.id);
      if (node) node.position = gesture.position;
    });
  }
  drawCanvas();
}
document.addEventListener('pointerup', finishNodeDrag);
document.addEventListener('pointercancel', finishNodeDrag);
document.addEventListener('lostpointercapture', finishNodeDrag);
document.addEventListener('input', e => {
  if (e.target.closest('#node-form')) updateWorkflowStatus();
});
document.addEventListener('change', e => {
  if (e.target.closest('#node-form')) updateWorkflowStatus();
});
document.addEventListener('keydown', e => {
  if (!state.w?.can_edit || $('#dialog').open || drag) return;
  const direction = workflowHistoryShortcut(e);
  if (direction) {
    e.preventDefault();
    moveWorkflowHistory(direction);
  }
});
window.addEventListener('hashchange',async()=>{if($('#dialog').open)$('#dialog').close();state.analysis='';state.connecting=null;try{if(state.user)await loadCommon();await render();}catch(err){toast(err.message);}});
async function init(){applyTheme();try{const b=await api('bootstrap');state.setup=b.setup_required;state.team=b.team;try{const me=await api('me');state.user=me.user;state.team=me.team;await loadCommon();}catch(err){if(err.status!==401)throw err;}await render();}catch(err){$('#app').innerHTML=`<div class="page">${head('服务连接失败',err.message)}${btn('重新加载','reload')}</div>`;}}
document.addEventListener('click',e=>{if(e.target.closest('[data-action="reload"]'))location.reload();});
await init();
function expertModal(eid){
  const expert=state.experts.find(e=>e.id===eid),ids=expert?.skill_ids||[];
  modal(expert?'编辑专家组合':'新建专家',input('专家名称','name',expert?.name||'','text','required')+select('适用 Agent','task',[['image','图片 Agent'],['video','视频 Agent'],['prompt','提示词 Agent'],['all','所有 Agent']],expert?.task||'all')+`<p class="note">选择至少两个 Skill，可从全部 Skill 中选择，无需配置顺序。</p><div class="expert-skills">${state.skills.map(s=>`<div class="expert-skill"><label><input type="checkbox" name="expert-skills" value="${s.id}" ${ids.includes(s.id)?'checked':''}> ${escape(s.name)}</label></div>`).join('')}</div>`,async(b,f)=>{const selected=[...f.querySelectorAll('[name="expert-skills"]:checked')].map(el=>el.value);await api(expert?'experts/'+eid:'experts',expert?'PUT':'POST',{name:b.name,task:b.task,skill_ids:selected});await loadCommon();await render();});
}
function manualResults(){try{return JSON.parse(localStorage.getItem('cloudheron-manual-results-'+state.user.id)||'{}');}catch{return {};}}
function saveManualResult(id){const results=manualResults();results[id]={status:document.querySelector('select[data-test-result="'+id+'"]').value,actual:document.querySelector('textarea[data-test-result="'+id+'"]').value,at:new Date().toISOString()};localStorage.setItem('cloudheron-manual-results-'+state.user.id,JSON.stringify(results));}
function exportManualResults(){const value={version:'v0.3.1',tester:state.user.name,exported_at:new Date().toISOString(),results:manualResults()},blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='云鹭-手动测试结果.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function testingPage(){
  const ws=state.testWorkspace,results=manualResults();
  return `<div class="page manual-tests" data-req="REQ-035">${head(state.id?projectName(state.id)+' · 测试用例':'手动测试用例','按步骤验证，并记录实际结果。',btn('导出我的测试结果','test-results-export')+(editable()?btn(ws?'重新载入测试项目':'载入测试项目','test-workspace','primary') :''))}<div class="notice">测试项目仅添加示例对话与工作流，不调用模型、不生成预设产物。生成及 AI 修改用例需要你配置对应模型。结果保存在此浏览器，可导出备份；Excel 的实际结果栏由你填写。</div>${ws?`<div class="test-example-links"><a class="btn" href="#projects/${ws.project_id}">打开测试项目</a>${['image','video'].map(kind=>btn(kind==='image'?'测试图片工作流':'测试视频工作流','test-example','',`data-id="${kind}" data-source="workflow"`)).join('')}${state.agents.map(a=>btn('测试'+a.name,'test-example','',`data-id="${a.id}" data-source="chat"`)).join('')}</div>`:''}<p class="note">可下载工作流示例：<a href="/test-workflow-image.json" download>图片工作流 JSON</a> · <a href="/test-workflow-video.json" download>视频工作流 JSON</a> · <a href="/test-workflow-invalid.json" download>无效 JSON 验证样例</a></p><div class="test-case-list">${(state.manualCases||[]).map(c=>`<details class="card test-case"><summary><strong>${c.id} ${escape(c.title)}</strong>${badge(c.needs_model?'需要模型':'无需模型')}</summary><div class="test-case-body"><p><b>关联：</b>${escape(c.req)} / ${escape(c.dev)}</p><p><b>前置条件：</b>${escape(c.precondition)}</p>${c.entry_path?`<a class="btn small" href="${escape(c.entry_path)}">打开这条用例的测试内容</a>`:''}<ol>${c.steps.map(s=>`<li>${escape(s)}</li>`).join('')}</ol><p><b>预期结果：</b>${escape(c.expected)}</p>${select('我的结果','result-'+c.id,[['待执行','待执行'],['通过','通过'],['失败','失败'],['阻塞','阻塞']],results[c.id]?.status||'待执行').replace('<select ','<select data-test-result="'+c.id+'" ')}${area('实际结果／缺陷说明','actual-'+c.id,results[c.id]?.actual||'').replace('<textarea ','<textarea data-test-result="'+c.id+'" ')}</div></details>`).join('')}</div></div>`;
}

const versionAction={baseline:'升级基线',create:'新建',save:'手动保存',ai_modify:'AI 确认修改',restore:'历史恢复',template:'模板复用'};
function templateLibraryPage(){
  const builtin=state.templates.filter(t=>t.builtin),saved=state.templates.filter(t=>!t.builtin),pid=state.collectionProject.workflow;
  const card=t=>`<article class="card template-card"><header><span>${I('workflow')}</span>${badge(t.builtin?'内置模板':'项目模板')}</header><h3>${escape(t.name)}</h3><p>${escape(t.description||'已保存工作流的固定快照')}</p><small>${t.node_count} 个节点 · ${t.edge_count} 条连线${t.source_revision?' · 来源 r'+t.source_revision:''}</small><footer>${t.source_workflow_id?`<a class="note" href="#workflow/${t.source_workflow_id}">查看来源</a>`:'<span></span>'}${btn(editable()?'使用模板':'查看模板','template-use','small',`data-id="${t.id}"`)}</footer></article>`;
  return `<div class="page" data-req="REQ-006 REQ-007">${head('工作流模板','保存可复用的结构与提示词；使用模板仅创建工作流。',btn('返回工作流','templates-back'))}<div class="toolbar">${projectPicker('workflow',pid).replace('data-collection-project','data-template-project')}</div><h3 class="section-label">内置模板</h3><div class="grid3">${builtin.map(card).join('')}</div><div class="project-groups template-projects">${state.projects.filter(p=>(!pid||p.id===pid)&&saved.some(t=>t.project_id===p.id)).map(p=>`<section class="project-group"><header><a href="#workflow/project/${p.id}">${escape(p.name)}</a>${badge(saved.filter(t=>t.project_id===p.id).length+' 个模板')}</header><div class="grid3">${saved.filter(t=>t.project_id===p.id).map(card).join('')}</div></section>`).join('')}</div>${!saved.some(t=>!pid||t.project_id===pid)?empty('这个范围还没有项目模板。打开已保存的工作流，点击“保存为模板”。'):''}</div>`;
}
function saveTemplateModal(){
  if(state.dirty)return toast('请先保存当前工作流，再保存为模板');
  const w=state.w;if(!w?.can_edit)return;
  modal('保存为项目模板',input('模板名称','name',w.name,'text','required')+area('用途说明','description','','maxlength="2000"')+`<p class="note">保存 ${escape(projectName(w.project_id))} 中的 r${w.revision} JSON 快照；来源后续修改不会改变模板，不执行模型。</p>`,async b=>{await api('workflow-templates','POST',{...b,workflow_id:w.id,revision:w.revision});await loadCommon();toast('模板已保存，可在模板库复用');});
}
async function templateModal(tid){
  const t=await api('workflow-templates/'+tid);
  const info=`<p>${escape(t.description||'工作流固定快照')}</p><p class="note">${t.node_count} 个节点，${t.edge_count} 条连线。模板不会自动运行。</p><details class="template-json"><summary>查看模板 JSON</summary><pre class="codebox">${escape(JSON.stringify(t.document,null,2))}</pre></details>`;
  if(!editable())return modal('查看模板 · '+t.name,info,null,'关闭');
  const projects=optionsProjects(),pid=state.collectionProject.workflow||t.project_id,selected=projects.some(p=>p[0]===pid)?pid:projects[0]?.[0]||'__new__';
  modal('使用模板 · '+t.name,input('新工作流名称','name',t.name,'text','required')+select('所属项目','project_id',[...projects,['__new__','同时新建项目']],selected)+`<div id="template-new-project" ${selected==='__new__'?'':'hidden'}>${input('新项目名称','new_project_name','我的创作项目')}</div><div class="checkbox-row"><label><input type="checkbox" name="keep_bindings"> 保留模板中的模型和参考资产选择</label></div><p class="note">默认清空模型及参考资产选择，创建后重新配置。勾选保留时会校验引用权限。</p>`+info,async b=>{let projectId=b.project_id;if(projectId==='__new__')projectId=(await api('projects','POST',{name:b.new_project_name,visibility:'team'})).id;const w=await api('workflow-templates/'+tid+'/instantiate','POST',{project_id:projectId,name:b.name,revision:t.revision,keep_bindings:b.keep_bindings==='on'});await loadCommon();goto('workflow',w.id);toast('已创建独立工作流，尚未运行');},'创建工作流');
  $('#project_id').onchange=e=>$('#template-new-project').hidden=e.target.value!=='__new__';
}
async function versionsModal(){
  if(state.dirty)return toast('请先保存当前修改，再查看和恢复历史');
  const w=state.w;if(!w)return;
  const versions=await api('workflows/'+w.id+'/versions');if(state.w?.id!==w.id)return;
  modal('版本历史 · '+w.name,`<p class="note">历史只记录配置修改；恢复保存为新版本，不执行工作流。升级前仅保留升级时的当前版本。</p><div class="version-list">${versions.map(v=>`<div class="version-row"><div><strong>r${v.revision} ${v.revision===w.revision?'· 当前':''}</strong><p>${escape(versionAction[v.action]||v.action)}${v.source_revision?' · 从 r'+v.source_revision+' 恢复':''} · ${escape(v.actor_name||'升级记录')}</p><small>${escape(new Date(v.saved_at).toLocaleString())}</small></div>${btn('查看与对比','version-preview','small',`data-revision="${v.revision}"`)}</div>`).join('')||'<p class="note">暂无版本记录。</p>'}</div>`,null,'关闭');
}
async function versionPreview(revision){
  const w=state.w;if(!w||state.dirty)return toast('请先保存当前修改');
  const v=await api('workflows/'+w.id+'/versions/'+revision);if(state.w?.id!==w.id)return;
  const canRestore=w.can_edit&&v.revision!==w.revision;
  modal('对比历史版本 r'+revision,`<p>当前保存版 r${w.revision} 与历史 r${revision}。</p><p class="note">${canRestore?'确认后生成新版本，保留现有历史；发布的 API 不变，任务不会自动运行。':'此处仅查看 JSON。'} </p><div class="diff version-diff"><div><h3>当前 r${w.revision}</h3><pre>${escape(JSON.stringify(w.document,null,2))}</pre></div><div><h3>历史 r${revision}</h3><pre>${escape(JSON.stringify(v.document,null,2))}</pre></div></div>`,canRestore?async()=>{if(state.w!==w||state.dirty||state.savingWorkflow===w)throw Error('请先保存当前画布，再恢复历史');const restored=await api('workflows/'+w.id+'/restore','POST',{revision:w.revision,source_revision:v.revision});acceptWorkflowRevision(w,restored);await loadCommon();toast('已恢复为 r'+restored.revision+'，尚未运行');}:null,canRestore?'恢复为新版本':'关闭');
}
document.addEventListener('click',e=>{if(e.target.closest('[data-action="templates-back"]')){location.hash='#workflow/project/'+(state.collectionProject.workflow||'');}});
