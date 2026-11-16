# DOC-REL-012 云鹭 Docker 分离部署

2026-11-12 · RAW-027 / REQ-054 / DES-044 / DEV-038 / TST-065 / REL-011

## 本机新部署

需要 Docker Engine 和 Docker Compose v2 或更新版本。在项目根目录执行。下面的命令为新实例生成独立凭据。

```sh
umask 077
if [ ! -e .env.docker ]; then
  pg_password=$(openssl rand -hex 24)
  s3_secret=$(openssl rand -hex 24)
  vault_key=$(openssl rand -base64 32)
  sed -e "s|REPLACE_POSTGRES_PASSWORD|$pg_password|g" \
      -e "s|REPLACE_S3_SECRET|$s3_secret|g" \
      -e "s|REPLACE_VAULT_KEY|$vault_key|g" \
      deploy/.env.example > .env.docker
fi
```

如果本机 `./start.sh` 已占用 8800，在 `.env.docker` 设置 `WEB_PORT=18800`。空库首次打开时创建团队管理员，沿用数据需按下方迁移步骤处理。

首次准备好 `.env.docker` 后，从项目根目录运行：

```sh
./deploy/start.sh
./deploy/stop.sh
./deploy/start.sh
```

启动脚本在镜像缺失时构建镜像，启动 PostgreSQL 和对象存储，再等待 API 和前端就绪。更新源码后可执行 `./deploy/start.sh --build`。停止脚本先停止前端和 API，让 API 在 PostgreSQL 和 S3 仍可用时结束当前任务，再停止本项目的 PostgreSQL 和对象存储容器。容器和命名卷 `pgdata`、`objects` 都会保留。

浏览器访问 [8800](http://127.0.0.1:8800) 或配置的 `WEB_PORT`。同一地址的 `/docs` 提供 Swagger，`/api/ready` 检查 PostgreSQL 与对象桶。默认仅将前端入口和本机签名下载端口绑定到环回地址。

```sh
./deploy/compose.sh ps -a
./deploy/compose.sh logs --tail=80 api
```

启停时使用相同的配置与 Compose 项目名。默认读取仓库根目录的 `.env.docker`，项目名为 `cloudheron`。可通过 `CLOUDHERON_DOCKER_ENV_FILE` 指定配置文件，通过 `COMPOSE_PROJECT_NAME` 指定项目名。已有部署应沿用原项目名，以挂载原数据卷。

## 独立管理 PostgreSQL

启动数据库而不启动应用。

```sh
docker compose --env-file .env.docker -f compose.postgres.yaml up -d --wait
docker compose --env-file .env.docker -f compose.postgres.yaml \
  exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database(), version();"'
```

上面的 PG 与应用使用同一个默认 Compose 项目名和网络。若使用 `-p` 更改项目名，所有命令使用同一个值。应用通过 `postgres:5432` 连接。已初始化的 PG 卷沿用原角色密码，编辑 `POSTGRES_PASSWORD` 只影响空卷初始化。运行数据库命令请保持 `POSTGRES_USER` 和 `POSTGRES_DB` 与连接串一致。

已部署在另一台机器的 PostgreSQL，可在 `.env.docker` 设置 `DATABASE_URL` 为容器可达的私有地址，使用该库要求的 TLS 参数和专用应用角色。该角色需能在业务库执行迁移。使用启停脚本时设置 `CLOUDHERON_DOCKER_POSTGRES=external`。

## 使用私有云桶

在 `.env.docker` 设置真实 bucket、区域和 S3 凭据。AWS S3 可将 `S3_ENDPOINT_URL` 留空，S3 兼容厂商填写 HTTPS endpoint。将 `S3_ALLOW_HTTP=false` 和 `S3_CREATE_BUCKET=false`，清空 `S3_PUBLIC_ENDPOINT_URL`，除非同一桶有专门的浏览器访问域名。S3 地址风格按厂商设置。下载签名采用浏览器可访问的 endpoint。

使用容器 PG 和云桶时，在同一个 shell 设置以下环境变量后执行启停。使用外部 PostgreSQL 时再设置 `CLOUDHERON_DOCKER_POSTGRES=external`。启停两次均使用相同设置，外部依赖由它们自己的服务管理。

```sh
export CLOUDHERON_DOCKER_STORAGE=external
./deploy/start.sh
./deploy/stop.sh
```

生产入口由 HTTPS 代理转发到前端，保留原始 `Host`，设置 `COOKIE_SECURE=true`，并将 `CORS_ORIGINS` 设置为确切的公开 HTTPS Origin，例如 `["https://cloudheron.example.com"]`。同源前端继续使用相对 `/api`，会话 Cookie 和 API 保护头照常工作。

## 备份和已有数据

从容器数据库导出备份。

```sh
umask 077
mkdir -p .work
docker compose --env-file .env.docker -f compose.postgres.yaml \
  exec -T postgres sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > .work/cloudheron.pg.dump
```

从现有本机或外部 PG 迁移时，先正常停止原执行器，再将逻辑备份恢复到目标空库。保存原 `VAULT_KEY_B64`，以便解密已有的模型密钥。媒体需同时保留原桶或按原对象键复制到新桶。当前本机 8800 与新 Docker 数据库各自独立，运行容器命令不会自动搬迁数据。回退可停止 Docker 应用容器并用 `./start.sh` 恢复原实例，保留 Docker 数据卷。

## 设计与验收

DES-044 / DEV-038。Nginx 镜像包含静态界面，通过容器 DNS 将 `/api`、`/docs`、`/redoc` 和 `/openapi.json` 转发到 FastAPI。API 镜像包含迁移与手动测试夹具，沿用单 API 进程的执行器约束。原 `./start.sh` 与旧 `backend/compose.yaml` 继续可用。 [Nginx 上游解析](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) · [PostgreSQL 官方镜像](https://hub.docker.com/_/postgres) · [SeaweedFS 本地 S3](https://github.com/seaweedfs/seaweedfs#docker)

### TST-065 本机隔离验证

| 操作 | 实际结果 |
| --- | --- |
| 单独启动数据库服务 | PostgreSQL 17.11 就绪，应用通过 `postgres:5432` 连接。 |
| 分别构建 API 和前端镜像，启动完整 Compose | 隔离端口 18800 上首页、静态脚本、Swagger 和就绪探针可用。API 容器的根路径返回 404，OpenAPI 与仓库快照一致。 |
| 空库初始化、访问账号与测试工作区 | 同源登录会话有效，加载 61 条手动用例。 |
| 媒体预览与下载 | Range 返回 206，私有签名地址可下载，未签名访问返回 403。 |
| 停止 API，重建 PG、S3 和 API，保持 Nginx 容器运行 | 原账号可重新登录，测试项目和媒体仍可读取。 |
| 运行现有 FastAPI 回归 | 81 项通过。 |

本次容器验收使用独立测试库与 SeaweedFS。本机原有 8800 已启动，部署测试未迁移其数据。外部 PG 与真实云桶仍需在部署目标环境验收。

### TST-067 启停与持久化验证

2026-11-16 · DES-046 / DEV-040 / REL-013。使用独立 Compose 项目和新卷，从仓库外执行脚本。

1. 启动四个容器，初始化团队并创建私有项目，上传 PNG 并记录账号、项目、资产 ID 和文件 SHA-256。
2. 运行 `./deploy/stop.sh`。四个容器均停止，`pgdata` 和 `objects` 仍在。重复停止成功。
3. 用脚本重新启动。原账号可登录，项目与资产 ID 保持一致。媒体预览和私有签名下载的内容都与原始文件一致。
4. 停机并移除测试容器，保留两个卷，再运行启动脚本重建容器。账号、项目、资产和下载校验再次通过。

另外校验本地与外部依赖的四种 Compose 服务组合。实际持久化验证使用容器内的 PostgreSQL 和 SeaweedFS。原有本机 8800 服务持续就绪。
