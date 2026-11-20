# DOC-DEV-021 PDF 与 Word 图文创作

2026-11-20 · RAW-032 / REQ-060 / DES-050 / DEV-044 / TST-071、072 / REL-016

## 1. 需求 · REQ-060

用户确认首批支持 PDF 和 Word .docx。上传后读取文档文字及图片，经 AI 联合理解、用户确认后，用于图片或视频片段生成。文档归属当前对话及项目，权限沿用项目权限。

当前交付在「对话创作」入口；集成创作与工作流的直接文档输入节点尚未接入。单文件最多 20 MB、60000 字；PDF 为 1–12 页，Word 最多 12 张内嵌图。Word 图表、复杂绘图、页眉页脚和精细排版建议导出 PDF。

验收条件：能预览提取文字及图片；扫描 PDF 可通过页面图像交给视觉模型；摘要可编辑、生成参考图可选；未确认时阻止发送；确认本身不生成媒体；分析失败可手动重试；确认后的文字及参考图确实传入图片和视频接口。

## 2. 设计 · DES-050

对话输入框通过「+」菜单选择「上传 PDF」或「上传 Word」。解析本身不调用模型。PDF 使用 PDFium 提取页面文字并将每页渲染成 JPEG；扫描 PDF 的文字层可能为空，仍保留页面图像。Word 从 OOXML 提取正文、表格段落及对应内嵌图片关系，图片统一为 JPEG，长边最多 1400 像素。

「AI 理解图文」把全部提取文字及页面或内嵌图片交给用户选择的文本模型。接口支持 OpenAI Chat Completions、Responses 和 Anthropic Messages 的多模态内容块。所选模型须实际支持图片输入；平台不会通过模型名称推断视觉能力。

成功后显示可编辑创作摘要。用户勾选后续生成参考图，最多 8 张，vLLM-Omni 视频每次 1 张。点击「确认用于创作」仅保存摘要与选择。点击对话「发送并生成」后才生成媒体，也可选择「不使用文档」继续普通创作。

状态为 parsed → analyzing → analyzed → confirmed。分析终态及错误来自持久化任务。失败后由用户再次点击分析。确认以 job_id 校验当前结果，阻止陈旧确认。分析通过 Idempotency-Key 去重，异常时查询原任务，不自动重试生成请求。

## 3. 开发 · DEV-044

新增 PostgreSQL 迁移 005_documents.sql 与 documents 表，保存项目、对话、原文件私有存储键、正文和图片资产 ID、任务、摘要、确认状态。原文与图片保存在现有私有 S3 兼容存储中。确认摘要及所选资产 ID 在每次对话任务中保存快照，后续重分析不会改写已有任务。

PDF 解析置于独立子进程，45 秒超时；Word ZIP 限 2000 项与 80 MB 展开体积，拒绝加密内容及 XML 实体声明。损坏、超限、格式不匹配的文档给出错误。数据库登记失败时回滚并清理本次新上传对象。图文模型请求在数据库连接释放后执行。

源文件：backend/cloudheron/document_parser.py、documents.py、provider.py、worker.py；界面：app/public/features/documents.js。同步修复快速生成在首次状态读取前已完成时发送按钮未恢复的问题。

### 接口对接

所有写请求需要登录 Cookie、X-CloudHeron: 1 及项目编辑权限。只读请求需要项目查看权限。

| 方法及路径 | 输入 | 成功结果 |
| --- | --- | --- |
| POST /api/chats/{chat_id}/documents | filename、base64 | 201，解析文档、sections、images 和 warnings |
| GET /api/chats/{chat_id}/documents | 无 | 当前对话文档列表及各自最新分析任务 |
| GET /api/documents/{document_id} | 无 | 文档详情，原私有存储键不返回 |
| POST /api/documents/{document_id}/analyze | model_id、可选 params；建议 Idempotency-Key | 202，异步 JobOut |
| POST /api/documents/{document_id}/confirm | job_id、summary、asset_ids | 200，confirmed 文档 |
| POST /api/chats/{chat_id}/messages | prompt、config 中可选 document_id | 202，沿用对话生成任务 |

分析示例：
```json
{"model_id":"model_id_from_models","params":{"temperature":0.2}}
```

确认示例中 job_id、asset_ids 使用文档详情里的实际编号：
```json
{"job_id":"job_id_from_document","summary":"白鹭飞过蓝色云海，保持白色长袍。","asset_ids":[]}
```

错误：401 未登录，403 权限不足，400 文档或参考配置有误，413 超过 20 MB，422 请求字段不匹配，409 分析任务冲突或确认已过期。模型故障体现在任务 failed/error 中。生成时 document_id 必须属于当前对话且已确认。API 契约见 backend/openapi.json，66 路径、82 操作。

## 4. 测试 · TST-071 / TST-072

自动回归：101 项 Python、63 项 Node；覆盖 DOCX 正文和表格、内嵌图、扫描 PDF、格式校验、三种多模态协议、未确认禁止发送、确认冲突、权限限制、跨对话引用、幂等分析、失败后手动重试，以及摘要和图片进入图片/视频生成请求。

隔离 Docker 环境 cloudheron-document-qa 使用独立 PG、对象存储与测试账号。浏览器验证 Word 上传、摘要编辑、勾选图片、发送图片生成；上游记录收到正文和 1 张图，生成接口收到确认摘要及 646 字节 JPEG。扫描 PDF 提取 1 页，503 后错误显示、手动再次分析成功。模拟模型返回固定摘要，仅证明传输、任务及界面链路，真实图片理解质量另需视觉模型验收。

进入顶栏「手动测试」可执行 TST-071（Word 图文生成）、TST-072（扫描 PDF 与错误恢复），填写实际结果并导出。自动通过不会覆盖人工待执行状态。

## 5. 上线 · REL-016

先确认当前任务队列空闲，备份 PostgreSQL，保留原 VAULT_KEY_B64 和对象存储卷。重建镜像：
```sh
./deploy/build.sh
./deploy/start.sh
```
API 启动自动执行 005 迁移。停止仍使用 ./deploy/stop.sh，保留 PG 与对象存储数据。启动后检查 /api/ready、/docs 和文档上传入口。

回退时先正常停止应用，再把发布前保留的 API、frontend 镜像重新标为 local，启动原应用。保留新增 documents 表及 S3 文件；旧代码忽略新表。数据库备份在 .work/document-qa-20261120/release-before.dump，旧镜像标签 before-documents-20261120。生产发布仍需在目标环境独立验收。

2026-11-20 本机 8800 发布完成：/api/ready 为 ready（PostgreSQL / S3），005 迁移成功，线上 OpenAPI 与导出契约一致，67 条页面用例可见。发布前后 users、projects、workflows、models、assets、chats 的全表内容摘要一致。备份及验证结果位于 .work/document-qa-20261120，回退镜像从发布前 Git 基线重建。生产环境验收未执行。
