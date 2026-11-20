import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const registration=source.split('\n').find(line=>line.trim().startsWith("if($('#chat-form'))"));
function harness(transport){const error={textContent:''},form={querySelector:()=>error},prompt={value:'synthetic prompt'},feed={innerHTML:''};const $=s=>s==='#chat-form'?form:s==='#chat-prompt'?prompt:s==='#chat-feed'?feed:{};const state={c:{id:'c',can_edit:true},chatAgent:'prompt',chatModel:'m',chatSkills:[]};const keys=[];let polls=0;const api=async(...a)=>{if(a[1]==='POST')keys.push(a[3].headers['Idempotency-Key']);return transport(...a);};new Function('$','state','captureChatSettings','api','readApiOptions','chatFeed','schedulePoll','documentUI',registration)($,state,()=>{},api,()=>({}),()=>'',()=>polls++,{validate(){}});return{state,prompt,error,keys,get polls(){return polls;},send:async()=>{const b={disabled:false};await form.onsubmit({preventDefault(){},submitter:b,target:form});return b;}};}
test('对话请求受理状态未知时保留输入并重用同一幂等键',async()=>{const h=harness(async()=>{throw Error('network');});await h.send();await h.send();assert.equal(h.prompt.value,'synthetic prompt');assert.equal(h.keys[0],h.keys[1]);h.prompt.value='changed';await h.send();assert.notEqual(h.keys[1],h.keys[2]);});
test('对话已受理但刷新失败仍锁定按钮并查询原任务',async()=>{const h=harness(async(path,method)=>{if(method==='POST')return{id:'j',status:'queued'};throw Error('read failed');});const b=await h.send();assert(b.disabled);assert.equal(h.state.c.job.id,'j');assert.equal(h.prompt.value,'');assert.equal(h.polls,1);assert.match(h.error.textContent,/任务已提交/);});

test('首次读取时任务已完成也恢复发送按钮',async()=>{
  const h=harness(async(path,method)=>method==='POST'?{id:'j',status:'queued'}:{id:'c',can_edit:true,messages:[],job:{id:'j',status:'completed'}});
  const button=await h.send();
  assert.equal(button.disabled,false);
  assert.equal(button.textContent,'发送并整理');
});
