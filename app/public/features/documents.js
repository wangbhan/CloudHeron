export function createDocumentFeature(ui) {
  const {state,$,api,btn,select,area,escape:esc,preview,modal,toast,fileData,modelOptions}=ui;
  let chatId=null, rows=[], timer=null, uploading=false;
  const pending=new Map();
  const selections=state.chatDocumentIds??={};
  const selected=()=>rows.find(row=>row.id===selections[state.c?.id]);

  function panel() {
    if(!state.c)return '';
    const row=selected();
    const busy=uploading||['queued','running'].includes(state.c.job?.status);
    return `<section class="document-panel ${rows.length?'has-documents':''}" aria-label="文档创作" data-req="REQ-060">
      <input id="chat-document-upload" type="file" accept=".pdf,.docx" hidden ${!state.c.can_edit||busy?'disabled':''}>
      ${uploading?'<p class="attachment-status" role="status">正在提取文档图文…</p>':''}${rows.length?select('创作文档','chat-document-select',[['','不使用文档'],...rows.map(d=>[d.id,d.filename])],selections[state.c.id]||''):''}
      ${row?`<div class="document-state">
      <p class="note">${row.status==='confirmed'?'已确认 · '+row.selected_asset_ids.length+' 张生成参考图':row.job&&['queued','running'].includes(row.job.status)?'AI 正在理解图文…':row.status==='analyzed'?'图文分析完成，待确认':'已提取 '+row.content.images.length+' 张图片，待分析确认'}</p>
      ${btn('查看解析与确认','document-review','small',`data-id="${row.id}"`)}</div>
      ${row.job?.status==='failed'?`<p class="form-error">${esc(row.job.error)}</p>`:''}`:''}
      <p id="document-error" class="form-error" role="alert"></p></section>`;
  }

  function draw() {
    const host=$('#chat-document');
    if(host){host.innerHTML=panel();bindInputs();}
    ui.onStateChange?.();
  }
  function schedule() {
    clearTimeout(timer);
    if(!rows.some(row=>row.job&&['queued','running'].includes(row.job.status)))return;
    const id=chatId;
    timer=setTimeout(async()=>{
      if(state.c?.id!==id)return;
      try{
        await refresh(id);
        const row=selected();
        if(row?.status==='analyzed')toast('文档图文分析完成，请查看并确认');
      }catch(error){toast(error.message);}
    },1200);
  }
  async function refresh(id) {
    const list=await api('chats/'+id+'/documents');
    if(state.c?.id!==id)return;
    rows=list;chatId=id;
    draw();schedule();
  }
  function bindInputs() {
    const picker=$('#chat-document-select');
    if(picker)picker.onchange=event=>{selections[state.c.id]=event.target.value;draw();};
    const upload=$('#chat-document-upload');
    if(!upload)return;
    upload.onchange=async()=>{
      const file=upload.files[0],chat=state.c;
      if(!file||!chat.can_edit||uploading)return;
      uploading=true;draw();
      try{
        if(!/\.(pdf|docx)$/i.test(file.name))throw Error('请选择 PDF 或 Word .docx 文档');
        const row=await api('chats/'+chat.id+'/documents','POST',{filename:file.name,base64:await fileData(file)});
        const assets=await api('assets');
        if(state.c?.id===chat.id){
          state.assets=assets;rows=[row,...rows];selections[chat.id]=row.id;
          draw();review(row);
        }
      }catch(error){if(state.c?.id===chat.id)$('#document-error').textContent=error.message;}
      finally{
        uploading=false;
        if(state.c?.id===chat.id){
          // Keep an extraction error visible when restoring the upload control.
          const error=$('#document-error')?.textContent;
          draw();
          if(error)$('#document-error').textContent=error;
        }
      }
    };
  }
  function bind() {
    if(!$('#chat-document')||!state.c)return;
    if(chatId!==state.c.id){
      chatId=state.c.id;rows=[];
      const last=[...state.c.messages].reverse().find(message=>message.config?.document_id);
      if(!(chatId in selections))selections[chatId]=last?.config.document_id||'';
      draw();
      refresh(chatId).catch(error=>toast(error.message));
    }else{
      bindInputs();schedule();
    }
  }
  function review(row) {
    const busy=row.job&&['queued','running'].includes(row.job.status);
    const ready=['analyzed','confirmed'].includes(row.status);
    const canEdit=state.c.can_edit;
    modal('解析文档 · '+row.filename,
      row.content.warnings.map(message=>`<p class="notice">${esc(message)}</p>`).join('')+
      '<p class="note">PDF 页面图片用于理解版面与扫描内容。Word 提取正文、表格文字和内嵌图片。</p>'+
      `<details><summary>提取的文字</summary><pre class="document-text">${esc(row.content.sections.map(section=>section.label+'\n'+section.text).join('\n\n'))}</pre></details>`+
      select('支持图片理解的文本模型','document-model',modelOptions('text'),state.chatTextModel||'')+
      '<p class="note">此步骤会将正文和下方全部页面或内嵌图发送到所选模型，请确认模型支持图片输入。</p>'+
      (canEdit?btn(busy?'分析中…':'AI 理解图文','document-analyze','small',`data-id="${row.id}" ${busy?'disabled':''}`):'')+
      (row.job?.status==='failed'?`<p class="form-error">${esc(row.job.error)}</p>`:'')+
      (ready?area('创作摘要（可修改）','document-summary',row.summary,'rows="9" maxlength="16000"'):'')+
      '<p class="note">分析时读取所有图片；确认时勾选用于生成的参考图，最多 8 张。vLLM-Omni 视频每次选择 1 张。</p>'+
      `<div class="reference-picker">${row.content.images.map(image=>`<label><input type="checkbox" name="document-reference" value="${image.asset_id}" ${row.selected_asset_ids.includes(image.asset_id)?'checked':''}>${preview(image.asset_id)}<span>${esc(image.label)}</span></label>`).join('')}</div>`,
      ready&&canEdit?async(_,form)=>{
        const ids=[...form.querySelectorAll('[name="document-reference"]:checked')].map(el=>el.value);
        const confirmed=await api('documents/'+row.id+'/confirm','POST',{job_id:row.job_id,summary:form.querySelector('#document-summary').value,asset_ids:ids});
        rows=rows.map(item=>item.id===row.id?confirmed:item);
        selections[row.chat_id]=row.id;draw();
        toast('文档摘要与参考图已确认，点击发送继续创作');
      }:null,ready&&canEdit?'确认用于创作':'关闭');
  }
  async function handle(action,button) {
    if(action==='document-review'){
      const row=await api('documents/'+button.dataset.id);
      if(row.chat_id===state.c?.id)review(row);
      return true;
    }
    if(action!=='document-analyze')return false;
    const id=button.dataset.id,chat=state.c;
    const previousJob=rows.find(row=>row.id===id)?.job_id;
    button.disabled=true;
    try{
      const model=$('#document-model').value;
      if(!model)throw Error('请选择支持图片理解的文本模型');
      const signature=JSON.stringify([id,model]);
      if(pending.get(id)?.signature!==signature)pending.set(id,{signature,key:crypto.randomUUID()});
      await api('documents/'+id+'/analyze','POST',{model_id:model},{headers:{'Idempotency-Key':pending.get(id).key}});
      pending.delete(id);
      $('#dialog').close();
      await refresh(chat.id);
    }catch(error){
      const errorBox=$('#dialog .form-error');
      if(errorBox)errorBox.textContent=error.message;
      else toast(error.message);
      // Refresh a possibly accepted request instead of automatically sending another.
      await refresh(chat.id).catch(()=>{});
      if(rows.find(row=>row.id===id)?.job_id!==previousJob)pending.delete(id);
    }finally{button.disabled=false;}
    return true;
  }
  function validate() {
    if(uploading)throw Error('请等待文档提取完成');
    const row=selected();
    if(selections[state.c?.id]&&(!row||row.status!=='confirmed'))throw Error('请先分析并确认文档，或选择“不使用文档”');
  }
  return {panel,bind,handle,validate,isUploading:()=>uploading};
}
