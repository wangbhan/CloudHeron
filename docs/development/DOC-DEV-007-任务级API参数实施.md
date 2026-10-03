# 配置并验证任务级 API 参数

文档编号：DOC-DEV-007  
版本：v0.1.5；日期：2026-10-03  
开发：DEV-020；设计：DES-026；需求：REQ-038/006/015/033  
状态：开发验证完成；手动验收待执行

## 在任务中使用

工作流选择生成/提示词 Agent 节点，在参数栏展开“API 可选参数”，填写后应用并保存。对话右侧按 Agent 展示对应选项；理解对话的文本模型另有独立文本选项。AI 助手也可设置文本参数，分析与修改仍不自动运行生成流程。

| 任务 | 参数与平台范围 |
| --- | --- |
| 图片 | n:1–4；quality:auto/standard/hd/low/medium/high；style:vivid/natural；background:auto/opaque/transparent；output_format:png/jpeg/webp；output_compression:0–100；response_format:b64_json/url |
| 图片、视频 | negative_prompt:最多4000字；guidance_scale:0–50；num_inference_steps:1–200整数 |
| 视频 | fps:1–120整数；aspect_ratio:最多40字；时长、分辨率和种子沿用已有配置 |
| 文本 | temperature:0–2；top_p:0–1；top_k:1–1000整数；max_tokens:1–131072整数；presence_penalty/frequency_penalty:-2–2；repetition_penalty:0.01–10；seed:安全整数；stop:1–4个非空字符串，各最多200字 |
| 全部 | api_params:最多16000字符的 JSON 对象，嵌套最多8层；JSON 标量、对象、数组支持 |

留空表示省略。0、false 不会因空值判断丢失。列表说明平台校验范围，模型的实际支持范围可能更窄；按所接服务选择参数，不能用协议名推断所有选项均支持。额外 JSON 可传 scheduler、sampler、enable_* 等部署专用字段；标准字段请用对应控件，model/prompt/messages/stream/鉴权/参考字段禁止覆盖。文本流式固定关闭。

节点 params 示例（须选择实际图片模型）：

```json
{"model_id":"MODEL_ID","size":"1024x1024","n":2,"quality":"high","negative_prompt":"模糊","num_inference_steps":20,"api_params":{"watermark":false,"scheduler":"euler"}}
```

仅在模型支持 watermark/scheduler 时使用该示例。对话 config 图片/视频使用相同直接字段。提示词 Agent 的 config 可携带 temperature/max_tokens/stop 等文本字段；媒体 Agent 的辅助文本字段放入 text_options。assist 请求为 {mode,model_id,prompt,params:{temperature:0,max_tokens:100}}。

## 请求和保存规则

优先级：模型 spec.extra → 任务 api_params → 显式任务参数 → 平台输入及参考文件。JSON 中数字、布尔值与嵌套结构保持原类型；multipart 中标量为字符串、对象数组为 JSON 字符串，参考仍是实际文件。视频 seconds 维持原有字符串约定。

节点配置随 JSON、版本、模板与 API 发布快照保留。对话按 Agent 缓存草稿，历史恢复最后发送配置。错误 JSON 不局部覆盖节点参数；服务端拒绝非法值，未创建生成任务或对话消息。上游实际不支持参数时显示 HTTP 错误，不预填产物。

## 实现与验证

app/lib/api-options.mjs 定义共享 schema、校验及请求合并；agents.mjs 和 workflow.mjs 在任务入口校验；provider.mjs 传递 JSON/multipart；server.mjs 将文本参数分别送入节点、提示词对话、辅助文本及 AI 助手；app.js 提供字段、JSON 输入、独立草稿和刷新恢复。

38 项自动检查通过。新增真实 HTTP 断言覆盖对话/节点/API 快照/助手请求、多图入库、引用字节、覆盖优先级、数值和类型、非法配置零副作用及 HTTP 422 错误。证据与页面实操见 DOC-TST-005；五条新手动用例登记 TST-028 至 TST-032，原人工结果保留。本机更新供复测，正式生产上线待执行。
