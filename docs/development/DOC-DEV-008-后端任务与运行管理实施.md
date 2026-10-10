# 后端任务与运行管理实施

文档编号：DOC-DEV-008  
日期：2026-10-10  
版本：v0.1.6  
关联：REQ-039 → DES-027/028 → DEV-021/022 → TST-033 至 TST-036

## DEV-021 调度与重复提交

`app/lib/runtime.mjs` 调度器按数据库领取 queued 任务；`app/lib/idempotency.mjs` 和独立 `request_keys` 表处理请求键。任务、幂等记录、对话输入同步提交或回滚；对话成功消息与任务完成状态也在同一事务中写入。重启保留 queued，running 失败可见，不自动重新调用生成模型。失败消息和执行中节点状态同步更新，已完成节点保留。

在以下 POST 入口选填 `Idempotency-Key`：`/api/workflows/:id/run`、`/api/chats/:id/messages`、`/api/v1/endpoints/:id/runs`。成功返回 202 和任务；命中时响应头 `Idempotency-Replayed: true`，相同键改变请求为 409，非法键为 400。键按账号与入口隔离，持续保存，无自动过期；同一个生产指令可持续重放。新执行应使用新键。当前前端沿用原提交方式，第三方 API 客户端可自行传键。

## DEV-022 运行管理

新增 `/api/health`、`/api/ready` 和仅管理员访问的 `/api/system/status`，以及 `scripts/start.sh`、`scripts/healthcheck.mjs`。同数据目录只启动一个服务。进程退出信号停止领取新任务，等当前任务完成，剩余队列在下一次启动恢复。可用 `npm run test:backend` 独立验证，不使用实际团队数据库和模型。

| 环境变量 | 默认 | 范围/用途 |
| --- | --- | --- |
| CLOUDHERON_DATA | app/data | SQLite、vault.key、media 和运行锁目录 |
| CLOUDHERON_WORKERS | 2 | 1–8 个并发任务 |
| CLOUDHERON_MAX_PENDING_PER_USER | 10 | 1–100 个 queued/running 任务 |
| HOST / PORT | 127.0.0.1 / 8800 | 监听地址、端口 1–65535 |
| CLOUDHERON_NODE_BIN | node | 启动脚本使用的 Node 可执行文件 |
| CLOUDHERON_HEALTH_URL | http://127.0.0.1:8800 | 健康脚本探测目标 |

## 范围及证据

单进程 SQLite 执行器，不做多实例集群、取消、节点续跑和自动重试。停止期间 provider 原有请求超时规则继续适用；强制终止或外部超时结束服务后，中断任务在重启时显示失败。实时模型支持与质量仍待实际服务联调。验证证据见 DOC-TST-006，启动与回滚见 DOC-REL-002；用户人工结果继续独立保留。
