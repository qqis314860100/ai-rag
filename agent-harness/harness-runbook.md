# Harness 主控执行流程

---

## 1. 主控职责

主控 Agent 负责：

- 读取全部项目文档。
- 创建或检查项目脚手架。
- 按任务依赖分派 agent。
- 确认每个 agent 的写入范围不冲突。
- 收集 handoff。
- 运行 review gate。
- 集成变更。
- 执行端到端验收。

---

## 2. 启动前检查

检查文档：

```text
enterprise-rag-kb-requirements.md
enterprise-rag-kb-architecture.md
enterprise-rag-kb-api-spec.md
enterprise-rag-kb-database-schema.md
enterprise-rag-kb-ui-prototype.md
enterprise-rag-kb-mvp-task-list.md
enterprise-rag-kb-implementation-plan.md
```

检查工具：

```text
node >= 20
python >= 3.11
npm 或 pnpm
git
```

检查密钥：

```text
DEEPSEEK_API_KEY
```

没有 API Key 时，允许先使用 mock LLM client。

---

## 3. 推荐分派方式

### 3.1 使用 worktree

```text
main
../rag-wt
../api-wt
../web-wt
../content-wt
../qa-wt
```

每个 worktree 分配给一个 agent，减少写入冲突。

### 3.2 不使用 worktree

按波次执行，并严格限制写入目录：

```text
先 scaffold
再并行读取，但串行写入
```

---

## 4. Agent 启动 Prompt 规则

每个 agent 必须收到：

- 任务 ID
- 项目目标
- 相关文档路径
- 允许写入目录
- 禁止事项
- 验收命令
- handoff 格式

禁止给 agent 模糊任务，例如：

```text
把 RAG 做好
```

必须给具体任务，例如：

```text
在 services/rag/ 中实现 FastAPI 服务、/rag/health、ChromaDB 初始化、EmbeddingService，禁止修改 apps/web 和 apps/api。
```

---

## 5. 集成流程

每个 agent 完成后：

1. 读取 handoff。
2. 检查实际修改文件。
3. 运行该任务验收命令。
4. 执行 review gate。
5. 若失败，退回给原 agent 修复。
6. 若通过，集成到主线。

---

## 6. Review Gate 顺序

```text
Build Gate
 -> Contract Gate
 -> RAG Gate
 -> UI Gate
 -> Security Gate
 -> E2E Gate
```

---

## 7. 最终验收流程

最终必须验证：

- 前端可启动。
- Node API 可启动。
- Python RAG 可启动。
- 可以上传 14 篇文档。
- ChromaDB 生成 chunk。
- 问答返回引用来源。
- 检索调试显示 score 和 chunk。
- 无依据问题不编造。
- 安全类问题回答保守。

---

## 8. 主控集成报告格式

```markdown
## 集成报告

### 已集成任务
- W1A Python RAG 基础
- W1B Node API + SQLite

### 验收命令
- `npm run test`
- `python -m pytest`

### 结果
- 通过 / 失败

### 风险
- ...

### 下一批任务
- ...
```

