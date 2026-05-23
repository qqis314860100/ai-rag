# 贡献指南

## Commit 规范

采用 Conventional Commits，所有提交必须带 scope 前缀。

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
| `chore` | 构建、依赖、配置 |

### Scope

| scope | 对应目录 |
|-------|----------|
| `api` | `api/` — Express 后端 |
| `web` | `web/` — React 前端 |
| `rag` | `rag/` — Python RAG 服务 |

### 示例

```bash
git commit -m "feat(api): 新增文档同步端点"
git commit -m "fix(web): 修复流式结束滚动闪烁"
git commit -m "feat(rag): prompt 优化鼓励表格输出"
git commit -m "style(web): 聊天面板 Sitor 风格重构"
git commit -m "chore: 扁平化去掉 apps/ 中间层"
```

### 查看日志

```bash
git log -- api/          # 只看后端
git log -- web/          # 只看前端
git log -- rag/          # 只看 RAG
git log --oneline -- api/ web/  # 多目录
```

## 分支策略

- `main` — 稳定分支
- `feat/<功能名>` — 功能分支，合并到 main
- `fix/<问题>` — 修复分支

## 启动

```bash
git clone <repo>
cd enterprise-rag-kb
pnpm install
cd rag && pip install -e . && cd ..
cp .env.example .env
pnpm dev
```
