# 文档索引

仓库知识的导航层。规则以 `CLAUDE.md`（根）为入口，本文档按主题组织 `docs/` 内容。

## 规则与约定

| 文档 | 内容 |
|------|------|
| [CLAUDE.md](../CLAUDE.md) | Agent 入口：起始阅读、硬约束、安全红线 |
| [EXECUTION_RULES.md](./EXECUTION_RULES.md) | 执行流程：验证先行、提交门槛、验收顺序 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 提交规范：单服务 commit、Conventional Commits、回滚 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构地图：服务边界、职责、验证方式 |

## 产品与需求

| 文档 | 内容 |
|------|------|
| [requirements/](./requirements/) | 需求事实源索引（PRD/PRODUCT_SPEC/FINDINGS） |
| [PRD.md](./PRD.md) | 标准产品需求文档（范围/功能/验收/非功能） |
| [PRODUCT_SPEC.md](./PRODUCT_SPEC.md) | 实施规格与计划（架构/流程/数据层/路线图） |
| [glossary.md](./glossary.md) | 产线与系统领域术语表 |

## 工程记录

| 文档 | 内容 |
|------|------|
| [decisions/](./decisions/) | 架构决策记录（ADR） |
| [plans/](./plans/) | 多轮工作计划（active/ 进行中，completed/ 已完成） |
| [generated/](./generated/) | 机器生成的上下文快照（如 API 路由清单） |
| [FINDINGS.md](./FINDINGS.md) | 审查报告：问题清单与修复状态 |

## 环境与安全

| 文档 | 内容 |
|------|------|
| [security/](./security/) | 安全审查报告 |
| [archive/](./archive/) | 归档文档（历史讨论、环境笔记） |

## 变更工作流

- `skills/coding-implementation/` — 风险自适应变更流程（Fast/Standard/Strict）
- `.ai/pipeline.yaml` — 风险路由与项目检查命令
- `.prompt/` — 分层工程模板（工作流/技术方案/审查/数据/业务/应用）
