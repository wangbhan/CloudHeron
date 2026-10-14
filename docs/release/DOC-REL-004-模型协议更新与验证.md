# DOC-REL-004 模型协议更新与验证

2026-10-14；v0.2.1；REL-003，DEV-026/027，TST-043～045。

本机新版8802正常停机后更新；数据库结构和凭据格式未改变，无数据转换。先确认任务完成，按backend/scripts/start.sh重启，/api/ready版本0.2.1，/openapi.json与backend/openapi.json一致。刷新前端使新格式和行内结果生效。

文本模型编辑时选择文本请求格式OpenAI或Claude，保留含/v1的根地址，若旧paths.text为/chat/completions而改Claude，清除或改为/messages；视频选择官方vLLM-Omni风格及正确模型名。原自定义JSON服务选择OpenAI兼容/自定义风格，避免将JSON当官方multipart。已有模型不会自动修改；管理员按实际服务保存设置。

执行TST-043～045；正常关闭临时8803/8812QA实例，不把测试模型加入日常库。真实模型、云桶和生产待验收，Docker启动尚未验证。回滚至fcad293前需备份配置；新Claude/Omni设置属于新版本，旧版不支持这些扩展，回滚需还原旧格式设置。不要直接启用不匹配协议调用。
