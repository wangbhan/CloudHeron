import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const registration=source.split('\n').find(line=>line.trim().startsWith("if($('#assist-form'))"));
for(const mode of ['analyze','modify'])test('工作流助手 '+mode+' 上游失败提示验收入口且不提交修改',async()=>{
  const nodes=[],error={textContent:'',append(...items){nodes.push(...items);}},form={querySelector:()=>error};
  let requests=0;const state={dirty:false,w:{id:'fixture-workflow'},analysis:'',proposal:null};
  const api=async(path,method,body)=>{requests++;assert.equal(path,'workflows/fixture-workflow/assist');assert.equal(method,'POST');assert.equal(body.mode,mode);throw Error('模型 HTTP 502（POST /v1/chat/completions）：synthetic upstream error');};
  class FormDataFixture{*[Symbol.iterator](){yield ['assist-mode',mode];yield ['assist-model','fixture-model'];yield ['assist-prompt','synthetic prompt'];}}
  const document={createElement:tag=>({tag,textContent:'',href:''}),createTextNode:textContent=>({textContent})};
  new Function('$','state','api','readApiOptions','redrawWorkflow','showProposal','FormData','document',registration)(()=>form,state,api,()=>({}),()=>assert.fail('失败时不显示分析结果'),()=>assert.fail('失败时不显示修改提案'),FormDataFixture,document);
  const button={disabled:false};await form.onsubmit({preventDefault(){},submitter:button,target:form});
  assert.equal(requests,1);assert.match(error.textContent,/HTTP 502/);assert(nodes.some(n=>n.textContent.includes('工作流未被本次请求更改')));assert(nodes.some(n=>n.tag==='a'&&n.href==='#models'));assert.equal(state.proposal,null);assert.equal(state.analysis,'');assert.equal(button.disabled,false);
});
