# 云鹭 FastAPI 后端 v0.3.0

Python 3.12、FastAPI、psycopg 连接池、PostgreSQL 17 和 boto3 S3 对象存储。业务数据、工作流 JSONB、权限、任务队列在 PostgreSQL；图片视频字节在私有桶。此实现不运行 Node 后端，也不以本地媒体目录作为运行存储。

需求 REQ-040～042 → DES-029～031 → DEV-023～025 → TST-037～046 → REL-002。接口说明见 [DOC-API-001](../docs/development/DOC-API-001-FastAPI接口与前端对接.md)，切换流程见 [DOC-REL-003](../docs/release/DOC-REL-003-FastAPI启动迁移与切换.md)。

## 安装与云服务配置

```sh
cd /Users/bohan/work/AI漫剧/backend
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
cp .env.example .env
chmod 600 .env
```

填写 `.env`：PostgreSQL URL、预建私有桶的 bucket/region/HTTPS endpoint、S3 凭据，以及固定的 `VAULT_KEY_B64`（32 随机字节的 base64，可用 `python -c 'import secrets,base64;print(base64.b64encode(secrets.token_bytes(32)).decode())'` 生成）。AWS S3 可省略 endpoint；也可省略显式访问密钥，使用 boto3 默认凭据链。备份并保留 Vault 密钥，更新它需要重新加密模型凭据。

对象权限至少包含指定桶的 HeadBucket/ListBucket、GetObject、PutObject、DeleteObject；创建桶只用于开发。云端设 `S3_CREATE_BUCKET=false`、`S3_ALLOW_HTTP=false`、`S3_DISABLE_EXPECT=false`。`S3_ADDRESSING_STYLE` 为 `path` 或 `virtual`，按供应商设置。OSS/COS 须使用其 S3 兼容 endpoint 与鉴权能力，供应商原生接口需另做适配。

```sh
CLOUDHERON_PYTHON=.venv/bin/python sh scripts/start.sh
```

打开 http://127.0.0.1:8800；首次空库创建自己的团队管理员。Swagger：http://127.0.0.1:8800/docs，ReDoc：`/redoc`，规范：`/openapi.json`。启动自动执行 `migrations/001_initial.sql`，执行器每库一个 API 进程（Uvicorn `--workers 1`）；`WORKERS` 控制该进程中的任务并发，默认 2，不是 Uvicorn 进程数。

## 当前机器的开发环境

本次本机 Python 位于 `../.work/backend-v020/venv/bin/python`，已有忽略 Git 的 `.env`。专用 PostgreSQL 在 55432，数据位于 `../.work/backend-v020/postgres-data`。主服务 8800 使用 `cloudheron` 数据库。旧Node/SQLite实现和数据仍保留，默认端口改为8801；当前主服务沿用原8802使用的PostgreSQL，不做SQLite隐式合并。

59000 是 Moto 的 S3 HTTP 模拟器，仅用于接口验证；它的对象在进程退出后丢失。它不是云桶，也不是持久存储上线方案。不要向它迁移日常业务数据。当前开发服务需要该模拟器运行，真实部署填写真实桶配置。

重启开发依赖（两个终端，先准备 PostgreSQL）：

```sh
cd /Users/bohan/work/AI漫剧/backend
../.work/backend-v020/venv/bin/python scripts/start_local_pg.py
../.work/backend-v020/venv/bin/python -m moto.server -H 127.0.0.1 -p 59000
```

另一个终端启动 API：

```sh
cd /Users/bohan/work/AI漫剧/backend
CLOUDHERON_PYTHON=../.work/backend-v020/venv/bin/python sh scripts/start.sh
```

`start_local_pg.py` 只管理项目专用集群，不启动 Homebrew 系统服务。全新环境先安装 PostgreSQL 17，将其 bin 放入 PATH 或设置 `CLOUDHERON_PG_BIN`，再运行 `scripts/dev_env.py` 生成开发配置。不要对现有云配置运行本机集群脚本。

## 自动测试与手动验收

安装开发依赖 `python -m pip install -r requirements-dev.txt`。专用 `cloudheron_test` 库由本机脚本创建；自建测试环境设置 `CLOUDHERON_TEST_DATABASE_URL`，名字必须以 `_test` 结尾。集成测试会清空这个测试库，迁移测试需要 Node.js 24 创建旧格式夹具，还需要测试角色有 CREATEDB 权限；S3 endpoint 指向本机模拟器，测试自动使用随机独立桶并清理。不要使用生产桶端点运行夹具测试。

```sh
cd /Users/bohan/work/AI漫剧/backend
../.work/backend-v020/venv/bin/python -m pytest -q
../.work/backend-v020/venv/bin/python scripts/export_openapi.py
```

35 项覆盖真实 PostgreSQL 事务、权限、任务去重、重启恢复、迁移、HTTP 模型调用和 S3 模拟器。不会调用收费模型。手动在新版顶栏“手动测试”点“重新载入测试项目”，执行 TST-037～046，并保存自己的实际结果。真实模型和真实云桶验证仍需要部署配置，参见 [测试记录](../docs/testing/DOC-TST-007-FastAPI迁移验证记录.md)。

## 容器开发方案

`compose.yaml` 提供 PostgreSQL + 持久 MinIO + API 的开发组合；根目录 `.dockerignore` 排除本地数据与 `.env`。本次 Docker 引擎未成功启动，容器镜像构建和 Compose 运行尚未验证。运行前停止占用 55432/59000/8800 的本机开发实例，再在 backend 执行 `docker compose --env-file .env up --build -d`。此配置创建本地私有桶，与真实云桶部署分开。

## 运行约束

`/api/health` 检查数据库，`/api/ready` 同时检查数据库及桶；`/api/system/status` 仅管理员可查看并发与排队数量。SIGTERM 等当前任务结束，不再领取排队任务；重启接续 queued，已中断 running 标为失败，不自动重复付费调用。持有执行器锁的 PostgreSQL 连接丢失时停止领取与新提交，ready 返回503，需重启服务恢复。模型超时默认 180 秒，异步视频轮询上限 30 分钟，停止可能等待当前调用完成。

生产通过 HTTPS 反向代理同源提供前端和 `/api`，设置 `COOKIE_SECURE=true`。独立前端使用明确的 `CORS_ORIGINS` JSON 数组、携带 Cookie 和保护头；当前前端使用相对 `/api`，推荐代理保持同源。生产数据库、桶和 Vault 密钥分别备份，云桶启用持久存储和供应商权限策略。

模型配置新增文本OpenAI/Claude和官方vLLM-Omni视频风格；连接测试在模型行内显示进度和结果，默认10秒后端检测，15秒前端期限。用例TST-043～045，见DOC-DEV-010和DOC-TST-008。

## 统一后台管理（v0.2.2）

在项目根目录执行`./start.sh`，自动选择backend/.venv或当前.work/backend-v020/venv解释器，启动后台监督进程。`./start.sh status`返回ready/starting/unready/stopping/stopped，含端口、日志、进程和恢复次数；`./start.sh stop`正常停止。电脑重启后需再执行一次start，未安装登录自启。后台子API退出会重新启动；遇到其它进程占用8800时明确拒绝，不接管它。

DEV_STORAGE=external默认使用配置的外部依赖；DEV_STORAGE=moto仅允许当前本机http://127.0.0.1:59000开发配置，并在需要时启动Moto、恢复专用PG。Moto退出恢复会丢失原内存对象，这是开发限制；正式部署使用云桶或已验收的持久MinIO，不使用Moto。仅停止脚本自行启动的Moto，不停止已有外部服务或PostgreSQL。停止生成需等API当前任务完成，管理命令超过10秒会显示stopping，稍后用status查看。

底层`scripts/start.sh`仍为前台启动、默认8800，可通过PORT指定其它端口；测试使用独立端口/数据库/状态目录。不要把两个API连接到同一业务数据库同时运行。

## v0.3.0 模型领域模块

`GET /api/model-styles`提供接口风格目录。厂商provider、接口interface_style、模型model独立；模型名无固定列表。支持MiniMax原生图片、视频V1/V2，旧配置兼容。`./start.sh reload`（项目根目录）仅重载API并保持PG和当前Moto进程。
