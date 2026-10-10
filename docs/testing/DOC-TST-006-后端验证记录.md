# 后端验证记录

文档编号：DOC-TST-006  
日期：2026-10-10  
版本：v0.1.6  
关联：REQ-039、DES-027/028、DEV-021/022、TST-033 至 TST-036

## 自动化结果

`npm run check`、`sh -n scripts/start.sh` 通过；`npm test` 共 50 项通过、0 失败。`npm run test:backend` 包含 12 项后端专项检查。完整输出见 [开发回归记录](results/developer-checks-v016.tap)，所有模型请求使用 HTTP 夹具，不调用实际模型。

| 证据 | 结果 | 对应实现 |
| --- | --- | --- |
| 同时提交两个相同请求、终态重放、不同内容冲突 | 同一任务、一条用户输入、一次上游请求；内容变更为 409 | idempotency.mjs、server.mjs；DEV-021 |
| 工作流保存新版本后重放旧请求、API 固定版本、账号隔离 | 原任务返回；新账号和新入口独立；旧键不重新生成 | request_keys 独立表；DEV-021 |
| 并发 1、每用户 pending 2、第三次新提交 | running 1、queued 1、新提交 429，重放不占额外配额 | runtime.mjs；DEV-021 |
| 终态更新触发器报错、失败任务重放 | 成功消息回滚，只留一条失败提示；相同键返回原失败任务、不再次调用 | terminal SQLite 事务；DEV-021 |
| 请求键写入触发器报错 | 任务、对话输入和幂等记录全部回滚 | SQLite 同步事务；DEV-021 |
| 当前任务被夹具暂停，调用 close，再释放上游 | 等当前任务完成再关闭；queued 不领取；重启只追加一次对应调用 | scheduler pause/drain；DEV-021/022 |
| 模拟 running 中断，连续两次重启 | running 节点失败，completed 节点保留；对话追加一次错误，不自动重试 | markJobFailed；DEV-021 |
| 撤销项目授权和发布凭据 | 已有请求键不绕过当前权限，403/401 | 权限先验证；DEV-021 |
| 同目录第二实例、退出释放、旧 PID 锁、错误配置 | 重复实例被拒绝，退出可重启；无效配置拒绝 | runtimeLock；DEV-022 |
| 实际 /bin/sh 启动子进程、健康脚本、SIGTERM | version 0.1.6、退出码 0、锁释放 | start.sh、healthcheck.mjs；DEV-022 |
| health/ready 无登录，system/status 权限 | 公开接口仅状态/版本，未登录 401、查看者 403 | server.mjs；DEV-022 |

## 手动验收

新增 TST-033 去重与事务、TST-034 持久队列和中断、TST-035 并发及目录锁、TST-036 启动/健康/退出。四条用例都可在 app 目录执行 `npm run test:backend`，观察对应子项结果并填写实际记录；无需配置模型、不写入日常团队数据。

应用“功能验收测试项目”已同步为 36 条独立 `project_test_cases` 记录，保留该项目原有 5 份工作流、3 份对话和 2 份参考资产。原人工结果保持 8 通过、2 失败，其余 26 条待执行；自动化通过不改写人工结果。步骤和预期结果见 [手动测试用例](DOC-TST-002-手动测试用例.md)。

## 本机更新

进入更新阶段前核对实际 queued/running 为 0，确认旧进程目录为本项目 app，停止旧进程并备份 app/data 至 .work/development-v016/data-before-update。同步手动用例后通过 start.sh 启动 v0.1.6，`npm run health` 返回 ready。公开 health/ready 返回 200，未登录 system/status 返回 401。

与停机备份逐行比较 users、projects、workflows、chats、assets、models，全部相同，包含账号密码散列和模型凭据；未写入开发夹具账号或模型。实际全局数据为 2 用户、2 项目、7 工作流、3 对话、4 资产、0 模型。36 条用例已入表，活跃任务仍为 0。[不含凭据的本机验证记录](results/local-update-v016.json)保存了检查结果。

## 上线边界

需求、设计、开发、测试和本机更新已依次完成，REL-001 登记真实启动及探测脚本，正式生产尚未发布。采用单数据目录单进程 SQLite；多实例、取消、节点续跑、自动重试仍待细化。当前实际团队还没有模型配置，真实服务协议、模型能力和生成质量需后续联调。
