# 云鹭接口与工作流契约

文档编号：DOC-DEV-003  
版本：v0.1.4
日期：2026-10-01  
关联：DEV-007 / 008 / 009 / 010，REQ-006 / 009 / 010 / 021

## 工作流 JSON

完整配置可在工作流页查看、导入与导出。节点表示一次任务，不表示角色。

```json
{"schema_version":"1.0","name":"图片创作","nodes":[{"id":"prompt","type":"prompt_input","label":"提示词输入","params":{"prompt":"雨夜城门"},"position":{"x":40,"y":90}},{"id":"image","type":"image_generate","label":"图片生成","params":{"model_id":"MODEL_ID","size":"1024x1024"},"position":{"x":340,"y":90}},{"id":"output","type":"media_output","label":"产物输出","params":{},"position":{"x":640,"y":90}}],"edges":[{"source":"prompt","target":"image"},{"source":"image","target":"output"}]}
```

用实际模型编号替换 MODEL_ID。参考节点使用 params.asset_id；视频节点使用 model_id、seconds、size；生成节点可配置 skill_ids 与 seed。文字连线优先于节点自填提示词，API prompt 覆盖输入节点。节点最多 100、边最多 300，工作流禁止循环，输入类型在保存与运行时校验。

## 团队内部 API

浏览器与服务同源，登录使用会话 Cookie。修改请求必须带 X-CloudHeron: 1；有 Origin 时还检查同源。错误为 JSON {"error":"说明"}；权限错误 403，版本冲突 409，无账号会话 401，参数错误 400。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| /api/bootstrap | GET | 首次设置状态、团队名与节点类型 |
| /api/setup | POST | 仅首次创建团队与管理员 |
| /api/login, /api/logout | POST | 登录、退出 |
| /api/join | POST | 使用一次性邀请设置密码 |
| /api/me | GET | 当前用户与团队 |
| /api/password | POST | 修改自身密码，撤销旧会话 |
| /api/users | GET / POST | 成员列表、管理员邀请 |
| /api/users/{id} | PATCH | 角色、状态、密码重置 |
| /api/projects | GET / POST | 项目列表、创建 |
| /api/projects/{id} | PATCH | 名称、共享与 ACL |
| /api/projects/{id}/contents | GET | chat / workflow 来源内容 |
| /api/workflows | GET / POST | 列表、创建 |
| /api/workflows/validate | POST | 校验导入 JSON，不保存、不执行 |
| /api/workflows/{id} | GET / PUT | 当前 JSON、版本、最新任务；保存时提交 revision |
| /api/workflows/{id}/assist | POST | {mode:analyze或modify,model_id,prompt} |
| /api/proposals/{id}/confirm | POST | 一次批量确认，仅保存、不执行 |
| /api/workflows/{id}/run | POST | {revision} 显式执行 |
| /api/chats | GET / POST | 对话列表、创建 |
| /api/chats/{id} | GET | 历史、配置、最新任务 |
| /api/chats/{id}/messages | POST | {prompt,config:{agent,kind,model_id,text_model_id,asset_ids,skill_ids,size,seconds}} |
| /api/assets | GET / POST | 资产列表、base64 上传，可指定 parent_id 新版本 |
| /api/assets/{id} | PATCH | 名称、描述、独立资产可见范围 |
| /api/assets/{id}/media | GET | 权限保护的媒体，支持 bytes Range |
| /api/models | GET / POST | 模型列表、管理员新增 |
| /api/models/{id} | PUT | 配置模型与凭据；api_key 缺省保留 |
| /api/models/{id}/check | POST | /models 连接检查，不能替代生成检查 |
| /api/skills | GET / POST | Skill 列表、管理员扩展 |
| /api/skills/{id} | PUT | 管理员编辑模板 |
| /api/publications | GET / POST | 版本列表、发布固定工作流 |
| /api/publications/{id} | PATCH | 撤销调用凭据 |
| /api/jobs/{id} | GET | 当前执行状态、步骤、输出与错误 |

## 外部工作流 API

发布返回 id、version、path、token。token 只返回一次；一个 token 仅可调用一个发布版本，已撤销、发布者停用或失去编辑权限时失效。快照固定 JSON 与参考资产编号；模型配置及凭据按 model_id 使用执行时当前值。

```http
POST /api/v1/endpoints/ENDPOINT_ID/runs
Authorization: Bearer TOKEN
Content-Type: application/json

{"prompt":"生成雨夜城门图片"}
```

返回 202，JSON 中 id 为任务编号。GET /api/v1/runs/JOB_ID，携带相同 Bearer TOKEN，轮询 queued/running/completed/failed。完成时 outputs 返回 asset_id 与下载 url；下载同样携带 Bearer TOKEN。下载路径只能访问这个版本生成任务的最终输出，不访问其它资产。失败时 error 与 steps 给出定位。默认最多两任务并发，每账号十个待完成任务；没有自动计费重试。

## 模型配置契约

创建请求 {name,api_key,spec:{source,protocol,base_url,model,capabilities,format,paths,extra}}。base_url 通常含 /v1。text 使用 /chat/completions；image 使用 /images/generations；image_edit 使用 /images/edits；video 创建 /videos、查询 /videos/{id}、下载 /videos/{id}/content。paths 可以覆盖 text、image、edit、video、video_status、video_content、models。

文本响应要求 choices[0].message.content。图片响应要求 data[].b64_json 或 data[].url。视频响应可用 data[].url/b64_json，或标准异步 id/status，完成状态 completed，错误 failed。视频请求 multipart，参考图通过 input_reference 文件；图像编辑通过 image 或 image[]。额外参数按部署文档填写，任务参数优先于 extra 的 prompt/model/size/seconds。

当前不实现非兼容服务的任意字段映射、原始二进制同步视频、自定义 Webhook 和 SDK 包。单项模型任务请求超时三分钟，视频任务轮询上限三十分钟，超过时保留实际失败提示。

## v0.1.1 能力与手动测试接口

关联 DEV-013 / 014 / 015，REQ-033 / 034 / 035。

| 路径 | 方法 | 用途 |
| --- | --- | --- |
| /api/agents | GET | 三个内置 Agent 的任务能力、配置字段与默认值 |
| /api/experts | GET / POST | 专家列表、管理员新增至少两个 Skill 的组合 |
| /api/experts/{id} | PUT | 管理员修改任务、名称与有序 skill_ids |
| /api/test-workspace | GET / POST | 当前账号测试样例；编辑者或管理员幂等载入 |

Skill task 新增 prompt，all 适用于全部 Agent。专家 task 为 image、video、prompt 或 all，skill_ids 为 2–20 个不同且任务兼容的编号，按数组顺序应用。对话 config 可携带 expert_id 和附加 skill_ids；服务端展开、合并、去重，保存 expert_snapshot 和 additional_skill_ids。图片不保留 seconds；提示词 Agent 不保留参考、分辨率、时长或辅助模型参数。视频 seconds 为 1–120；模型能力必须匹配 Agent。

/test-cases.json 提供20条手动用例；应用内填写结果保存在当前浏览器，导出为JSON，与Excel手动登记分开。测试项目不调用模型。

## v0.1.3 参考与 Skill 修订

参考资产节点的输出类型为 reference，可连接图片、视频生成和产物输出。视频生成也接受视频生成节点的 video 输出作为参考。资产 MIME 决定实际类型；图片生成遇视频输入时明确报错。视频文件输入需要 video_reference 能力，具体模型字段见 app/README.md。Skill 任务标签不限制选择，后台校验编号存在、最多 20 项及专家组合去重。

## v0.1.4 模板和历史接口

关联 DEV-018/019，REQ-006/007/009/010。模板和历史 JSON 均继承来源项目读取权限；创建副本还要求目标项目编辑权限。

| 路径 | 方法 | 输入和结果 |
| --- | --- | --- |
| /api/workflow-templates | GET | 内置及授权项目模板元数据，不返回完整 JSON |
| /api/workflow-templates | POST | {workflow_id,revision,name,description?}，固定已保存工作流快照 |
| /api/workflow-templates/{id} | GET | 授权模板详情及 JSON |
| /api/workflow-templates/{id}/instantiate | POST | {project_id,name,revision,keep_bindings?}，201 独立工作流 |
| /api/workflows/{id}/versions | GET | 按 revision 降序的时间、操作者、来源及恢复源 |
| /api/workflows/{id}/versions/{revision} | GET | 历史固定 JSON |
| /api/workflows/{id}/restore | POST | {revision,source_revision}，保存成新 revision |

keep_bindings 默认 false，清空 model_id/asset_id；true 时重新验证引用。revision 表示客户端看到的当前版本，冲突返回 409。保存、复用、恢复均不创建生成任务。恢复不覆盖原历史或发布快照。升级时仅登记已有工作流当前 revision，actor_id 为空、action 为 baseline。后续来源为 create、save、ai_modify、template、restore；恢复带 source_revision。
