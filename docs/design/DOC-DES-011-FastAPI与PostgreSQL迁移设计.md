# FastAPI、PostgreSQL 与对象存储迁移设计

DOC-DES-011；2026-10-12；v0.2.0。REQ-040/041/042。

## DES-029 后端与数据迁移

独立 backend 目录，FastAPI 路由/Pydantic 契约、psycopg 连接池和 PostgreSQL SQL 迁移。JSON 配置、消息、快照、ACL 使用 JSONB。保留稳定业务编号及现有 /api 路径，不依赖 Node 作为业务后端。单逻辑执行器用 PostgreSQL advisory lock，任务领取使用 FOR UPDATE SKIP LOCKED，提交/幂等/对话、版本恢复/AI 确认使用事务及 revision 乐观锁。queued 重启继续，running 中断失败，不自动重复调用模型。

SQLite 导入工具为显式命令，验证空目标、原账号的 scrypt 密码格式和 AES-GCM 凭据兼容，导入元数据、版本与关系，并将本地媒体上传桶。旧数据库和目录留存，用迁移报告核对记录与对象字节。导入不运行生成任务。

## DES-030 私有对象存储

boto3 S3 客户端保存与读取媒体，私有桶，不暴露密钥或本地路径。现有媒体 URL 由 API 权限代理读取并支持 Range；另提供短时签名 URL 接口。上传和生成先验文件签名/大小，数据库失败清理刚写入对象。对象路径使用随机资产编号，前端看不到凭据。应用启动检查数据库迁移和桶访问；开发 compose 的对象存储与真实云桶使用相同客户端。

## DES-031 前端契约和交付

FastAPI 同域托管现有静态前端；需要前后端分离时配置白名单 CORS + credentials。保留 HttpOnly cloudheron 会话 Cookie 和 X-CloudHeron 请求保护头，禁止 * 与凭据组合。Swagger /docs、ReDoc /redoc、/openapi.json，生成独立接口契约与前端对接指南。模型、工作流、对话、媒体及异常做浏览器验证。

DEV-023 后端接口与执行器；DEV-024 桶及迁移；DEV-025 文档和前端对接。TST-037 至 TST-042 覆盖接口契约、真实 PostgreSQL/S3、权限、队列/幂等、迁移、前端和部署。REL-002 记录新后端启动/数据库迁移/回滚，生产连接待配置。
