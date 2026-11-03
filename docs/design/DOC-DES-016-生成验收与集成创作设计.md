# DOC-DES-016 生成验收与集成创作

2026-11-02；DES-039/040；REQ-049/050。

## DES-039 可验证的生成链路

目录探测GET models只返回scope=model_list、generation_verified=false。实际验收由模型页面显式创建项目内对话及普通生成任务，经过Provider、Worker、S3、资产和下载；文本只验证文本，图片、视频分别选择对应能力。协议与模型ID继续独立。

端点规则：paths显式配置优先；base_url没有路径时默认/v1；已有/v1或自定义基路径保持，不尝试多路径重发。Responses使用input、max_output_tokens和output消息块，排除不兼容的通用参数；不根据模型名称猜协议。HTTP错误包含方法/路径、状态和可操作提示，并隐藏密钥。

当前日常库只有文本连接。实测模型目录可读，但/v1/chat/completions和/v1/responses均HTTP502。不能把外部代理未恢复归为平台验收通过；等待用户成功示例或上游恢复，不擅自替换模型或密钥。图片和视频需配置相应连接。

## DES-040 集成创作合同

新增creations表：id/project_id/owner_id/name/document/revision/updated_at；document存故事、风格、目标、模型ID、参考资产ID、数量、清晰度、时长与cards。002迁移增量建表，保留原17表和ID。

规划是source=creation_plan的持久任务。Worker调用文本模型、校验1–12个结构化画面，版本CAS与任务完成同事务提交；无媒体调用。手动填写不依赖文本模型。确认生成后把固定版本cards编译为schema_version=1.0 DAG，source=creation，复用当前执行器。每幅画面保留独立提示词，共享风格和已授权参考版本；API仍显式执行。另存画板只创建普通workflow，不运行。

读写、规划、生成、资产引用均走项目ACL；busy或旧revision返回409；幂等键沿用Service.submit。失败不删除先前资产，页面读取steps.output.asset_ids显示部分结果。不同来源项目卡分别回到对话、画板或集成作品，资产metadata.source/source_id保留回溯。

UI：项目、集成创作、对话、画板并列；集成详情按故事、确认画面、生成三段组织，动态模型选择、缺失能力提示、刷新恢复。没有时间线与自动合片。

参考[火宝短剧README](https://github.com/chatfire-AI/huobao-drama)的一站式创作组织与任务归属，保留云鹭自身范围；未复制其代码和素材。公开主分支未固定SHA，仓库声明CC BY-NC-SA4.0。Responses合同依据[OpenAI Docs](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create)。


### 2026-11-03 批量入口与AI故障复核

DES-039/040：导航及列表明确标记“集成创作 · 批量生成”；作品顶部常驻批量操作栏显示画面数与图片/视频类型。按钮按权限、任务状态、实际画面列表、选中媒体模型校验。助手502/503/504保留原错误，补充本次无新分析/提案及未改工作流的说明和模型配置链接。
