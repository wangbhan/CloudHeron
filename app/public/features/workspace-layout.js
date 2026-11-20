export function syncResponsivePanel(panel,inline) {
  if(!panel)return;
  if(inline) {
    if(panel.matches(':popover-open'))panel.hidePopover();
    panel.removeAttribute('popover');
  } else panel.setAttribute('popover','auto');
}
export function createWorkspaceLayout({$}) {
  const navigation=window.matchMedia('(min-width:761px)');
  const conversation=window.matchMedia('(min-width:1280px)');
  const canvas=window.matchMedia('(min-width:1101px)');
  function sync() {
    syncResponsivePanel($('#workspace-nav'),navigation.matches);
    for(const selector of ['#chat-history-panel','#chat-settings'])syncResponsivePanel($(selector),conversation.matches);
    for(const selector of ['#workflow-node-panel','#workflow-inspector'])syncResponsivePanel($(selector),canvas.matches);
  }
  for(const query of [navigation,conversation,canvas])query.addEventListener('change',sync);
  document.addEventListener('click',event=>{
    const menu=$('.workflow-actions-menu[open]');
    if(menu&&!menu.contains(event.target))menu.open=false;
  });
  document.addEventListener('keydown',event=>{
    const menu=$('.workflow-actions-menu[open]');
    if(event.key==='Escape'&&menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus();}
  });
  function reveal(id){const panel=$('#'+id);if(panel?.hasAttribute('popover')&&!panel.matches(':popover-open'))panel.showPopover();}
  return {bind:sync,reveal};
}
