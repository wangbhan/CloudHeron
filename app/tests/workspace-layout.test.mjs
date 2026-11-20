import test from 'node:test';
import assert from 'node:assert/strict';
import {syncResponsivePanel} from '../public/features/workspace-layout.js';
function panel(){
 const attrs=new Map(),draft={value:'768x768',text:'保留未提交的参数'};
 return {draft,open:false,closed:0,
  setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key),
  matches(){return this.open;},
  hidePopover(){assert.equal(attrs.get('popover'),'auto');this.open=false;this.closed++;},
  mode:()=>attrs.get('popover')};
}
test('窄屏设置切回桌面先关闭浮层，保留同一面板和未提交参数',()=>{
 const p=panel(),draft=p.draft;
 syncResponsivePanel(p,false);p.open=true;
 syncResponsivePanel(p,true);
 assert.equal(p.closed,1);assert.equal(p.mode(),undefined);
 assert.equal(p.draft,draft);assert.equal(p.draft.value,'768x768');
 assert.equal(p.draft.text,'保留未提交的参数');
});
test('反复切换布局不会对已关闭的面板调用原生关闭方法',()=>{
 const p=panel();
 syncResponsivePanel(p,true);syncResponsivePanel(p,true);
 syncResponsivePanel(p,false);syncResponsivePanel(p,false);
 assert.equal(p.closed,0);assert.equal(p.mode(),'auto');
 syncResponsivePanel(null,true);
});
