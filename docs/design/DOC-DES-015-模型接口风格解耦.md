# DOC-DES-015 模型接口风格解耦

2026-11-01；REQ-048 / DES-038。基于已确认的DES-035～037，先落地模型领域边界。

## 数据合同

沿用models及JSONB spec，无表结构迁移；provider是任意厂商标签，interface_style是版本化接口合同ID，model是自由字符串。框架protocol为历史兼容字段，不作为模型名来源。配置名称name供团队识别。一个风格可配置多个独立模型连接；新连接推荐按任务分别创建。

| 风格ID | 任务能力 | 合同 |
| --- | --- | --- |
| openai | 文本、图片、视频及已有参考能力 | Chat Completions / Images / videos |
| anthropic | 文本 | Messages / x-api-key / 版本头 |
| vllm_omni | 文本、图片、视频及参考 | 视频multipart /videos，扩展参数extra_params |
| minimax | 文本、图片、参考图、视频V1 | 文本兼容格式；原生image_generation；视频task_id→file_id→下载 |
| minimax_v2 | 视频、参考视频 | V2 content数组，task.status与content.url |
| legacy | 历史能力 | 完整保留旧protocol/格式/路径 |

模型ID没有枚举或前缀限制，不从列表自动替换。能力仅表示配置意图，不保证任意模型都能运行。高级paths和extra保留，原凭据继续服务端加密；普通成员仅获取脱敏描述。接口目录GET /api/model-styles由登录用户读取，写配置与连接测试仅admin。

## 模块和页面

backend/cloudheron/models目录承载风格目录、模型路由、MiniMax媒体适配；domain.model_spec统一规范化，Provider按合同分发。前端features/models为独立ES模块，提供分类、搜索、创建/编辑、能力与风格约束、持久连接结果及主题样式。此批没有把其余页面改成Vue，DEV-030/031整体迁移仍待后续实施。

MiniMax V1根地址通常含/v1，V2为主机根地址；文本Claude兼容须填写对应Messages根地址。风格切换不自动改地址或高级路径。V1参考视频入口仅一张首帧图；V2当前提供reference_image/reference_video模式。首尾帧角色编辑后续单列。通用size映射图片width/height或视频resolution，seconds映射duration，b64_json映射base64；高级原生resolution可显式配置。不按模型名硬编码限制，实际上游不支持参数时返回真实错误。

工作流与对话共用Provider，继续引用model_id，无需改工作流schema或既有项目ID。额外参数禁止覆盖content、subject_reference、first_frame_image和duration等受控输入。HTTP 200中的base_resp错误也被识别并脱敏，未知异步状态停止并显示任务ID，不自动重新提交。

## 官方合同依据

依据[MiniMax图片接口](https://platform.minimax.io/docs/api-reference/image-generation-t2i)、[参考图片](https://platform.minimax.io/docs/api-reference/image-generation-i2i)、[V1视频提交](https://platform.minimax.io/docs/api-reference/video-generation-t2v)、[V1状态](https://platform.minimax.io/docs/api-reference/video-generation-query)、[文件查询](https://platform.minimax.io/docs/api-reference/file-management-retrieve)、[V2提交](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)、[V2查询](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)。2026-11-01读取官方文档；测试使用本机合同夹具，尚未调用真实MiniMax账号。
