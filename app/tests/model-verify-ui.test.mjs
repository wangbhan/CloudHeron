import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelFeature} from '../public/features/models/index.js';

test('video model verification keeps its reference and reuses a task key after an uncertain submission', async()=>{
  const fields = new Map();
  const field = name => {
    if(!fields.has(name))fields.set(name,{value:name==='#verify-kind'?'video':'',closest:()=>({hidden:false})});
    return fields.get(name);
  };
  const file={name:'reference.png',type:'image/png',size:50};
  let callback, posts=[],uploads=0;
  const model={id:'model',name:'model',spec:{capabilities:['video'],extra:{seconds:6,size:'832x480'}}};
  const ui={
    state:{models:[model],assets:[]},$:field,
    escape:String,head:()=>'',btn:()=>'',badge:()=>'',input:()=>'',select:()=>'',area:()=>'',
    modal:(_,html,handler)=>{callback=handler;assert.match(html,/verify-upload/);},
    api:async(path,method,body,options)=>{
      if(path==='chats')return{id:'chat'};
      if(path==='assets'){uploads++;return{id:'reference'};}
      posts.push({path,body,key:options.headers['Idempotency-Key']});
      if(posts.length===1)throw Error('uncertain response');
      return{id:'job'};
    },
    fileData:async()=> 'fixture-base64',
    loadCommon:async()=>{}, render:()=>{}, toast:()=>{},optionsProjects:()=>[['p','project']],goto:()=>{},
  };
  createModelFeature(ui).verify('model');
  assert.equal(field('#verify-seconds').value,6);
  assert.equal(field('#verify-size').value,'832x480');
  const values={'verify-kind':'video','verify-project':'p','verify-prompt':'test',
                'verify-seconds':'6','verify-size':'832x480','verify-reference':''};
  const form={querySelector:()=>({files:[file]})};
  await assert.rejects(callback(values,form),/uncertain/);
  await callback(values,form);
  assert.equal(uploads,1);
  assert.equal(posts[0].key,posts[1].key);
  assert.deepEqual(posts[1].body.config.asset_ids,['reference']);
  assert.equal(posts[1].body.config.seconds,6);
});
