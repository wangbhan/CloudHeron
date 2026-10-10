# 单机后端启动与回滚

文档编号：DOC-REL-002  
日期：2026-10-10  
版本：v0.1.6  
条目：REL-001  
关联：DEV-021/022、TST-033 至 TST-036  
状态：本机更新已验证；正式生产待执行

## 启动服务

需要 Node.js 24 或更新版本，无 npm 依赖安装步骤。每个数据目录只运行一个服务，默认仅监听本机 127.0.0.1。真实生产域名、TLS、进程托管及备份保留策略另行配置。本轮未部署公共站点。

```sh
cd '/Users/bohan/work/AI漫剧/app'
sh scripts/start.sh
```

另开终端检查：

```sh
cd '/Users/bohan/work/AI漫剧/app'
npm run health
```

健康脚本成功输出 `CloudHeron ready 0.1.6` 并以 0 退出；接口失败、超时或未就绪则非 0。自定义监听或数据目录通过 HOST、PORT、CLOUDHERON_DATA 配置；CLOUDHERON_WORKERS 为 1–8、CLOUDHERON_MAX_PENDING_PER_USER 为 1–100。配置表见 DOC-DEV-008。

## 停止与备份

以前台启动时按 Ctrl+C，或由进程托管发送 SIGTERM。服务停止领取新任务，等待当前任务与请求完成再退出；确认退出后再启动新版本或备份。queued 留存并在重启后执行；强制终止的 running 在重启时失败，不自动重试。直接关闭数据库或同时启动第二个服务不属于停机流程。

停机后可将完整 app/data 复制到项目 .work 下的备份目录，保持目录和文件权限；数据库、vault.key 与 media 必须一起保存。它们均已忽略 Git，备份也不提交。本次更新前备份位于 `.work/development-v016/data-before-update`。

## 回滚代码

当前数据库变更为新增 request_keys 表与队列索引，保留原字段。回滚 v0.1.5 前先完成或处理队列，并确认当前服务退出。v0.1.5 会把 queued/running 标记失败，故不要用它接续 v0.1.6 队列。下列命令在独立检出目录启动历史代码，不修改当前工作区：

```sh
cd '/Users/bohan/work/AI漫剧'
git worktree add --detach .work/rollback-v015 3c48bf9
CLOUDHERON_DATA='/Users/bohan/work/AI漫剧/app/data' node .work/rollback-v015/app/server.mjs
```

使用当前数据可保留更新后的产物；恢复停机前备份会回退此后创建的数据，应另行明确恢复范围。回滚流程本轮仅登记，未在实际团队执行。

## 实际执行记录

2026-10-10：50 项回归与脚本语法校验通过；隔离子进程启动、健康检查和 SIGTERM 退出通过。实际本机 queued/running 为 0 时停止旧服务、备份数据、同步 36 条用例，再运行 start.sh。8800 服务 ready/health 为 200、version 为 0.1.6。逐行核对账号、密码散列、项目、媒体资产与模型记录保留。证据见 DOC-TST-006 与 results/local-update-v016.json。

实际开发进程由本机终端运行。本轮完成本机更新与上线脚本准备，正式生产发布和故障恢复演练仍待执行。
