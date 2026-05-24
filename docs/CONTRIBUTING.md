# 贡献指南

这份文档只保留提交相关的硬规则。完整的执行流程见 [项目执行规则清单](./EXECUTION_RULES.md)。

## Commit 规范

采用 Conventional Commits，强制 scope 前缀。

### 核心规则

1. **一个 commit 只表达一个主题** — 一个功能、一个修复、一个重构，或一个流程/文档调整
2. **完成对应风险验证后才能提交** — 普通改动用最小检查，高风险改动才跑真实流程回归
3. **commit 信息不含 AI 相关内容** — 禁止 `Co-Authored-By`、`Claude`、`AI generated` 等
4. **同主题可跨服务，无关主题必须拆分** — 接口契约和调用方可同提，顺手修别的问题要另提
5. **回滚单位必须是单主题 commit** — 不把混杂 commit 当作长期可回滚单位，避免回退时误伤无关功能
6. **新增人类阅读型文档必须中文命名** — 新建的需求、设计、架构、技术说明、计划、复盘等 `.md` 文档，文件名与标题都应使用中文；历史英文文件名不强制重命名，也不影响代码、配置、脚本、测试和资源文件

> 原因：`git revert` 回滚整个 commit。单主题 commit 可以清楚回退一个意图；混入无关改动时，回滚会误伤别的功能，也会让验证证据失真。

### 格式

```
<type>(<scope>): <描述>
```

### Type

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构（不改功能） |
| `style` | 样式/UI 调整 |
| `docs` | 文档 |
| `chore` | 构建、依赖、配置（不限 scope） |

### Scope

| scope | 用途 |
|-------|------|
| `api` | API 单服务改动 |
| `web` | Web 单服务改动 |
| `rag` | RAG 单服务改动 |
| `repo` | 跨服务同主题或仓库级改动 |

`chore` 类型可省略 scope。单服务改动优先带 scope；跨服务同主题或仓库级变更可用 `repo` 或省略 scope。

> 如果一个任务跨多个服务，但属于同一契约或同一用户能力，可以放在同一个 commit；如果只是碰巧一起发生，拆开提交。

### 示例

```bash
git commit -m "feat(api): 新增文档同步端点"
git commit -m "fix(web): 修复流式结束滚动闪烁"
git commit -m "feat(rag): prompt 优化鼓励表格输出"
git commit -m "style(web): 聊天面板 Sitor 风格重构"
git commit -m "feat(repo): 接通文档预览契约"
git commit -m "chore: 更新 .gitignore"
```

### 回滚

```bash
git log --oneline                  # 找到要回滚的单主题 commit
git revert <commit>                # 只回滚这一个主题
```

## 分支策略

- `main` — 稳定分支
- `feat/<功能名>` — 功能分支，合并到 main
- `fix/<问题>` — 修复分支

## 启动

```bash
git clone <repo>
pnpm install
cd rag && pip install -e . && cd ..
cp .env.example .env
pnpm dev
```
