# DOC-DES-012 模型连接与协议设计

2026-10-14；v0.2.1。RAW-019，REQ-043/044。

DES-032：前端按模型保存测试中/成功/警告/失败结果，aria-live即时反馈；15秒客户端期限；后端10秒连接检测，输出ok/status/note/elapsed_ms/models/model_available，仅管理员调用。成功但未发现所填模型显示警告，不声称生成验证完成。

DES-033：服务协议与请求格式分离。spec.text_format=openai|claude；Claude使用/messages、x-api-key与anthropic-version、顶层system、必填max_tokens和content文本块。spec.video_style=openai|vllm_omni，vLLM-Omni按/videos异步multipart和input_reference文件，提供num_frames/fps/第二引导系数/boundary/flow_shift，扩展JSON进入extra_params。保留旧规格默认OpenAI行为；vLLM-Omni协议未显式指定风格时默认官方样式。旧字段、模型ID和数据库数据不自动修改。

DEV-026：连接结果与类型配置界面。DEV-027：Claude/vLLM-Omni适配与契约。TST-043～045：进度/超时/HTTP失败、Claude与OpenAI、官方视频参数和参考输入。REL-003：本机新版更新及上线登记，生产仍待执行。
