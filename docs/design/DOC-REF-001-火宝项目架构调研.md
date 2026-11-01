# DOC-REF-001 三个参考项目与云鹭取舍

调研日期2026-11-01。读取GitHub官方README、依赖清单及以下源码；公开网页可能有缓存，未锁定提交SHA。Git浅克隆未成功，未执行参考仓库脚本、未引入其源码或图片。

| 参考 | 已核实事实与证据 | 云鹭设计取舍 |
| --- | --- | --- |
| Drama | [backend/package.json](https://github.com/chatfire-AI/huobao-drama/blob/main/backend/package.json)列出Hono、Drizzle、better-sqlite3、Mastra；[入口](https://github.com/chatfire-AI/huobao-drama/blob/main/backend/src/index.ts)注册创作、角色、场景、任务、Agent、Skill等路由；[schema](https://github.com/chatfire-AI/huobao-drama/blob/main/backend/src/db/schema.ts)呈现业务实体及统一生成任务 | 借鉴业务领域分层与任务归属；保留FastAPI/PG，不引入分镜、剪辑、配音流水线，也不直接照搬其Agent工具执行权限 |
| Canvas | [README](https://github.com/chatfire-AI/huobao-canvas/blob/master/README.zh-CN.md)介绍画布、类型化连线、服务端队列；[web/package.json](https://github.com/chatfire-AI/huobao-canvas/blob/master/apps/web/package.json)列出Vue3、Vue Flow、Pinia、Naive UI | 借鉴画布交互、编辑与执行分离、模型适配边界。云鹭使用服务端加密密钥、团队权限及私有桶，不采用浏览器保存密钥作为正式方案。服务端具体领取与事务实现未完整核实 |
| Novel | [package.json](https://github.com/chatfire-AI/huobao-novel/blob/main/package.json)列出Vue3/Pinia；[stores/novel.js](https://github.com/chatfire-AI/huobao-novel/blob/main/src/stores/novel.js)分离种子、人物、世界设定、摘要和章节状态，项目存localStorage | 借鉴结构化上下文，转化为项目“创作设定”及可追溯快照；存PG并受ACL约束。小说章节生成不是本轮产品范围 |

## 许可证和复用边界

[Drama LICENSE](https://github.com/chatfire-AI/huobao-drama/blob/main/LICENSE)与[Canvas LICENSE](https://github.com/chatfire-AI/huobao-canvas/blob/master/LICENSE)标注CC BY-NC-SA 4.0，[Novel LICENSE](https://github.com/chatfire-AI/huobao-novel/blob/main/LICENSE)标注MIT。本次是原创架构与界面设计，无参考源码复制。后续若直接引入代码、素材或依赖，建立来源/版本/许可证清单，逐项核对适用条件；商业使用需求另核对授权。这里只记录仓库声明，不对未来复用作许可结论。

## 与当前云鹭差距（本地源码依据）

现有main.py/routes.py/service.py集中多领域逻辑；worker.py在API进程持有PG连接执行长任务；声明式Skill为提示词模板。已有ACL、幂等、JSON版本、提案确认、Provider和S3可保留。新方案主要拆模块/任务连接生命周期、升级组件化前端；不为换参考项目而更换已确定的数据库、框架和8800入口。
