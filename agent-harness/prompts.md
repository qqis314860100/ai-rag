# 可复制给 Agent 的 Prompt 模板

---

## 1. 通用系统约束

```text
你正在参与企业级 RAG 知识库系统开发。项目目标是构建面向电池产线工艺、设备、检测、MES、维护、安全的可追溯 RAG 知识库。

必须遵守：
- 只修改分配给你的 write_scope。
- 不要回滚或覆盖其他 agent 的修改。
- 优先阅读相关文档，不要凭空设计。
- 每个答案必须有引用来源，这是产品硬要求。
- 前端必须遵守 Sitor 风格：暖白背景、深石墨主色、金色点缀、轻边框、轻阴影。
- API Key 不得出现在前端、日志或提交内容中。
- 完成后按 agent-harness/handoff-template.md 输出交接。
```

---

## 2. Python RAG Agent Prompt

```text
任务：实现 Python RAG Service 基础能力。

请阅读：
- enterprise-rag-kb-architecture.md
- enterprise-rag-kb-api-spec.md
- enterprise-rag-kb-database-schema.md
- agent-harness/agent-briefs.md 中 Python RAG Agent Brief

只允许修改：
- services/rag/
- data/chroma/

必须实现：
- FastAPI app
- /rag/health
- /rag/documents/ingest
- /rag/search
- /rag/search/debug
- /rag/chat
- Markdown/TXT/PDF/DOCX parser
- Chunker
- EmbeddingService，使用 BAAI/bge-small-zh-v1.5
- ChromaDB VectorStore
- DeepSeek client，支持无 API Key 时 mock
- PromptBuilder，强制引用来源和无依据拒答

验收：
- 服务可启动
- health 返回 ok
- ingest 可写入 ChromaDB
- search 返回 topK chunks
- chat 返回 answer + sources

完成后输出 handoff。
```

---

## 3. Node API Agent Prompt

```text
任务：实现 Node.js API Gateway。

请阅读：
- enterprise-rag-kb-api-spec.md
- enterprise-rag-kb-database-schema.md
- enterprise-rag-kb-architecture.md
- agent-harness/agent-briefs.md 中 Node API Agent Brief

只允许修改：
- apps/api/
- data/migrations/

必须实现：
- /api/admin/health
- /api/documents
- /api/documents/upload
- /api/search
- /api/search/debug
- /api/chat
- /api/feedback
- /api/admin/settings
- SQLite schema 初始化
- RAG service client
- audit logs

要求：
- 统一响应格式
- 写操作记录审计日志
- API Key 不暴露给前端
- 搜索和问答必须传 allowed_security_levels 给 RAG 服务

完成后输出 handoff。
```

---

## 4. Frontend Agent Prompt

```text
任务：实现企业级 RAG 知识库前端工作台。

请阅读：
- enterprise-rag-kb-ui-prototype.md
- enterprise-rag-kb-api-spec.md
- enterprise-rag-kb-requirements.md
- agent-harness/agent-briefs.md 中 Frontend Agent Brief

只允许修改：
- apps/web/

必须实现：
- React 19 + Vite + TailwindCSS
- Sitor 风格设计 token
- AppShell、TopNav、SideNav
- Dashboard
- Documents + UploadDropzone
- Chat + SourcePanel
- Debugger
- Settings

要求：
- 不直接调用 DeepSeek
- 不直接访问 ChromaDB
- 答案必须展示引用来源
- 文本不溢出、不重叠
- 桌面和平板可用

完成后输出 handoff。
```

---

## 5. Content Agent Prompt

```text
任务：创建 14 篇电池产线知识库 Markdown 文档。

请阅读：
- enterprise-rag-kb-requirements.md 第 3 节知识库范围
- enterprise-rag-kb-architecture.md 文档解析和 Chunk 设计
- agent-harness/agent-briefs.md 中 Content Agent Brief

只允许修改：
- knowledge/
- data/seed/

必须创建 14 篇文档：
1. 产线总览与工艺架构
2. 电芯分选（OCV/内阻/K值测试）
3. 电芯堆叠与精密涂胶
4. 端板/侧板激光焊接
5. 极柱 Busbar 激光焊接
6. 模组 EOL 测试
7. Pack 总装工序
8. Pack EOL 测试与下线
9. CTP 1.0/2.0/3.0 麒麟电池技术演进
10. 激光焊接设备详解
11. CCD AI 视觉检测系统
12. MES 制造执行系统
13. 常见设备故障与维护
14. 产线安全与防护

每篇包含 YAML frontmatter、标题层级、表格、常见问题、安全注意事项。

完成后输出 handoff。
```

---

## 6. QA Eval Agent Prompt

```text
任务：建立 MVP 验收与 RAG 评测体系。

请阅读：
- enterprise-rag-kb-requirements.md
- enterprise-rag-kb-mvp-task-list.md
- agent-harness/review-gates.md

只允许修改：
- tests/
- evals/
- docs/qa/

必须产出：
- 至少 30 条验收问题
- API 集成测试计划或测试代码
- RAG 引用正确性检查
- 无依据拒答测试
- 安全类回答测试
- UI 验收清单

完成后输出 handoff。
```

