# 云鹭 · CloudHeron

供团队使用的 AI 图片与视频创作平台，支持项目、对话 Agent、Skill 与专家组合、JSON 节点工作流、参考资产、模型接入和工作流 API。

## 新版 FastAPI 后端

后端 v0.2.0 位于 `backend`，采用 FastAPI + PostgreSQL + 私有 S3 对象存储。新版本机服务 http://127.0.0.1:8802，接口文档 http://127.0.0.1:8802/docs。

[安装与云桶配置](backend/README.md) · [前端接口文档](docs/development/DOC-API-001-FastAPI接口与前端对接.md) · [迁移与切换](docs/release/DOC-REL-003-FastAPI启动迁移与切换.md)。真实云桶与旧业务数据切换待配置验收；原服务继续保留。

## 旧版本本地运行

需要 Node.js 24 或更高版本，无第三方运行依赖。

```sh
cd app
npm start
```

打开 http://127.0.0.1:8800，首次使用创建团队管理员。数据库和媒体自动存入 app/data，不纳入 Git。模型需要在管理页接入，凭据在本机加密保存。

```sh
cd app
npm run check
npm test
```

[运行与接口说明](app/README.md) · [需求、设计、开发、测试及上线文档](docs/README.md) · [手动测试用例](docs/testing/DOC-TST-002-手动测试用例.md)

## 手动验收

管理员或编辑者点击顶栏“手动测试”，载入测试项目。42 条用例可记录与导出结果；样例不调用模型。已有团队的预置项目继续使用。

参考视频文件需上游支持视频输入，并在模型配置中启用“参考视频输入”，按接口说明配置格式与字段。兼容协议名称并不代表服务支持全部生成能力。

## 工作流模板与历史

工作流列表进入“模板库”，使用图片、视频或图生视频模板创建独立工作流。画布中“保存为模板”固定当前 JSON；“版本历史”查看与对比旧版，确认后恢复为新版本。上述操作不会自动运行。

## 任务 API 可选配置

生成节点和对话 Agent 展开“API 可选参数”，可填写图片数量/质量/格式、视频帧率/采样、文本温度/输出长度及额外 JSON。空值省略，具体参数由接入模型支持；配置随 JSON 或对话历史保存。详见 [API 参数使用说明](docs/development/DOC-DEV-007-任务级API参数实施.md)。

## Git 与 GitHub

仓库根目录包括 backend、app、docs、design 和 outputs 中的项目追踪表。app/data、.work、环境变量与密钥被忽略。运行 npm test 后提交代码。当前只初始化本地 Git；后续自行添加 GitHub remote 并推送。

正式生产上线尚未执行，参见 docs/release 的上线登记文档。
