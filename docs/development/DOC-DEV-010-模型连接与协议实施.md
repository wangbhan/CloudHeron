# DOC-DEV-010 模型连接与协议实施

2026-10-14；v0.2.1；RAW-019，REQ-043/044，DES-032/033。

DEV-026：连接测试按钮立即禁用并显示测试中，按模型保存行内结果/耗时/警告，失败脱敏。编辑配置清除旧结果，过期测试响应不覆盖新配置。文本/图片/视频格式字段随能力显示，Claude/OpenAI可选，视频官方风格固定multipart。

DEV-027：Provider独立10秒检测，结构化ModelCheckOut；Claude Messages转换system、停止词、默认max_tokens、鉴权头和文本块解析；官方vLLM-Omni异步multipart、num_frames优先和四个扩展采样选项，模型扩展配置进入extra_params，参考文件统一input_reference。原OpenAI文本及自定义JSON视频路径保留。主后端版本0.2.1；接口规范已重新生成。

主实现：backend/cloudheron/provider.py、domain.py、schemas.py、main.py，app/public/app.js及product.css、app/lib/api-options.mjs与Pythonregistry。无数据库结构迁移，不修改已有模型密钥与用户数据。此功能针对新版8802，旧8800仅保留历史后端，不作为Claude/Omni新协议验收入口。

33项Python通过，50项旧版共享前端回归通过；独立QA浏览器验证即时进度、成功/401/超时、格式保存恢复及条件显示。TST-043～045为用户手动验收，新用例保持待执行，原人工结果保留。
