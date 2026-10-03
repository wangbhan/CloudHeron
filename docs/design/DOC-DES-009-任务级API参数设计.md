# 任务级 API 参数设计

文档编号：DOC-DES-009  
版本：v0.1.5  
来源：RAW-016；关联 REQ-038/006/015/033

## DES-026 任务配置与请求传递

开发 DEV-020；手动测试 TST-028 至 TST-032。

生成节点参数面板、三个 Agent 右侧配置增加折叠的 API 可选参数。字段由统一 schema 定义，按任务选择；空白代表不发送。媒体任务保持已有分辨率、时长及种子；理解对话可独立设置文本参数。工作流 AI 助手亦可设置文本选项，仍只分析或单次确认修改。

| 任务 | 可选配置 |
| --- | --- |
| 图片 | 数量 n（1–4）、质量 quality、风格 style、背景 background、输出 output_format、压缩 output_compression、返回 response_format、负向提示词 negative_prompt、引导 guidance_scale、步数 num_inference_steps |
| 视频 | 帧率 fps、宽高比 aspect_ratio、负向提示词、引导、步数 |
| 文本 | temperature、top_p、top_k、max_tokens、presence_penalty、frequency_penalty、repetition_penalty、seed、stop |
| 所有任务 | api_params JSON 对象（嵌套对象/数组可用，最多 16 KB） |

上述字段并不代表所有协议部署均支持；使用模型实际支持的配置，不支持时显示真实上游错误。平台校验数值范围和枚举；额外 JSON 不允许覆盖平台输入、模型、鉴权、参考字段或已提供的标准配置字段。自定义参考字段同样受到保护。

请求优先级：模型全局 extra → 任务 api_params → 显式任务参数 → 平台 model/prompt/messages/stream/参考文件。JSON 保留原类型；multipart 标量转字符串，嵌套对象/数组编码为 JSON。文本流式仍关闭，以符合现有响应处理。

## 保存与验证

节点参数完整留在工作流 JSON、版本、模板和发布快照中。对话按 Agent 缓存独立参数；历史刷新恢复最后发送的配置。选项校验在创建任务前完成，非法配置不写入历史、不调用模型。隐藏的不相关字段不进入该 Agent 任务。

验证实际 HTTP 接收 JSON/multipart、参考媒体及多图保存；覆盖对话、节点、AI 助手、附加理解文本、覆盖优先级、零/空白、非法 JSON/范围/覆盖、上游错误及历史恢复。新增手动用例同步到应用、独立数据库表和 Excel。上线阶段更新本机开发服务，生产发布待执行。
