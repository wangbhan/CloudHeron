import test from 'node:test';
import assert from 'node:assert/strict';
import {template,validateWorkflow,executeWorkflow} from '../lib/workflow.mjs';
import {permission,password,verify,vault} from '../lib/security.mjs';
import {randomBytes} from 'node:crypto';
test('工作流拒绝循环、重复编号和端口类型不匹配',()=>{
  const w=template();assert.equal(validateWorkflow(w).length,3);
  const duplicate=structuredClone(w);duplicate.nodes[1].id='prompt';assert.throws(()=>validateWorkflow(duplicate),/重复/);
  const cycle=structuredClone(w);cycle.nodes[0].type='prompt_agent';cycle.edges.push({source:'image',target:'prompt'});assert.throws(()=>validateWorkflow(cycle),/类型不匹配/);
  const loop=structuredClone(w);loop.nodes[0].type='prompt_agent';loop.nodes[1].type='prompt_agent';loop.nodes=loop.nodes.slice(0,2);loop.edges=[{source:'prompt',target:'image'},{source:'image',target:'prompt'}];assert.throws(()=>validateWorkflow(loop),/循环/);
  const self=structuredClone(w);self.edges.push({source:'image',target:'image'});assert.throws(()=>validateWorkflow(self),/自身/);
});
test('执行器使用连线提示词、传递真实引用并在失败节点停止',async()=>{
  const w=template();w.nodes[0].params.prompt='雨夜';const events=[];let called=0;
  const output=await executeWorkflow(w,{generate:async(kind,mid,prompt)=>{called++;assert.equal(prompt,'API 输入');return [{id:'fixture_image',mime:'image/png'}];},input:{prompt:'API 输入'},onStep:async(...args)=>events.push(args)});
  assert.equal(called,1);assert.equal(output[0].id,'fixture_image');assert.equal(events.at(-1)[1],'completed');
  events.length=0;await assert.rejects(executeWorkflow(w,{generate:async()=>{throw Error('上游失败');},onStep:async(...args)=>events.push(args)}),/上游失败/);
  assert.equal(events.at(-1)[0],'image');assert.equal(events.at(-1)[1],'failed');assert.equal(events.some(e=>e[0]==='output'),false);
});
test('查看者权限上限、密码与密钥往返',()=>{
  const r={owner_id:'editor',visibility:'private',acl:JSON.stringify({viewer:'edit'})};
  assert.equal(permission({id:'viewer',role:'viewer',active:1},r),true);assert.equal(permission({id:'viewer',role:'viewer',active:1},r,true),false);
  assert.equal(permission({id:'other',role:'editor',active:1},r),false);assert.equal(permission({id:'admin',role:'admin',active:0},r),false);
  const encoded=password('example-password-123');assert.equal(verify('example-password-123',encoded),true);assert.equal(verify('wrong',encoded),false);
  const v=vault(randomBytes(32)),cipher=v.encrypt('fixture-secret');assert.notEqual(cipher,'fixture-secret');assert.equal(v.decrypt(cipher),'fixture-secret');
});
