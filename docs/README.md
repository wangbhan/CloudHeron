# 云鹭 · CloudHeron 文档入口

本机当前运行 v0.3.4。功能状态与验收入口见 [云鹭功能清单](DOC-FUN-001-功能清单与实现状态.md)。正式生产上线待执行。

- [DOC-GOV-001 编号与阶段规则](DOC-GOV-001-编号与阶段规则.md)
- [DOC-RAW-001 原始需求](requirements/DOC-RAW-001-原始需求记录.md)
- [DOC-REQ-001 需求说明](requirements/DOC-REQ-001-需求说明.md)
- [DOC-DES-002 界面设计](design/DOC-DES-002-界面设计说明.md)
- [DOC-DES-003 需求设计映射](design/DOC-DES-003-需求设计映射.md)
- [DOC-DES-005 云鹭品牌](design/DOC-DES-005-云鹭品牌风格说明.md)
- [DOC-DES-006 实现架构与默认规则](design/DOC-DES-006-开发实现架构.md)
- [DOC-DEV-002 实施与验证](development/DOC-DEV-002-开发实施记录.md)
- [DOC-DEV-003 接口契约](development/DOC-DEV-003-接口与工作流契约.md)
- [DOC-DEV-004 本机运行](../app/README.md)
- [DOC-TST-001 正式测试登记模板](testing/DOC-TST-001-测试任务登记模板.md)
- [DOC-REL-001 上线登记模板](release/DOC-REL-001-上线脚本登记模板.md)

管理主表：[项目追踪表](../outputs/project-register-01/AI漫剧平台-项目追踪表-v0.1.xlsx)。历史设计仍在 design/v0.3；开发版本运行在 8800，设计原型 8767 与开发应用分别使用。

- [DOC-DES-007 功能修订](design/DOC-DES-007-功能反馈修订设计.md)
- [DOC-DEV-005 修复记录](development/DOC-DEV-005-功能反馈修复记录.md)
- [DOC-TST-002 手动测试用例](testing/DOC-TST-002-手动测试用例.md)

- [DOC-TST-003 手动反馈与回归记录](testing/DOC-TST-003-手动反馈与回归记录.md)

- [DOC-DES-008 工作流复用与版本设计](design/DOC-DES-008-工作流复用与版本设计.md)
- [DOC-DEV-006 模板与版本实施记录](development/DOC-DEV-006-模板与版本实施记录.md)
- [DOC-TST-004 模板与版本验证记录](testing/DOC-TST-004-模板与版本验证记录.md)

- [DOC-DES-009 任务级 API 参数设计](design/DOC-DES-009-任务级API参数设计.md)
- [DOC-DEV-007 任务级 API 参数实施](development/DOC-DEV-007-任务级API参数实施.md)
- [DOC-TST-005 任务级 API 参数验证](testing/DOC-TST-005-任务级API参数验证.md)

- [DOC-DES-010 后端任务与运行管理设计](design/DOC-DES-010-后端任务与运行管理设计.md)
- [DOC-DEV-008 后端任务与运行管理实施](development/DOC-DEV-008-后端任务与运行管理实施.md)
- [DOC-TST-006 后端验证记录](testing/DOC-TST-006-后端验证记录.md)
- [DOC-REL-002 单机后端启动与回滚](release/DOC-REL-002-单机后端启动与回滚.md)

- [DOC-DES-011 FastAPI与PostgreSQL迁移设计](design/DOC-DES-011-FastAPI与PostgreSQL迁移设计.md)
- [DOC-DEV-009 FastAPI迁移实施](development/DOC-DEV-009-FastAPI迁移实施.md)
- [DOC-API-001 FastAPI接口与前端对接](development/DOC-API-001-FastAPI接口与前端对接.md)
- [DOC-TST-007 FastAPI迁移验证](testing/DOC-TST-007-FastAPI迁移验证记录.md)
- [DOC-REL-003 FastAPI启动迁移与切换](release/DOC-REL-003-FastAPI启动迁移与切换.md)

新版运行8802，Swagger /docs。PostgreSQL本机验证完成，真实云桶与业务切换待执行；旧8800为保留的Node/SQLite版本。

- [DOC-DES-012 模型连接与协议设计](design/DOC-DES-012-模型连接与协议设计.md)
- [DOC-DEV-010 模型连接与协议实施](development/DOC-DEV-010-模型连接与协议实施.md)
- [DOC-TST-008 模型连接与协议验证](testing/DOC-TST-008-模型连接与协议验证.md)
- [DOC-REL-004 模型协议更新与验证](release/DOC-REL-004-模型协议更新与验证.md)

- [DOC-DES-013 统一入口与服务管理设计](design/DOC-DES-013-统一入口与服务管理设计.md)
- [DOC-DEV-011 统一入口与后台管理实施](development/DOC-DEV-011-统一入口与后台管理实施.md)
- [DOC-TST-009 统一入口与后台验证](testing/DOC-TST-009-统一入口与后台验证.md)
- [DOC-REL-005 统一8800启动与回滚](release/DOC-REL-005-统一8800启动与回滚.md)

当前统一主入口8800，使用原8802的PostgreSQL；旧Node8801。上方历史记录的8802为当时端口，当前步骤以根README和DOC-REL-005为准。

## v0.3设计提案（2026-11-01）

[参考项目调研](design/DOC-REF-001-火宝项目架构调研.md) · [总体架构](design/DOC-DES-014-云鹭新版总体架构.md) · [页面设计](design/DOC-UI-001-云鹭工作室页面设计.md) · [实施计划](development/DOC-DEV-012-新版架构实施计划.md) · [设计验收](testing/DOC-TST-010-新版设计评审与验收计划.md) · [发布计划](release/DOC-REL-006-新版架构分阶段发布计划.md)。此节为原设计交付；当前业务0.3.0的模型模块见下文。

## v0.3.0 模型模块（2026-11-01）

[接口风格设计](design/DOC-DES-015-模型接口风格解耦.md) · [开发记录](development/DOC-DEV-013-模型模块实施.md) · [测试验证](testing/DOC-TST-011-模型接口风格验证.md) · [发布与回退](release/DOC-REL-007-模型模块发布与回退.md)。本机业务0.3.0，整体Vue/Worker迁移另按DEV-030/031推进。

## v0.3.1 集成创作（2026-11-02）

[设计](design/DOC-DES-016-生成验收与集成创作设计.md) · [开发](development/DOC-DEV-014-生成验证与集成创作实施.md) · [测试](testing/DOC-TST-012-生成与集成创作验证.md) · [上线](release/DOC-REL-008-集成创作增量发布.md)。本机平台0.3.1，外部代理故障单独跟踪。

## v0.3.2 创作操作（2026-11-03）

[设计](design/DOC-DES-017-画布AI与批量对话操作设计.md) · [开发](development/DOC-DEV-015-画布AI与创作操作实施.md) · [测试](testing/DOC-TST-013-画布批量与对话操作验收.md) · [上线](release/DOC-REL-009-创作操作发布与回退.md)。REQ-051，新增手动TST-059～061。

## v0.3.3 迈谷风格与项目设定（2026-11-11）

[设计](design/DOC-DES-018-迈谷风格与项目设定.md) · [开发](development/DOC-DEV-016-主题与项目设定实施.md) · [测试](testing/DOC-TST-014-主题与创作回归.md) · [发布](release/DOC-REL-010-主题与项目设定发布.md)

## v0.3.4 生成执行与功能清单（2026-11-11）

[功能清单](DOC-FUN-001-功能清单与实现状态.md) · [设计](design/DOC-DES-019-生成执行短连接设计.md) · [开发](development/DOC-DEV-017-生成执行短连接实施.md) · [测试](testing/DOC-TST-015-生成执行回归.md) · [发布](release/DOC-REL-011-生成执行更新与回退.md)

## Docker 分离部署（2026-11-12）

[DOC-REL-012 启动、独立 PostgreSQL、云桶、备份及验收](release/DOC-REL-012-Docker分离部署.md)

## 工作流撤销与重做

[REQ-055 操作、版本行为与测试](development/DOC-DEV-018-工作流撤销与重做.md)
