# Claude 项目入口

## 项目是什么

这是面向电池产线的企业级 RAG 知识库，包含三个服务：

- `web`：前端 UI 和交互层
- `api`：认证、文档、会话、聊天编排和持久化
- `rag`：文档导入、检索、embedding、prompt 和 LLM 逻辑

## 先读这里

日常改动优先读最少上下文：

- 不熟悉项目：先读 [AGENTS.md](AGENTS.md) 和 [README.md](README.md)
- 每次执行规则：读 [docs/EXECUTION_RULES.md](docs/EXECUTION_RULES.md)
- 准备提交：必要时读 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- 涉及服务边界：必要时读 [docs/架构标准.md](docs/架构标准.md)
- 涉及 Codex/Ralph 配置：必要时读 [docs/Codex架构配置.md](docs/Codex架构配置.md)
- 涉及 UI 设计、图解视觉或高影响前端体验：读 [PRODUCT.md](PRODUCT.md)、[DESIGN.md](DESIGN.md) 和 [docs/企业级 UI 协作工作流.md](docs/企业级 UI 协作工作流.md)

## 规则来源

- [docs/EXECUTION_RULES.md](docs/EXECUTION_RULES.md) 是详细执行规则的唯一细则来源。
- 本文件和 [AGENTS.md](AGENTS.md) 只是短入口摘要；如果和执行规则有偏差，以执行规则为准。
- 项目标准是：日常开发轻，架构边界硬，高风险才重，AFK 自动化单独管。

## 硬规则

- commit 保持单主题；同一主题允许跨服务，不能混无关改动；提交描述写清楚。
- 主题判断看用户意图、接口契约、服务链路或流程规则；不确定就拆。
- 必须遵守下面的架构边界。
- 普通改动跑最小验证；真实浏览器/API/RAG 链路验证只用于高风险路径。
- AFK、发布或高风险提交用 `pnpm run audit:diff -- --strict`，并传主题/验证/harness 证据。
- 使用 Conventional Commits，描述写中文，不加 AI 相关 footer。
- commit 需要标题和正文；正文用 `1. 2. 3.` 编号写清主要修改点。
- 从项目讨论沉淀的新建人类阅读型文档，文件名和标题都用中文。
- 新增代码注释优先使用中文；只在业务规则、边界条件或非显然算法处添加必要注释。
- 查看 diff、日志、测试、构建和大文件时，优先用 `rtk` 压缩输出；信息不足时再回退原生命令。
- 高影响 UI、图解弹窗、知识资产页或发布前体验检查，优先使用项目内 `.agents/skills/impeccable` 的 critique/polish/adapt 思路，并以实际截图验收。

## 架构边界

- `web` 只负责页面、交互、路由、视觉状态和客户端缓存。
- `web` 只通过 HTTP 调用后端，不直连数据库，不直连 `rag`。
- `api` 负责认证、会话、文档、反馈、收藏、统计和请求日志。
- `api` 可以通过服务客户端调用 `rag`，但不内嵌检索逻辑。
- `rag` 负责导入、切分、embedding、检索、prompt 组装和模型调用。
- 人类阅读型项目文档放在 `docs/`；新建讨论型文档使用中文文件名和中文标题。

## 常用命令

- 安装：`pnpm install`
- 启动 web + api：`pnpm dev`
- 启动 rag：`pnpm dev:rag`
- Lint：`pnpm run lint`
- Build：`pnpm run build`
- Verify：`pnpm run verify`
- Harness 自检：`pnpm run audit:harness`
- API 集成测试：`pnpm run test:api`

## 完成前

- 跑能覆盖本次风险的最小验证。
- 只有高风险路径才需要验证真实用户或服务链路。
- 提交前确认 diff 是单主题。
- 如果跨服务，确认跨服务改动服务于同一个主题。
- 可运行 `pnpm run audit:diff` 获取变更区域、风险和验证建议；它只提示，不阻塞。
