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

```sh
./deploy/build.sh
cloudheron_compose() {
  docker compose --env-file .env.docker \
    -f compose.yaml -f compose.postgres.yaml -f compose.storage.yaml "$@"
}
cloudheron_compose up -d --wait postgres object-storage
cloudheron_compose up -d --wait
cloudheron_compose ps
```

浏览器访问 [8800](http://127.0.0.1:8800) 或配置的 `WEB_PORT`。同一地址的 `/docs` 提供 Swagger，`/api/ready` 检查 PostgreSQL 与对象桶。只有前端入口和本机签名下载端口绑定环回地址。数据库和 API 使用容器网络。

```sh
cloudheron_compose logs --tail=80 api
cloudheron_compose stop frontend api
cloudheron_compose up -d --wait frontend api
```

`./deploy/build.sh` 逐个构建镜像，避免本机 Compose 并行构建在中文目录触发路径编码错误。单独更新一个服务可执行对应构建命令，再运行 `cloudheron_compose up -d --wait <服务名>`。

```sh
docker build --target api -f backend/Dockerfile -t cloudheron-api:local .
docker build -f app/Dockerfile -t cloudheron-frontend:local .
```

停止或重建容器后，命名卷 `pgdata` 和 `objects` 保留。执行 `down` 时省略 `-v` 可保留这些卷。

## 独立管理 PostgreSQL

启动数据库而不启动应用。

```sh
docker compose --env-file .env.docker -f compose.postgres.yaml up -d --wait
docker compose --env-file .env.docker -f compose.postgres.yaml \
  exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database(), version();"'
```

上面的 PG 与应用使用同一个默认 Compose 项目名和网络。若使用 `-p` 更改项目名，所有命令使用同一个值。应用通过 `postgres:5432` 连接。已初始化的 PG 卷沿用原角色密码，编辑 `POSTGRES_PASSWORD` 只影响空卷初始化。运行数据库命令请保持 `POSTGRES_USER` 和 `POSTGRES_DB` 与连接串一致。

已部署在另一台机器的 PostgreSQL，可在 `.env.docker` 设置 `DATABASE_URL` 为容器可达的私有地址，使用该库要求的 TLS 参数和专用应用角色。该角色需能在业务库执行迁移。部署命令中省略 `-f compose.postgres.yaml`。

## 使用私有云桶

在 `.env.docker` 设置真实 bucket、区域和 S3 凭据。AWS S3 可将 `S3_ENDPOINT_URL` 留空，S3 兼容厂商填写 HTTPS endpoint。将 `S3_ALLOW_HTTP=false` 和 `S3_CREATE_BUCKET=false`，清空 `S3_PUBLIC_ENDPOINT_URL`，除非同一桶有专门的浏览器访问域名。S3 地址风格按厂商设置。下载签名采用浏览器可访问的 endpoint。

使用容器 PG 和云桶时执行以下命令。使用外部 PostgreSQL 时执行第二条，去掉 `-f compose.postgres.yaml`。

```sh
docker compose --env-file .env.docker -f compose.yaml -f compose.postgres.yaml up -d --wait postgres
docker compose --env-file .env.docker -f compose.yaml -f compose.postgres.yaml up -d --wait
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
