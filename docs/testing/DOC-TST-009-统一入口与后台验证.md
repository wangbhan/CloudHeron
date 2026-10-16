# DOC-TST-009 统一入口与后台验证

2026-10-16；v0.2.2；TST-046，DEV-028，REQ-045。

backend/tests/test_service_manager.py实际启动隔离端口及随机_test数据库：start返回ready，重复start后台PID相同；根页面/docs/OpenAPI就绪；创建测试管理员后终止子API，监督进程PID不变、子API恢复；正常stop再start后原账号密码登录且用户ID相同。另用自有监听测试端口冲突，返回port_in_use且不停止该监听。清理只针对独立测试数据库及自有后台进程。

全量35项Python检查通过，50项旧Node/共享前端回归通过。主8800恢复后/ready为0.2.2/postgresql/s3，页面与docs同源；独立命令status仍ready，重复启动只有同一后台PID。原业务数量1用户/1模型/0项目/0资产/0任务保留。测试日志results/developer-checks-v022.txt，中间记录.work/backend-v022。

新增TST-046保持人工待执行，总46条；原8通过2失败结果保留。未验证系统登录自启、真实云桶或生产发布；当前Moto仍为内存开发模拟器，重启丢对象，不能据此宣称媒体持久化完成。
