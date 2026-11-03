# DOC-REL-009 创作操作发布与回退

2026-11-03；REL-008；DEV-035；TST-059/060/061。

先运行隔离测试并导出OpenAPI，再等当前排队/运行任务清空，执行./start.sh reload，确认8800 ready/0.3.2。无数据库迁移；原PG、桶、账号、密钥和项目数据保留。

回退前等待所有新任务终止，避免旧Worker接手包含card_indices的队列快照。revert本批代码后reload；保留原jobs、proposals和assets，不删表和媒体。回退页面不提供选中生成与新AI格式兼容。

本机更新与外部模型稳定性分别验收；Moto不代表生产云桶持久性。
