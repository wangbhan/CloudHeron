# DOC-DEV-009 FastAPI 迁移实施

v0.2.0，2026-10-12。需求 REQ-040～042，设计 DES-029～031。

| 开发编号 | 实现 | 验证 |
| --- | --- | --- |
| DEV-023 | Python FastAPI 全量业务路由、Pydantic 类型、PostgreSQL JSONB/连接池/事务/队列、项目 ACL、登录和发布 API | 真实 PostgreSQL 集成测试与原前端浏览器联调 |
| DEV-024 | 私有 S3 SDK、鉴权媒体/Range/300秒下载、SQLite 只读迁移、凭据重加密及对象字节核对 | Moto HTTP S3 模拟器及隔离旧库迁移；真实云桶待配置 |
| DEV-025 | 63 操作 OpenAPI、前端 Cookie/JSON/revision 契约、接口目录、六条手动用例与部署脚本 | 30 项 Python 检查；浏览器保存、运行、双图与历史刷新 |

代码在 backend。api/protect、会话 Cookie、旧密码 scrypt 与 AES-GCM 解密格式保持兼容；迁移保留旧 ID 和哈希，模型密钥以新 Vault 密钥重加密。相同幂等请求在 PostgreSQL 事务中写任务、输入和 request_keys；领取用 SKIP LOCKED，单库执行器由 advisory lock 保证。正常停机停止领取并等待当前任务；重启 queued 继续，异常 running 留下可见错误。

前端浏览器发现保存响应默认 null 覆盖 can_edit，修正工作流/对话 response_model_exclude_unset，并加保存响应回归断言。图片工作流保存后运行入口保留，实际 HTTP 夹具收到 n=2、quality、自定义 false；对话也生成两图并刷新成功。S3 模拟器的 Expect:100-continue 差异由显式开发配置处理，云配置默认使用 SDK 行为。

部署配置、密钥和现有数据不提交 Git；Docker 上下文排除这些文件。开发主服务 8802；旧 8800 保留。实际旧业务库没有迁移到模拟器，真实云桶和生产切换仍待配置与验收。
