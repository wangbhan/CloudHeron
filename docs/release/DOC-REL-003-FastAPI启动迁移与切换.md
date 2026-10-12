# DOC-REL-003 FastAPI 启动、迁移与切换

v0.2.0；2026-10-12；REL-002，关联 DEV-023～025、TST-037～042。状态：本机 FastAPI/原生 PostgreSQL/S3 模拟验证完成；真实云桶配置与业务切换/生产发布待执行。

## 新部署

1. 准备 PostgreSQL 17 和预建私有 S3 兼容桶；按 backend/.env.example 配置数据库、桶 endpoint/region、凭据、Vault 密钥、HTTPS Cookie。服务器安装 requirements.lock；先备份数据库和密钥。
2. 运行 `CLOUDHERON_PYTHON=.venv/bin/python sh scripts/start.sh`；默认 8802，启动自动迁移表结构及创建内置 Skill/专家。每个业务数据库一个 API 进程。
3. GET `/api/ready` 确认依赖，GET `/docs` 确认接口；空库设团队管理员，执行 TST-037～040/042。真实云桶上传、预览、Range和签名过期单独验收。
4. HTTPS 同源代理前端与 `/api`；设置 COOKIE_SECURE=true。用测试账号验证权限、模型生成与完整错误显示，接入正式流量。

脚本：backend/scripts/start.sh、scripts/start_local_pg.py（仅开发）、scripts/export_openapi.py、scripts/migrate_sqlite.py。开发 Compose 尚未执行；生产使用实际 PostgreSQL 与云桶，避免将本机模拟器当持久存储。

## 从旧版本切换

先完成现有生成任务、停止旧 Node 服务写入。备份整个 `app/data`（含 SQLite、vault.key、media）到受保护位置。原始目录保留用于回滚，不向 S3 模拟器迁移。

配置一个空的目标 PostgreSQL 和独立私有真实桶；迁移前不要在目标建立新团队。停止目标 FastAPI，先运行迁移脚本：

```sh
cd /Users/bohan/work/AI漫剧/backend
.venv/bin/python scripts/migrate_sqlite.py \
  --source ../app/data \
  --report ../outputs/migration-v020/report.json
```

工具对源 SQLite 做只读一致快照，拒绝源 queued/running 和非空业务目标；上传媒体并比对实际字节，数据库事务导入全部表、保留 ID/密码哈希/会话及测试编号、重加密模型密钥。已有同键同内容对象复用，内容不同则拒绝；导入失败回滚数据库并清理本次新对象，不删除已有对象。

核对 report 各表 counts、objects_uploaded、object_bytes_verified、password_hashes_preserved、credentials_reencrypted。开启新版 API，用原账号密码登录；核对项目/workflow/chat/资产/模板/历史/发布 API，执行 TST-038～041。旧 vault.key 和新 VAULT_KEY_B64 分别备份。发布 API 路径及token保留、正式域名转到新版时第三方更新基址。源库迁移期间停止写入，避免新任务遗漏。

## 回滚与停止

SIGTERM 停止新版，等待当前任务结束，不杀正在付费生成的任务。切换前回滚可重新启动旧 Node8800并沿用保留源数据。切换后若新版已有新增业务，先停止写入、备份 PostgreSQL/桶，再制定反向迁移或恢复方案；直接启用旧源库会遗漏新数据。当前迁移工具只提供 SQLite→PostgreSQL，不提供反向转换。

本轮没有执行实际日常数据迁移或切换8800，也未发布生产。云桶供应商和凭据补齐后，按本记录完成真实环境验收与发布登记。

## 参考

生命周期与依赖清理依据 [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/)；连接及事务依据 [psycopg 连接池](https://www.psycopg.org/psycopg3/docs/advanced/pool.html)、[事务](https://www.psycopg.org/psycopg3/docs/basic/transactions.html)；短期下载依据 [boto3 presigned URLs](https://docs.aws.amazon.com/boto3/latest/guide/s3-presigned-urls.html)。
