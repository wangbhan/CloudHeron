# DOC-TST-008 模型连接与协议验证

2026-10-14；v0.2.1；REQ-043/044，DEV-026/027，TST-043～045。

本轮33项Python测试通过；50项旧版共享前端测试通过。连接探测实际HTTP成功、模型名缺失警告、401错误和0.05秒测试超时均验证；只有模型列表GET，无生成调用；查看者403。Claude实际POST /messages，x-api-key/version、顶层system、temperature0、max_tokens/stop_sequences及文本块提取正确；OpenAI分支保持原协议。官方Omni分别传图片/视频原字节到multipart input_reference，frames81/fps16和第二引导系数等传递，extra_params对象编码正确，轮询并下载落桶。非法官方JSON格式拒绝。

真实浏览器QA8803：点击立即测试中，成功结果1031ms、脱敏HTTP401和2023ms超时结果持续显示。Claude保存并刷新恢复claude；视频保存并刷新恢复vllm_omni/multipart，非任务格式字段隐藏。后端和上游为独立HTTP夹具、真实测试PostgreSQL、Moto对象存储；未使用用户模型密钥或调用收费生成。浏览器截图接口超时，已保存DOM和请求证据，不声称完成截图视觉验收。

结果见results/developer-checks-v021.txt，中间证据在.work/backend-v021。原人工8通过2失败保留，新三项待执行，总45条用例，35条待执行。实际Claude供应商/vLLM-Omni部署的模型输出质量仍由手动测试验证；真实云桶和生产上线待配置。
