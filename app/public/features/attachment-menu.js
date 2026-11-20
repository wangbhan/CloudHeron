export function createAttachmentMenu({state,$,icon,isDocumentUploading,chooseLibrary}) {
  const busy=()=>!state.c?.can_edit||state.referenceUpload||isDocumentUploading()||
    ['queued','running'].includes(state.c?.job?.status);
  const items=[
    ['image','image','上传图片','PNG、JPG、WebP、GIF'],
    ['pdf','text','上传 PDF','最多 12 页，解析文字与页面图片'],
    ['word','text','上传 Word','.docx，解析正文与内嵌图片'],
    ['library','assets','从资产库选择','复用已有参考素材'],
  ];
  function panel() {
    return `<div class="compose-attachments" data-req="REQ-061">
      <button type="button" id="chat-attachment-add" class="attachment-add" popovertarget="chat-attachment-menu"
        aria-label="添加图片或文档" aria-haspopup="menu" title="添加图片或文档" ${busy()?'disabled':''}>${icon('plus')}</button>
      <div id="chat-attachment-menu" class="attachment-menu" popover="auto" role="menu" aria-label="添加创作素材">
        <p class="attachment-menu-title">添加创作素材</p>
        ${items.map(([key,glyph,title,description])=>`<button type="button" role="menuitem" data-attachment="${key}" class="attachment-option">
          <span class="attachment-option-icon">${icon(glyph)}</span><span><strong>${title}</strong><small>${description}</small></span>
        </button>`).join('')}
        <p class="attachment-menu-note">单文件最多 20 MB</p>
      </div></div>`;
  }
  function close(restore=false) {
    const menu=$('#chat-attachment-menu');
    if(menu?.matches(':popover-open'))menu.hidePopover();
    if(restore)$('#chat-attachment-add')?.focus();
  }
  function refresh() {
    const button=$('#chat-attachment-add'),menu=$('#chat-attachment-menu');
    if(!button||!menu)return;
    button.disabled=Boolean(busy());
    const image=$('#chat-reference-upload'),document=$('#chat-document-upload');
    if(image)image.disabled=Boolean(busy()||state.chatAgent==='prompt');
    if(document)document.disabled=Boolean(busy());
    for(const item of menu.querySelectorAll('[data-attachment]')) {
      const media=['image','library'].includes(item.dataset.attachment);
      item.disabled=Boolean(busy()||(media&&state.chatAgent==='prompt'));
      item.title=media&&state.chatAgent==='prompt'?'切换到图片或视频 Agent 后可添加参考素材':'';
    }
    if(button.disabled)close();
  }
  function position() {
    const menu=$('#chat-attachment-menu'),button=$('#chat-attachment-add');
    if(!menu||!button)return false;
    const box=button.getBoundingClientRect(),width=Math.min(280,window.innerWidth-32);
    if(box.top>=window.innerHeight||box.bottom<=0){close();return false;}
    menu.style.width=width+'px';
    menu.style.left=Math.max(16,Math.min(box.left,window.innerWidth-width-16))+'px';
    const above=box.top>(menu.offsetHeight||330)+24||box.top>window.innerHeight-box.bottom;
    menu.style.top=above?'auto':box.bottom+10+'px';
    menu.style.bottom=above?window.innerHeight-box.top+10+'px':'auto';
    menu.style.maxHeight=Math.max(80,above?box.top-26:window.innerHeight-box.bottom-26)+'px';
    return true;
  }
  let watching;
  function bind() {
    const menu=$('#chat-attachment-menu');
    if(!menu)return;
    refresh();
    watching?.abort();
    menu.onbeforetoggle=event=>{if(event.newState==='open'&&!position())event.preventDefault();};
    menu.ontoggle=event=>{
      watching?.abort();
      if(event.newState==='open'){
        if(!position())return;
        menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({preventScroll:true});
        watching=new AbortController();
        window.addEventListener('resize',position,{signal:watching.signal});
        window.addEventListener('scroll',event=>{if(!menu.contains(event.target))close();},{capture:true,signal:watching.signal});
      }
    };
    menu.onkeydown=event=>{
      const options=[...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
      const index=options.indexOf(document.activeElement);
      let target;
      if(event.key==='ArrowDown')target=options[(index+1)%options.length];
      if(event.key==='ArrowUp')target=options[(index-1+options.length)%options.length];
      if(event.key==='Home')target=options[0];
      if(event.key==='End')target=options.at(-1);
      if(target){event.preventDefault();target.focus();}
    };
    menu.onclick=event=>{
      const option=event.target.closest('[data-attachment]');
      if(!option||option.disabled||busy())return;
      const type=option.dataset.attachment;
      close(true);
      if(type==='library'){chooseLibrary();return;}
      const input=$(type==='image'?'#chat-reference-upload':'#chat-document-upload');
      if(!input||input.disabled)return;
      input.accept=type==='pdf'?'.pdf':type==='word'?'.docx':'image/png,image/jpeg,image/webp,image/gif';
      input.value='';
      input.click();
    };
  }
  return {panel,bind,refresh};
}
