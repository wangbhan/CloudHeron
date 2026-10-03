import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeApiOptions,requestOptions} from '../lib/api-options.mjs';
import {validateModel} from '../lib/provider.mjs';
import {normalizeChatConfig} from '../lib/agents.mjs';
import {template,validateWorkflow} from '../lib/workflow.mjs';

test('任务参数保留零和 JSON 类型、覆盖模型默认值并省略空值',()=>{
  const spec={extra:{temperature:1,custom_flag:false,model:'bad',prompt:'bad'}};
  const opts=requestOptions('text',{temperature:0,top_p:0,max_tokens:64,stop:['END'],api_params:{custom_flag:true,custom_config:{enabled:false,weights:[0,0.5]}}},spec);
  assert.equal(opts.temperature,0);assert.equal(opts.custom_flag,true);assert.deepEqual(opts.custom_config.weights,[0,0.5]);assert.deepEqual(opts.stop,['END']);
  assert.deepEqual(normalizeApiOptions('image',{n:'',quality:'',api_params:{}}),{});
  const models=()=>({spec:JSON.stringify({capabilities:['image','video','text']})});
  const prompt=normalizeChatConfig({agent:'prompt',model_id:'m',temperature:0,seed:0,seconds:4,n:3,asset_ids:['ignored'],size:'unused'},{getModel:models,getSkill:()=>true,getExpert:()=>null});
  assert.equal(prompt.temperature,0);assert.equal(prompt.seed,0);assert.equal('seconds' in prompt,false);assert.equal('n' in prompt,false);assert.equal('size' in prompt,false);assert.deepEqual(prompt.asset_ids,[]);
  const image=normalizeChatConfig({agent:'image',model_id:'m',n:2,temperature:1,seconds:4},{getModel:models,getSkill:()=>true,getExpert:()=>null});assert.equal(image.n,2);assert.equal('temperature'in image,false);assert.equal('seconds'in image,false);
});

test('非法数值、JSON、字段覆盖与自定义参考冲突在发请求前被拒绝',()=>{
  for(const [kind,raw]of [['image',{n:5}],['image',{n:1.5}],['image',{quality:'unsupported'}],['image',{output_compression:101}],['video',{fps:0}],['text',{temperature:-1}],['text',{temperature:null}],['text',{top_p:2}],['text',{max_tokens:0}],['text',{stop:['']}],['text',{api_params:[]}],['image',{api_params:{n:100}}],['video',{api_params:{prompt:'override'}}],['text',{api_params:{stream:true}}],['image',{api_params:JSON.parse('{"__proto__":{"x":1}}')}],['text',{api_params:{nested:JSON.parse('{"constructor":{}}')}}],['image',{api_params:{foo:'x'.repeat(16000)}}]])assert.throws(()=>normalizeApiOptions(kind,raw));
  assert.throws(()=>normalizeApiOptions('video',{api_params:{source_clip:'bad'}},{referenceFields:['source_clip']}),/受控字段/);
  const spec={base_url:'http://127.0.0.1:9/v1',model:'fixture',protocol:'OpenAI',capabilities:['video'],reference_fields:{image:'input_reference',video:'video_reference'}};assert.doesNotThrow(()=>validateModel(spec));assert.throws(()=>validateModel({...spec,reference_fields:{image:'temperature'}}),/参考字段/);
  const doc=template();doc.nodes[1].params.n=5;assert.throws(()=>validateWorkflow(doc),/图片数量/);
});

test('旧工作流与未填选项保持兼容，额外参数不会改变原对象',()=>{
  const doc=template();assert.doesNotThrow(()=>validateWorkflow(doc));const original={fps:24,api_params:{vendor:{flags:[true,false],level:0},watermark:false}};
  const clean=normalizeApiOptions('video',original);clean.api_params.vendor.level=2;assert.equal(original.api_params.vendor.level,0);
  assert.deepEqual(normalizeApiOptions('text',{}),{});assert.deepEqual(normalizeApiOptions('image',{}),{});
});
