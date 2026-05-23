# 贡献指南

## Commit 规范

采用 Conventional Commits，强制 scope 前缀。

### 核心规则

1. **一个 commit 只改一个服务** — 不允许一个 commit 同时修改 `api/`、`web/`、`rag/` 中的多个
2. **commit 信息不含 AI 相关内容** — 禁止 `Co-Authored-By`、`Claude`、`AI generated` 等

> 原因：`git revert` 回滚整个 commit，如果混合修改多个服务，回滚前端会连带回滚后端。

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

| scope | 对应目录 |
|-------|----------|
| `api` | `api/` — Express 后端 |
| `web` | `web/` — React 前端 |
| `rag` | `rag/` — Python RAG 服务 |

`chore` 类型可省略 scope。

### 示例

```bash
git commit -m "feat(api): 新增文档同步端点"
git commit -m "fix(web): 修复流式结束滚动闪烁"
git commit -m "feat(rag): prompt 优化鼓励表格输出"
git commit -m "style(web): 聊天面板 Sitor 风格重构"
git commit -m "chore: 更新 .gitignore"
```

### 回滚

```bash
git log --oneline -- web/          # 只看前端 commits
git revert <commit>                # 只回滚这一个服务
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
