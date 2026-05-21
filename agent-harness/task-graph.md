# 任务依赖图与执行波次

---

## 1. 总体依赖

```text
W0: 文档冻结与脚手架
  |
  +--> W1A: Python RAG Service
  +--> W1B: Node API + SQLite
  +--> W1C: Frontend Shell + Theme
  +--> W1D: 初始知识文档
        |
        v
W2: 文档入库 + 搜索 + 问答闭环
        |
        v
W3: 前端集成 + 检索调试 + 反馈
        |
        v
W4: QA 评测 + 安全审查 + 端到端验收
```

---

## 2. Wave 0：主控初始化

只能由主控 Agent 执行。

| 任务 | 负责 Agent | 输出 |
|---|---|---|
| W0-T1 创建项目目录 | orchestrator | `enterprise-rag-kb/` |
| W0-T2 初始化 monorepo | orchestrator | `apps/web`、`apps/api`、`services/rag` |
| W0-T3 复制 docs | orchestrator | `docs/` |
| W0-T4 创建 `.env.example` | orchestrator | 环境变量模板 |
| W0-T5 创建 README | orchestrator | 启动说明 |

验收：

```text
目录结构存在
README 可读
.env.example 完整
各子项目有最小启动文件
```

---

## 3. Wave 1：并行基础建设

可并行执行。

### W1A：Python RAG 基础

负责 Agent：`rag_engine`

任务：

- FastAPI 初始化
- `/rag/health`
- ChromaDB 初始化
- embedding 模型加载
- parser/chunker/vectorstore 模块骨架

输出：

```text
services/rag/
```

验收：

```text
python 服务可启动
/rag/health 返回 ok
embedding 输出 384 维向量
```

### W1B：Node API + SQLite

负责 Agent：`backend_api`

任务：

- API 服务初始化
- SQLite schema
- documents CRUD
- settings
- audit logs
- RAG service client

输出：

```text
apps/api/
data/app.db
```

验收：

```text
/api/admin/health 返回 ok
SQLite 表创建成功
```

### W1C：Frontend Shell

负责 Agent：`frontend`

任务：

- React + Vite 初始化
- TailwindCSS
- Sitor 风格 token
- AppShell
- TopNav
- SideNav
- 空页面路由

输出：

```text
apps/web/
```

验收：

```text
前端可启动
Dashboard / Chat / Documents / Debugger 页面可访问
视觉 token 生效
```

### W1D：知识内容

负责 Agent：`content`

任务：

- 创建 14 篇 Markdown 文档
- 每篇带 YAML frontmatter
- 优化标题层级
- 参数表用 Markdown 表格

输出：

```text
knowledge/
data/seed/documents.json
```

验收：

```text
14 篇文档齐全
metadata 完整
标题层级清晰
```

---

## 4. Wave 2：RAG 闭环

依赖 Wave 1。

| 任务 | 负责 Agent | 依赖 |
|---|---|---|
| W2-T1 文档上传 API | backend_api | W1B |
| W2-T2 文档解析与切块 | rag_engine | W1A、W1D |
| W2-T3 写入 ChromaDB | rag_engine | W2-T2 |
| W2-T4 `/api/search` | backend_api + rag_engine | W2-T3 |
| W2-T5 DeepSeek client | rag_engine | W1A |
| W2-T6 `/api/chat` | backend_api + rag_engine | W2-T4、W2-T5 |

验收：

```text
上传文档后可索引
搜索返回 chunks
问答返回 answer + sources
```

---

## 5. Wave 3：前端集成

| 任务 | 负责 Agent | 输出 |
|---|---|---|
| W3-T1 Documents 页面接入 API | frontend | 文档列表、上传、重建索引 |
| W3-T2 Chat 页面接入 API | frontend | 问答、来源展示 |
| W3-T3 SourcePanel | frontend | 引用卡片、原文展开 |
| W3-T4 Debugger 页面 | frontend | TopK、score、prompt preview |
| W3-T5 Settings 页面 | frontend | RAG 参数配置 |

验收：

```text
用户可通过 UI 完成上传、提问、查看引用、调试检索
```

---

## 6. Wave 4：质量、安全、发布

| 任务 | 负责 Agent | 输出 |
|---|---|---|
| W4-T1 评测问题集 | qa_eval | `evals/questions.json` |
| W4-T2 API 集成测试 | qa_eval | `tests/api/` |
| W4-T3 RAG 质量测试 | qa_eval | 引用正确性报告 |
| W4-T4 安全审查 | security_review | 安全风险清单 |
| W4-T5 UI 验收 | qa_eval | 页面走查结果 |
| W4-T6 最终修复 | orchestrator | 集成修复 |

验收：

```text
30 条 MVP 问题通过人工或半自动评测
安全审查无 P0/P1 问题
UI 无明显错位和阻塞交互
```

---

## 7. 防冲突写入范围

| Agent | 可写目录 |
|---|---|
| rag_engine | `services/rag/`、`data/chroma/` |
| backend_api | `apps/api/`、`data/app.db`、`data/migrations/` |
| frontend | `apps/web/` |
| content | `knowledge/`、`data/seed/` |
| qa_eval | `tests/`、`evals/`、`docs/qa/` |
| security_review | `docs/security/`、`tests/security/` |
| orchestrator | 全局集成 |

