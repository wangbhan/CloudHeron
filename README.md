# 云鹭 · CloudHeron

供团队使用的AI图片与视频创作平台，支持项目权限、对话Agent、Skill与专家组合、JSON节点工作流、参考资产、模型接入和工作流API。

## 统一启动

新版v0.3.1采用FastAPI + PostgreSQL + 私有S3兼容对象存储。页面和接口统一入口：[http://127.0.0.1:8800](http://127.0.0.1:8800)，Swagger：[http://127.0.0.1:8800/docs](http://127.0.0.1:8800/docs)。原8802的PostgreSQL账号、模型和数据继续使用，不需要重新创建团队。

```sh
cd /Users/bohan/work/AI漫剧
./start.sh
./start.sh status
```

启动后在后台运行，独立于当前终端；重复启动复用现有实例。正常停止使用`./start.sh stop`，有生成任务时等待当前任务完成。电脑重启后再执行一次启动命令，当前未安装系统登录自启动服务。日志在`.work/cloudheron-runtime/service.log`，进程信息在同目录service.json，不提交Git。

本机明确配置DEV_STORAGE=moto时启动开发S3模拟器，并按现有配置恢复项目专用PostgreSQL。模拟器对象不持久，正式使用应填写云桶配置并设DEV_STORAGE=external。外部存储与数据库不会被管理脚本停止。

[安装与云桶配置](backend/README.md) · [前端接口文档](docs/development/DOC-API-001-FastAPI接口与前端对接.md) · [统一入口发布记录](docs/release/DOC-REL-005-统一8800启动与回滚.md) · [全部文档](docs/README.md)

## 手动验收

管理员或编辑者打开顶栏“手动测试”，载入或重新载入测试项目。56条应用用例可记录和导出结果；原人工结果保留，样例不调用模型。本批新增TST-049～052验证模型风格解耦；TST-047/048为设计与整体迁移验收。

文本模型可选OpenAI/Claude格式，视频可选官方vLLM-Omni异步接口；参考视频需模型明确支持并启用对应能力。真实云桶、实际模型效果和生产上线仍需验收。

## 旧Node版本

`app/public`继续作为新版前端。旧Node/SQLite实现保留历史数据，不做隐式数据合并；如需查看，执行`cd app && npm start`，默认入口改为8801。旧版本不作为Claude/Omni新增格式的验收入口。

共享前端回归：在app目录执行`npm run check`与`npm test`；新版后端回归见backend/README.md。后端启动配置、数据、密钥和.work被Git忽略；本项目只做本地提交，GitHub由用户自行推送。生产部署尚未执行。

## v0.3 架构设计与评审原型

新版设计入口：[总体架构](docs/design/DOC-DES-014-云鹭新版总体架构.md)、[参考调研](docs/design/DOC-REF-001-火宝项目架构调研.md)、[原型说明](design/v0.3-next/README.md)。架构方案已确认。本批0.3.0先实现模型领域模块与新版模型连接页；DEV-030/031的整体Vue与执行服务迁移继续分阶段。8800入口和原数据保持。

模型连接入口：`/#models`，支持厂商标签、接口风格与自由模型名称独立配置；见[设计说明](docs/design/DOC-DES-015-模型接口风格解耦.md)。更新API而保留当前开发存储：`./start.sh reload`。

## v0.3.1 生成验收与集成创作

第三入口`/#studio`：故事→画面列表→显式生成图片/视频片段，可另存画板。模型配置页将“列表检测”和“验证生成”分开，支持Responses及主机根地址；生成故障显示实际路径和状态。当前代理生成502仍需服务方恢复或成功示例核对，文本模型不等于图片/视频模型。新增TST-053～058。
