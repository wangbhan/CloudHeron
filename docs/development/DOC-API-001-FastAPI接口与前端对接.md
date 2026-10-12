# DOC-API-001 FastAPI 接口与前端对接

版本：v0.2.0；日期：2026-10-12。关联 REQ-040/041/042、DES-029/030/031、DEV-023/024/025、TST-037～042。63 个操作、51 个路径。完整机器契约 [backend/openapi.json](../../backend/openapi.json)；运行时 Swagger `http://127.0.0.1:8802/docs`，ReDoc `/redoc`。下表请求类型和响应类型对应 OpenAPI components/schemas，可导入 Apifox、Postman 或生成 TypeScript 类型。

## 前端调用约定

默认同源相对 `/api`，JSON 请求 `Content-Type: application/json`。写请求（POST/PUT/PATCH）带 `X-CloudHeron: 1`；第三方 `/api/v1` 使用 Bearer，无需此头。Cookie `cloudheron` 是 HttpOnly、SameSite=Strict、7 天；前端不要将其复制到 localStorage。登录后 `credentials: 'include'`，401 转登录，403 显示权限错误。管理员管理用户/模型/Skill/专家；编辑者只能修改获得 edit 权限的项目；查看者只读。私有未授权内容不出现在列表中。

接口沿用原前端字段和标识符。GET 工作流详情/对话详情含 `can_edit` 与最近 `job`；更新工作流等部分响应省略未设置的 `can_edit/job`，前端合并对象时保留已有字段，不把缺失字段转为 null 覆盖编辑权限。列表对话不返回 messages，选中后 GET 详情。项目 contents 的 `source=chat|workflow` 决定跳至 `#create/{id}` 或 `#workflow/{id}`。日期为 ISO 8601，数据库为 timestamptz。

```js
async function api(path, method='GET', body, requestKey) {
  const headers = {'Content-Type':'application/json'};
  if (method !== 'GET') headers['X-CloudHeron'] = '1';
  if (requestKey) headers['Idempotency-Key'] = requestKey;
  const response = await fetch('/api/'+path, {
    method, credentials:'include', headers,
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error), {status:response.status});
  return value;
}
```

## 登录、配置和创作顺序

1. GET bootstrap；仅空库 POST setup `{team,name,email,password}`，已有库 POST login `{email,password}`；密码 10～200 字符。GET me 恢复会话。邀请由 POST users 返回 `invite_path`，接收者 POST join `{token,password}`，没有邮件自动发送。
2. GET projects、models、assets、agents、skills、experts、task-options、workflow-templates 初始化界面。模型 API key 只写入，返回 `has_key`；PUT models 省略 api_key 保留旧值，空字符串清除它。查看者模型 spec 脱敏。
3. 工作流 POST workflows `{project_id,name,document}`；document 可省略使用图片模板。保存 PUT `{revision,document}`，revision 用最后读取的版本；冲突为 409，重新加载后让用户决定。JSON 导入先 POST workflows/validate `{project_id,document}`，再保存；导出使用 GET 详情的 document。工作流结构详见历史 [JSON 契约](DOC-DEV-003-接口与工作流契约.md)。
4. AI POST workflows/{id}/assist `{mode:'analyze'|'modify',model_id,prompt,params}`。分析只返回 analysis；修改返回 `{id,base_revision,explanation,before,after}`。显示预览，用户确认一次后 POST proposals/{id}/confirm `{}`，再更新工作流；取消保持原样。提案有效期 1 小时，重复确认/过期/版本冲突为 409；这些操作不排队生成。
5. 手动运行 POST workflows/{id}/run `{revision}` 返回 202 JobOut；轮询 GET jobs/{id} 直至 completed/failed。`steps[node_id].status/error` 定位节点；outputs 是资产 ID 列表。失败不自动重试。
6. 对话 POST chats `{project_id,title}`；POST chats/{id}/messages `{prompt,config}` 返回 202。GET chats/{id} 恢复 messages、每次发送的 config 和 job；保留各 Agent 独立草稿，最后消息配置用于刷新恢复。当前对话有活跃任务时返回 409。

模型写入示例（只表示协议配置，生成能力由实际上游支持）：

```json
{"name":"图像模型","api_key":"REPLACE_API_KEY","enabled":true,"spec":{"protocol":"OpenAI","base_url":"https://MODEL_HOST/v1","model":"MODEL_NAME","capabilities":["image","image_edit"],"paths":{"image":"/images/generations","edit":"/images/edits"},"extra":{}}}
```

支持协议名 OpenAI/vLLM/vLLM-Omni/SGLang；capabilities 为 text/image/image_edit/video/video_reference。端点键的实际名称及默认路径由 provider.py 和管理页使用：文本 `text`，图片 `image`，编辑 `edit`，视频 `video`，视频状态 `video_status`，视频下载 `video_content`，列表 `models`。默认图片路径是 `/images/generations`。参考视频需 video_reference、配置 `video_format=json|multipart` 及 `reference_fields`，未填写使用管理页默认值。

图片对话例：

```json
{"prompt":"白鹭飞过云海","config":{"agent":"image","model_id":"MODEL_ID","size":"1024x1024","n":2,"quality":"high","seed":0,"asset_ids":[],"expert_id":"expert_image","skill_ids":[],"api_params":{"watermark":false}}}
```

`agent=image|video|prompt`。视频使用 seconds/fps 等，提示词使用 temperature/max_tokens/stop 等；前端从 `/api/task-options` 获取每类可选字段及范围。可选值为空应省略，0 和 false 保留；`api_params` 只接受独立自定义 JSON 对象，禁止覆盖 model/prompt/鉴权/参考字段。参数随节点 JSON 或历史 config 保存。`text_model_id` 与 `text_options` 专用于辅助理解，和生成模型参数独立。Skill 全部可选，专家为至少两个不同 Skill 的组合。

## 资产和对象存储

POST assets 上传 JSON `{project_id,name,kind,visibility,mime,filename,base64,description}`；base64 是文件内容，不含 data URL 前缀，解码上限 20 MiB，整个请求上限 32 MiB；服务端验证 MIME 和实际签名字节。新版本带 parent_id。返回 AssetOut.url 始终是受权限保护的 `/api/assets/{id}/media`；后端从桶取文件，支持 Range（206）和无效范围（416），不暴露桶凭据与对象键。

前端 `<img src=asset.url>` 和 `<video src=asset.url controls>` 同源携带会话。下载也可 POST assets/{id}/download-url `{}`，返回 `{url,expires_in:300}`。它是具备下载权限的短期签名地址，在有效期内持有链接的人可下载；不要长期缓存或作为历史资产 URL 保存。桶保持私有。

## 幂等和第三方 API

生成提交（工作流 run、对话 messages、第三方 runs）推荐带 `Idempotency-Key`，一个用户动作生成一个键，网络重试沿用该键。相同账号/入口/键/请求返回原 job，响应头 `Idempotency-Replayed:true`；同键改请求 409。权限和发布撤销仍先检查；每用户 pending 默认 10，超限为 429；重放不占新配额。已经失败的任务使用原键仍返回失败任务，明确重试需新键。

发布 POST publications `{workflow_id,name,version}` 返回 `{id,token,path,version}`，token 仅此时明文返回。它固定工作流 JSON，模型仍按当前 model_id 读取配置。PATCH publications/{id} `{}` 撤销。第三方 POST 返回 202，查询状态、读取产物始终带 Bearer：

```sh
# 先把自己的凭据赋给 TOKEN；ENDPOINT_ID 用发布结果的 id。
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-one-request-001' \
  -d '{"prompt":"白鹭飞过云海"}' \
  http://127.0.0.1:8802/api/v1/endpoints/ENDPOINT_ID/runs
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8802/api/v1/runs/JOB_ID
```

第三方 ApiJobOut.outputs 是 `{asset_id,url}` 数组，url 不是会话媒体 URL。下载请求携带同一 Bearer。发布者停用或失去项目编辑权限后调用拒绝。

## 手动接口验证

```sh
# 使用自己的有效账号；演示参数占位，Cookie 文件应只存在本机。
curl -c /tmp/cloudheron-cookie -H 'X-CloudHeron: 1' \
  -H 'Content-Type: application/json' \
  -d '{"email":"YOUR_EMAIL","password":"YOUR_PASSWORD"}' \
  http://127.0.0.1:8802/api/login
curl -b /tmp/cloudheron-cookie http://127.0.0.1:8802/api/projects
curl -b /tmp/cloudheron-cookie -H 'X-CloudHeron: 1' -X POST \
  http://127.0.0.1:8802/api/assets/ASSET_ID/download-url
```

## 错误与状态

错误统一 `{"error":"可展示说明"}`。400 业务/JSON 校验，401 登录或 Bearer 无效，403 权限或保护头，404 资源不存在，409 revision/幂等/并发对话冲突，413 过大，422 请求结构或上游格式，429 登录频率/排队配额，500 服务内部错误，502 对象存储读取失败，503 依赖未就绪。上游执行失败记录在 JobOut.error 和步骤中，HTTP 创建任务仍可能为 202；前端必须轮询终态，不能把 202 当作生成成功。

正常停机后 queued 保留、running 等待；进程异常后 running 标失败，不自动再次调用模型。首版单 API 进程，分页/分布式 Worker/WebSocket 尚未加入。独立前端部署优先同源反向代理；跨源配置明确 CORS_ORIGINS 并保证 Cookie 同站及 HTTPS。

## 接口目录（由 v0.2.0 OpenAPI 生成）

| 模块 | 方法与路径 | 鉴权 | JSON 请求类型 | 成功状态 / 响应类型 |
| --- | --- | --- | --- | --- |
| 运行管理 | `GET /api/health` | 公开 | — | 200 / HealthOut |
| 运行管理 | `GET /api/ready` | 公开 | — | 200 / HealthOut |
| 账号 | `GET /api/bootstrap` | 公开 | — | 200 / BootstrapOut |
| 账号 | `POST /api/setup` | 公开 | Setup | 201 / SessionOut |
| 账号 | `POST /api/login` | 公开 | Login | 200 / SessionOut |
| 账号 | `POST /api/join` | 公开 | Join | 200 / SessionOut |
| 账号 | `GET /api/me` | Cookie | — | 200 / MeOut |
| 账号 | `POST /api/logout` | Cookie | — | 200 / Ok |
| 账号 | `POST /api/password` | Cookie | ChangePassword | 200 / SessionOut |
| 成员 | `GET /api/users` | Cookie | — | 200 / list[UserOut] |
| 成员 | `POST /api/users` | Cookie | Invite | 201 / InvitationOut |
| 成员 | `PATCH /api/users/{user_id}` | Cookie | UpdateUser | 200 / UserOut |
| 项目 | `GET /api/projects` | Cookie | — | 200 / list[ProjectOut] |
| 项目 | `POST /api/projects` | Cookie | ProjectCreate | 201 / ProjectOut |
| 项目 | `PATCH /api/projects/{project_id}` | Cookie | ProjectUpdate | 200 / Ok |
| 项目 | `GET /api/projects/{project_id}/contents` | Cookie | — | 200 / list[object] |
| 测试 | `GET /api/projects/{project_id}/test-cases` | Cookie | — | 200 / list[object] |
| 模型 | `GET /api/models` | Cookie | — | 200 / list[ModelOut] |
| 模型 | `POST /api/models` | Cookie | ModelWrite | 201 / ModelOut |
| 模型 | `PUT /api/models/{model_id}` | Cookie | ModelWrite | 200 / ModelOut |
| 模型 | `POST /api/models/{model_id}/check` | Cookie | — | 200 / object |
| 能力 | `GET /api/task-options` | Cookie | — | 200 / object |
| 能力 | `GET /api/agents` | Cookie | — | 200 / list[AgentOut] |
| 能力 | `GET /api/skills` | Cookie | — | 200 / list[SkillOut] |
| 能力 | `POST /api/skills` | Cookie | SkillWrite | 201 / SkillOut |
| 能力 | `PUT /api/skills/{skill_id}` | Cookie | SkillWrite | 200 / SkillOut |
| 能力 | `GET /api/experts` | Cookie | — | 200 / list[ExpertOut] |
| 能力 | `POST /api/experts` | Cookie | ExpertWrite | 201 / ExpertOut |
| 能力 | `PUT /api/experts/{expert_id}` | Cookie | ExpertWrite | 200 / ExpertOut |
| 工作流模板 | `GET /api/workflow-templates` | Cookie | — | 200 / list[TemplateOut] |
| 工作流模板 | `POST /api/workflow-templates` | Cookie | TemplateSave | 201 / TemplateOut |
| 工作流模板 | `GET /api/workflow-templates/{template_id}` | Cookie | — | 200 / TemplateOut |
| 工作流模板 | `POST /api/workflow-templates/{template_id}/instantiate` | Cookie | TemplateInstantiate | 201 / WorkflowOut |
| 工作流 | `POST /api/workflows/validate` | Cookie | WorkflowValidate | 200 / Ok |
| 工作流 | `GET /api/workflows` | Cookie | — | 200 / list[WorkflowOut] |
| 工作流 | `POST /api/workflows` | Cookie | WorkflowCreate | 201 / WorkflowOut |
| 工作流 | `GET /api/workflows/{workflow_id}` | Cookie | — | 200 / WorkflowOut |
| 工作流 | `PUT /api/workflows/{workflow_id}` | Cookie | WorkflowSave | 200 / WorkflowOut |
| 工作流版本 | `GET /api/workflows/{workflow_id}/versions` | Cookie | — | 200 / list[object] |
| 工作流版本 | `GET /api/workflows/{workflow_id}/versions/{revision}` | Cookie | — | 200 / object |
| 工作流版本 | `POST /api/workflows/{workflow_id}/restore` | Cookie | Restore | 200 / WorkflowOut |
| 任务 | `POST /api/workflows/{workflow_id}/run` | Cookie | Revision | 202 / JobOut |
| 工作流 AI | `POST /api/workflows/{workflow_id}/assist` | Cookie | Assist | 200 / binary/union |
| 工作流 AI | `POST /api/proposals/{proposal_id}/confirm` | Cookie | — | 200 / WorkflowOut |
| 对话 | `GET /api/chats` | Cookie | — | 200 / list[ChatOut] |
| 对话 | `POST /api/chats` | Cookie | ChatCreate | 201 / ChatOut |
| 对话 | `GET /api/chats/{chat_id}` | Cookie | — | 200 / ChatOut |
| 对话 | `POST /api/chats/{chat_id}/messages` | Cookie | ChatMessage | 202 / JobOut |
| 资产 | `GET /api/assets` | Cookie | — | 200 / list[AssetOut] |
| 资产 | `POST /api/assets` | Cookie | AssetCreate | 201 / AssetOut |
| 资产 | `PATCH /api/assets/{asset_id}` | Cookie | AssetUpdate | 200 / Ok |
| 资产 | `GET /api/assets/{asset_id}/media` | Cookie | — | 200 / binary/union |
| 资产 | `POST /api/assets/{asset_id}/download-url` | Cookie | — | 200 / DownloadOut |
| 任务 | `GET /api/jobs/{job_id}` | Cookie | — | 200 / JobOut |
| 运行管理 | `GET /api/system/status` | Cookie | — | 200 / RuntimeOut |
| 发布 API | `GET /api/publications` | Cookie | — | 200 / list[PublicationOut] |
| 发布 API | `POST /api/publications` | Cookie | PublicationCreate | 201 / PublicationCreated |
| 发布 API | `PATCH /api/publications/{publication_id}` | Cookie | — | 200 / Ok |
| 第三方 API | `POST /api/v1/endpoints/{endpoint_id}/runs` | Bearer | ApiRun | 202 / JobOut |
| 第三方 API | `GET /api/v1/runs/{job_id}` | Bearer | — | 200 / ApiJobOut |
| 第三方 API | `GET /api/v1/runs/{job_id}/assets/{asset_id}` | Bearer | — | 200 / binary/union |
| 测试 | `GET /api/test-workspace` | Cookie | — | 200 / binary/union |
| 测试 | `POST /api/test-workspace` | Cookie | — | 200 / object |

实现源：backend/cloudheron/main.py、routes.py、schemas.py。更新路由后运行 `python scripts/export_openapi.py`；前端与后端以导出的字段定义和契约测试保持一致。
