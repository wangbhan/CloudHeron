# 云鹭开发实现架构

文档编号：DOC-DES-006  
版本：v0.1.0  
日期：2026-10-01  
来源：RAW-011，已确认界面 v0.3.2

用户授权进入开发。以下为第一版本的实现默认值，尚未回答的需求问题继续保留，不视作用户逐项确认。

## 部署形态与存储

Node.js 24 原生 HTTP 服务，同源提供静态前端和 JSON API。使用 node:sqlite 的 SQLite WAL 持久化，媒体保存在本机 data/media。没有第三方运行依赖。当前单进程、单团队；默认仅监听 127.0.0.1:8800。生产多实例队列、对象存储、数据库迁移与公网部署留到上线方案确认后处理。

业务独立表为 users、sessions、projects、workflows、chats、assets、models、skills、proposals、publications、jobs、meta。项目统筹编号仍以现有 Excel 分表为主，业务数据库不替代需求管理主表。

## 权限默认值（REQ-001 / 004 / 016 / 017）

首次使用创建管理员与团队，无预置密码。邮箱密码登录，密码用 scrypt 保存。会话为随机令牌，数据库只存摘要，HttpOnly + SameSite Cookie；HTTPS 部署设置 COOKIE_SECURE=1。成员由管理员生成七天有效、仅使用一次的邀请链接并自行分享；邮件发送和自助邮件找回留待配置邮件服务。管理员可重置密码与停用账号，最后一个有效管理员受到保护。

管理员管理所有资源。编辑者可创建资源并在授权项目内编辑、运行。查看者只读，其团队角色限制优先于项目编辑授权。项目选择团队共享或指定成员 read/edit 授权。项目资产继承项目权限；独立资产选择团队共享或仅创建者可见。模型供团队使用，只有管理员配置并管理凭据。按模型单独指定成员使用范围留待需求细化。

## 两条创作路径（REQ-005 至 014）

工作流 JSON 使用 schema_version 1.0、name、nodes、edges。节点依次支持提示词输入、参考资产、提示词 Agent、图片生成、视频生成、产物输出；按依赖排序执行，禁止循环与类型错误连线。保存使用 revision 乐观锁。

工作流 AI 仅分析或返回完整修改提案；提案包含 base_revision，展示前后 JSON，一次确认批次。确认接口只更新工作流，从不创建 job。用户显式运行才进入队列。每次运行固定 JSON 快照；两个任务并发，每账号最多十个待完成任务，失败记录节点并停止后续步骤。重启将中断任务标记失败，由用户检查后显式重试，避免重复计费。

对话内点击发送并生成就调用所选 Agent。提示词 Agent 调用文本模型；图片、视频 Agent 可选文本模型结合历史整理提示词，再调用任务模型。不选择文本模型时直接拼接历史描述。对话保留用户请求、实际配置、回复和产物。

Skill 第一版为声明式提示词模板，必须含 {{prompt}}，管理员新增与编辑，任务调用时应用。任意代码插件和自定义 Agent 安装留待扩展规范。

## 模型与媒体（REQ-015 / 018 / 019 / 028）

协议支持 OpenAI、vLLM、vLLM-Omni、SGLang 风格，能力另行配置 text/image/image_edit/video。文本使用 Chat Completions，图片使用 Images JSON 或 multipart，参考图使用编辑接口，视频使用 multipart 异步 jobs 创建、轮询与下载。管理员可配置相对路径与额外参数。兼容性指相应接口契约，实际任务支持仍取决于模型部署。

服务端使用 AES-256-GCM 保存 API 密钥，加密主密钥独立存在 data/vault.key，不发给浏览器。禁止跨域重定向携带凭据，错误隐藏密钥。媒体验证 MIME 与文件签名；上传上限 20 MB，上游生成下载上限 100 MB。参考资产使用固定编号版本。复用参考与随机种子有助于减少差异，未实现自动剧情检查或人物外观保证。

## API（REQ-021）

发布时保存不可变 JSON 快照及版本，生成独立调用密钥，数据库只存密钥摘要。第一版输入 prompt 文本，202 返回任务编号，通过带同一 Bearer 凭据的查询与下载接口取产物。多次提交用于批量生产。撤销接口使凭据立即失效；草稿更新不影响发布版本。快照固定工作流 JSON 与引用资产编号，执行时仍按 model_id 读取当前模型配置与凭据，模型管理页调整服务配置会影响后续调用。更复杂输入输出 schema、定额与外部回调留待细化。

## 界面与可追踪性

沿用 v0.3.2 云鹭品牌与深浅主题，工作流内显示当前任务错误。项目根据 chat/workflow 稳定编号返回来源页面，刷新恢复。保留已废止 DES-009/010 记录；产品没有分镜剪辑、独立一致性检查或运行历史导航。

当前开发范围、默认值与限制对应 DEV-001 至 DEV-012，详见 DOC-DEV-002。正式测试与上线在后续阶段另行登记。

接口依据：

- [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/)
- [SGLang Chat Completions](https://docs.sglang.io/docs/basic_usage/openai_api_completions)
- [OpenAI Images API](https://developers.openai.com/api/reference/resources/images)
- [vLLM-Omni Videos API](https://docs.vllm.ai/projects/vllm-omni/en/latest/serving/videos_api/)

截至 2026-10-01，OpenAI 官方 Videos 页面标记旧 Sora API 已停用，因此视频默认建议接入实际可用的 vLLM-Omni 或相同契约服务，不预配置不可用的平台视频模型。[官方历史页](https://developers.openai.com/api/reference/resources/videos/methods/create)
