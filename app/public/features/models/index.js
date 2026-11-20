export function createModelFeature(ui){
  const {state,$,escape:esc,head,btn,badge,input,select,area,modal,api,loadCommon,render,toast,optionsProjects,goto,fileData}=ui;
  const labels={text:'文本',image:'图片',image_edit:'参考图片编辑',video:'视频',video_reference:'参考视频'};
  const styleName=s=>state.modelStyles.find(x=>x.id===s.interface_style)?.name||([s.protocol,s.text_format,s.video_style].filter(Boolean).join(' / '));
  function resultHTML(id){const r=state.modelChecks[id];if(!r)return '';return `<p class="${r.status==='failed'?'form-error':'note'}">${esc(r.status==='running'?'正在检测服务连接…':r.note)}${r.elapsed_ms!==undefined?' · '+r.elapsed_ms+' ms':''}</p>`;}
  async function check(id,button){const attempt=crypto.randomUUID();let first=true;const update=r=>{if(!first&&state.modelChecks[id]?.attempt!==attempt)return;first=false;state.modelChecks[id]={...r,attempt};const target=document.querySelector('[data-model-check="'+id+'"]');if(target)target.innerHTML=resultHTML(id);};update({status:'running'});button.disabled=true;button.textContent='测试中…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const r=await api('models/'+id+'/check','POST',{}, {signal:controller.signal});update(r);}catch(e){update({status:'failed',note:e.name==='AbortError'?'连接测试超时，请检查网络与服务状态':e.message});}finally{clearTimeout(timer);button.disabled=false;button.textContent='列表检测';}}
  function page(){const cap=state.modelCategory||'all',query=(state.modelQuery||'').toLowerCase(),models=state.models.filter(m=>cap==='all'||m.spec.capabilities.includes(cap));
    return `<div class="page model-studio" data-req="REQ-015 REQ-044 REQ-048 REQ-049">${head('模型连接','按能力选择模型，按接口风格组织请求。',state.user.role==='admin'?btn('添加模型连接','model-new','primary','','plus'):'')}<div class="model-explainer"><strong>厂商 · 接口风格 · 模型名称</strong><p>厂商用于标记来源，接口风格决定数据格式，模型名称原样传给上游。三者独立配置。</p></div><div class="model-toolbar"><div class="model-tabs">${[['all','全部'],['text','文本模型'],['image','图片模型'],['video','视频模型']].map(([id,name])=>btn(name,'model-category',cap===id?'active':'',`data-value="${id}" aria-pressed="${cap===id}"`)).join('')}</div><input class="input model-search" id="model-search" aria-label="搜索模型连接" placeholder="搜索名称、厂商或接口风格" value="${esc(state.modelQuery||'')}"></div><div class="model-cards">${models.map(m=>`<article class="model-card" data-model-search="${esc([m.name,m.spec.model,m.spec.provider,styleName(m.spec)].join(' ').toLowerCase())}"><header><span class="model-symbol">${esc(m.spec.capabilities.includes('video')?'V':m.spec.capabilities.includes('image')?'I':'T')}</span><div><h2>${esc(m.name)}</h2><small>${esc(m.spec.provider||'自定义厂商')} · ${esc(m.spec.source||'团队接入')}</small></div>${badge(m.enabled?'已启用':'已停用',m.enabled?'green':'')}</header><dl><div><dt>接口风格</dt><dd>${esc(styleName(m.spec))}</dd></div><div><dt>上游模型</dt><dd><code>${esc(m.spec.model)}</code></dd></div></dl><div class="model-capabilities">${m.spec.capabilities.map(c=>badge(labels[c]||c)).join('')}</div><footer>${state.user.role==='admin'?btn('编辑配置','model-edit','small',`data-id="${m.id}"`)+btn(state.modelChecks[m.id]?.status==='running'?'测试中…':'列表检测','model-check','small',`data-id="${m.id}" ${state.modelChecks[m.id]?.status==='running'?'disabled':''}`):'<span class="note">团队可用 · 凭据由服务端保管</span>'}${state.user.role==='admin'&&m.enabled?btn('验证生成','model-verify','small',`data-id="${m.id}"`):''}</footer><div data-model-check="${m.id}" class="model-check-result" aria-live="polite">${resultHTML(m.id)}</div></article>`).join('')}</div><p class="model-no-results note" hidden>没有匹配的模型连接。</p>${models.length?'':'<div class="model-empty"><h2>配置你的'+(cap==='all'?'第一个':{text:'文本',image:'图片',video:'视频'}[cap])+'模型连接</h2><p>同一接口风格可以添加多个模型；无需匹配预设名称。</p>'+(state.user.role==='admin'?btn('添加模型连接','model-new','primary'):'请联系管理员配置')+'</div>'}<p class="note model-footnote">列表检测仅证明目录可读，不代表生成权限与服务可用。“验证生成”会创建一次真实任务，结果和错误保存在项目对话中。</p></div>`;
  }
  function edit(mid){const m=state.models.find(x=>x.id===mid),s=m?.spec||{interface_style:'openai',provider:'',source:'团队接入',base_url:'',model:'',capabilities:[state.modelCategory==='all'||!state.modelCategory?'text':state.modelCategory],paths:{},extra:{}};
    modal(m?'编辑模型连接':'添加模型连接',`<p class="note">接口风格和模型名称独立；切换风格保留地址、名称及高级配置，请核对接口路径。</p><div class="model-form-grid">${input('配置名称','name',m?.name||'','text','required')}${input('厂商名称（可自定义）','provider',s.provider||'','text','placeholder="例如 MiniMax、自建推理服务" maxlength="100"')}${select('来源','source',[['团队接入','团队接入'],['平台服务','平台服务']],s.source||'团队接入')}${select('接口风格','interface_style',state.modelStyles.map(x=>[x.id,x.name]),s.interface_style||'legacy')}</div><p id="style-help" class="model-style-help"></p>${input('服务根地址','base_url',s.base_url||'','url','required')}${input('上游模型名称（自由填写）','model',s.model||'','text','required placeholder="填写上游实际模型ID，保持原样传递"')}${input(m?.has_key?'API 密钥（留空保留）':'API 密钥（无认证服务可留空）','api_key','','password','autocomplete="off"')}<fieldset class="model-cap-picker"><legend>任务能力</legend>${Object.entries(labels).map(([v,t])=>`<label><input type="checkbox" name="cap_${v}" ${s.capabilities.includes(v)?'checked':''}> ${t}</label>`).join('')}</fieldset><div id="minimax-text">${select('文本生成协议','text_format',[['openai','OpenAI · Chat Completions'],['responses','OpenAI · Responses'],['claude','Claude · Messages']],s.text_format||'openai')}<p class="note">地址只填主机时默认使用 /v1；已有 /v1 或自定义路径会保留。协议决定请求结构；自定义 text 路径优先。Claude 使用对应 Messages 地址。</p></div><details class="model-advanced"><summary>高级路径、格式与默认参数</summary><div id="legacy-model-fields">${select('历史协议 / 部署框架','protocol',['OpenAI','Claude','vLLM','vLLM-Omni','SGLang','MiniMax'],s.protocol||'OpenAI')}${select('历史文本格式','legacy_text_format',[['openai','OpenAI'],['responses','Responses'],['claude','Claude']],s.text_format||'openai')}${select('历史视频风格','video_style',[['openai','OpenAI 兼容'],['vllm_omni','vLLM-Omni'],['minimax','MiniMax V1'],['minimax_v2','MiniMax V2']],s.video_style||'openai')}</div>${select('图片请求编码','format',['json','multipart'],s.format||'json')}${select('视频请求编码','video_format',['multipart','json'],s.video_format||'multipart')}${area('相对路径 JSON','paths',JSON.stringify(s.paths||{},null,2))}${area('参考字段 JSON','reference_fields',JSON.stringify(s.reference_fields||{},null,2))}${area('模型默认请求参数 JSON','extra',JSON.stringify(s.extra||{},null,2))}<p class="note">保留 text、image、edit、video、video_status、video_content、models 路径覆盖；{} 使用适配器默认值。MiniMax V1 根地址通常含 /v1，V2 使用主机根地址。默认参数不会替换受控的模型、提示词与参考资产。</p></details>${m?select('状态','enabled',[['yes','启用'],['no','停用']],m.enabled?'yes':'no'):''}`,async b=>{let paths,extra,reference_fields;try{paths=JSON.parse(b.paths||'{}');extra=JSON.parse(b.extra||'{}');reference_fields=JSON.parse(b.reference_fields||'{}');}catch{throw Error('高级配置须为有效JSON对象');}const spec={...s,provider:b.provider.trim(),source:b.source,interface_style:b.interface_style,base_url:b.base_url.trim(),model:b.model.trim(),capabilities:Object.keys(labels).filter(k=>b['cap_'+k]),protocol:b.protocol||s.protocol||'OpenAI',text_format:b.interface_style==='legacy'?b.legacy_text_format:b.interface_style==='anthropic'?'claude':b.text_format,video_style:b.video_style,format:b.format,video_format:b.video_format,paths,reference_fields,extra};if(!spec.provider)delete spec.provider;await api(mid?'models/'+mid:'models',mid?'PUT':'POST',{name:b.name,spec,...(b.api_key||!mid?{api_key:b.api_key}:{}),enabled:b.enabled!=='no'});delete state.modelChecks[mid];await loadCommon();await render();toast('模型连接已保存');});
    const refresh=()=>{const style=state.modelStyles.find(x=>x.id===$('#interface_style').value);$('#style-help').textContent=style.note;$('#base_url').placeholder=style.base_hint;$('#minimax-text').hidden=style.id==='legacy'||!$('[name=cap_text]').checked;if(style.id==='anthropic')$('#text_format').value='claude';else if(['openai','vllm_omni'].includes(style.id)&&$('#text_format').value==='claude')$('#text_format').value='openai';$('#text_format').disabled=style.id==='anthropic';$('#legacy-model-fields').hidden=style.id!=='legacy';for(const cap of Object.keys(labels)){const el=$('[name="cap_'+cap+'"]');const supported=style.capabilities.includes(cap);el.disabled=!supported;if(!supported)el.checked=false;}const forced=['minimax','minimax_v2','vllm_omni'].includes(style.id);$('#video_format').disabled=forced;if(forced)$('#video_format').value=style.id==='vllm_omni'?'multipart':'json';$('#format').disabled=['minimax','minimax_v2'].includes(style.id);if($('#format').disabled)$('#format').value='json';};$('#interface_style').onchange=refresh;$('#modal-form').addEventListener('change',e=>{if(e.target.name.startsWith('cap_'))refresh();});refresh();
  }
  function verify(id) {
    const m=state.models.find(x=>x.id===id);
    const kinds=['text','image','video'].filter(c=>m.spec.capabilities.includes(c));
    if(!kinds.length)return toast('请先在模型配置中启用文本、图片或视频生成能力');
    const projects=optionsProjects();
    let prepared=null,pending=null;
    modal('实际生成验收 · '+m.name,
      '<p class="notice">这会发送一次真实生成请求，使用上游额度。可先核对参数和参考图，结果与错误保存在项目对话中。</p>'+
      select('验收能力','verify-kind',kinds.map(k=>[k,labels[k]]))+
      select('保存到项目','verify-project',[...projects,['__new__','新建验收项目']],projects[0]?.[0]||'__new__')+
      input('新项目名称（新建时使用）','verify-project-name','模型生成验收')+
      area('测试描述','verify-prompt','','required')+
      input('媒体分辨率 / 原生清晰度','verify-size','')+
      input('视频时长（秒）','verify-seconds',4,'number','min="1" max="120"')+
      '<div id="verify-reference-fields">'+
      select('参考图片（选填）','verify-reference',[['','不使用参考图'],...state.assets.filter(a=>a.mime.startsWith('image/')).map(a=>[a.id,a.name+' · v'+a.version])])+
      '<div class="form-field"><label for="verify-upload">上传参考图片（选填，最多 20 MB）</label><input id="verify-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></div>'+
      '<p class="note">图生视频模型通常需要参考图片。上传的文件优先于资产选择。图片编辑需启用对应模型能力。</p></div>',
      async(b,form)=>{
        const kind=b['verify-kind'],file=form.querySelector('#verify-upload').files[0];
        const assetId=b['verify-reference'];
        if(kind==='image'&&(file||assetId)&&!m.spec.capabilities.includes('image_edit'))throw Error('请在模型配置中启用参考图片编辑能力');
        if(kind==='video'&&(!Number.isFinite(Number(b['verify-seconds']))||Number(b['verify-seconds'])<1))throw Error('请填写有效的视频时长');
        if(file&&(file.size>20*1024*1024||!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)))throw Error('请选择 20 MB 以内的参考图片');
        const target=JSON.stringify([b['verify-project'],b['verify-project-name']]);
        if(prepared?.target!==target){
          let projectId=b['verify-project'];
          if(projectId==='__new__')projectId=(await api('projects','POST',{name:b['verify-project-name'],visibility:'private'})).id;
          const chat=await api('chats','POST',{project_id:projectId,title:'模型验收 · '+m.name});
          prepared={target,projectId,chat};
        }
        let refs=kind==='text'?[]:assetId?[assetId]:[];
        if(kind!=='text'&&file){
          if(prepared.file!==file){
            const asset=await api('assets','POST',{project_id:prepared.projectId,name:file.name,kind:'image',visibility:'private',mime:file.type,filename:file.name,base64:await fileData(file)});
            prepared.file=file;prepared.asset=asset;
            state.assets.push(asset);
          }
          refs=[prepared.asset.id];
        }
        const config=kind==='text'
          ?{agent:'prompt',kind:'image',model_id:m.id,max_tokens:m.spec.extra?.max_tokens??512}
          :{agent:kind,kind,model_id:m.id,asset_ids:refs,
             ...(b['verify-size']?{size:b['verify-size']}:{}),
             ...(kind==='video'?{seconds:Number(b['verify-seconds'])}:{})};
        const body={prompt:b['verify-prompt'],config};
        const signature=JSON.stringify([prepared.chat.id,body]);
        if(pending?.signature!==signature)pending={signature,key:crypto.randomUUID()};
        await api('chats/'+prepared.chat.id+'/messages','POST',body,{headers:{'Idempotency-Key':pending.key}});
        await loadCommon();
        state.nextChatAgent=kind==='text'?'prompt':kind;
        goto('create',prepared.chat.id);
      },'开始实际验收');
    const fields=()=>{
      const kind=$('#verify-kind').value;
      $('#verify-size').closest('.form-field').hidden=kind==='text';
      $('#verify-seconds').closest('.form-field').hidden=kind!=='video';
      $('#verify-reference-fields').hidden=kind==='text';
      $('#verify-project-name').closest('.form-field').hidden=$('#verify-project').value!=='__new__';
    };
    const defaults=()=>{
      const kind=$('#verify-kind').value,extra=m.spec.extra||{};
      $('#verify-prompt').value=kind==='text'?'请只回复：连接验证成功':'纯白背景上的蓝色圆球，柔和自然光';
      $('#verify-size').value=extra.size||(kind==='video'?'1280x720':'1024x1024');
      $('#verify-seconds').value=extra.seconds??extra.duration??(m.spec.video_style==='minimax'?6:4);
      fields();
    };
    $('#verify-kind').onchange=defaults;
    $('#verify-project').onchange=fields;
    defaults();
  }
  function bind(){const search=$('#model-search');if(!search)return;const filter=()=>{state.modelQuery=search.value;const query=search.value.trim().toLowerCase();let visible=0;document.querySelectorAll('.model-card').forEach(card=>{card.hidden=!card.dataset.modelSearch.includes(query);if(!card.hidden)visible++;});const empty=$('.model-no-results');if(empty)empty.hidden=visible>0||!document.querySelector('.model-card');};search.oninput=filter;filter();}
  return {page,edit,check,bind,verify};
}
