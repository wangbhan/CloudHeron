import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentFeature} from '../public/features/documents.js';

function fixture(status='parsed', selected='doc') {
  const state={c:{id:'chat',messages:[],can_edit:true},chatDocumentIds:{chat:selected}};
  const host={innerHTML:''};
  const feature=createDocumentFeature({
    state,$:selector=>selector==='#chat-document'?host:null,
    api:async()=>[{id:'doc',chat_id:'chat',filename:'story.docx',status,
      content:{sections:[{label:'段落 1',text:'云海'}],images:[],warnings:[]},selected_asset_ids:[]}],
    btn:()=>'',select:()=>'',area:()=>'',escape:String,preview:()=>'',toast:()=>{},
  });
  feature.bind();
  return {state,feature,loaded:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('选中文档在解析结果加载前及确认前阻止发送',async()=>{
  const f=fixture();
  assert.throws(()=>f.feature.validate(),/先分析并确认/);
  await f.loaded();
  assert.throws(()=>f.feature.validate(),/先分析并确认/);
});
test('已确认文档允许发送，切换对话不会复用其他对话的选择',async()=>{
  const f=fixture('confirmed');
  await f.loaded();
  assert.doesNotThrow(()=>f.feature.validate());
  f.state.c={id:'other',messages:[],can_edit:true};
  f.feature.bind();
  assert.doesNotThrow(()=>f.feature.validate());
  assert.equal(f.state.chatDocumentIds.other,'');
});
test('选择不使用文档后允许普通创作',async()=>{
  const f=fixture('parsed','');
  await f.loaded();
  assert.doesNotThrow(()=>f.feature.validate());
});
