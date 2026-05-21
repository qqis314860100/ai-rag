# 企业级 RAG 知识库实施计划

版本：v1.0  
日期：2026-05-15  
目标：把需求、架构、API、数据库、UI 和任务清单转成实际交付节奏

---

## 1. 实施原则

- 先跑通 RAG 闭环，再做企业治理。
- 先支持 Markdown/TXT，再增强 PDF/DOCX。
- 先可追溯，再追求回答漂亮。
- 先有检索调试，再做 rerank 和混合检索。
- 前端先搭工作台，不做纯营销页。
- 每一轮交付都必须可运行、可验证。

---

## 2. 推荐工期

以 1 到 2 名工程师开发估算：

| 阶段 | 时间 | 产出 |
|---|---:|---|
| 第 1 周 | 5 天 | 脚手架、数据库、RAG 基础服务 |
| 第 2 周 | 5 天 | 文档入库、ChromaDB、检索 |
| 第 3 周 | 5 天 | DeepSeek 问答、引用来源、Node API |
| 第 4 周 | 5 天 | 前端工作台、文档管理、问答页 |
| 第 5 周 | 5 天 | 检索调试、设置、反馈、验收优化 |

如果只做 demo 级 MVP，可压缩到 10 到 15 个工作日。

---

## 3. 阶段计划

### 阶段一：基础工程

目标：

- 项目可启动。
- 三个服务骨架可运行。
- 数据库可初始化。

交付：

- monorepo
- apps/web
- apps/api
- services/rag
- `.env.example`
- SQLite schema
- health endpoints

验收：

```text
前端可以打开
Node /api/admin/health 返回 ok
Python /rag/health 返回 ok
SQLite 表创建成功
```

### 阶段二：文档入库

目标：

- 上传文档并完成向量索引。

交付：

- 文件上传
- 文档元数据
- Markdown/TXT/PDF/DOCX parser
- chunker
- embedding
- ChromaDB upsert
- 索引状态

验收：

```text
上传一篇文档后 index_status 变为 ready
ChromaDB 中能查到对应 chunk
文档列表显示 chunk_count
```

### 阶段三：语义检索与问答

目标：

- 用户可以自然语言提问。
- 答案必须带引用。

交付：

- /api/search
- /api/chat
- /rag/search
- /rag/chat
- DeepSeek client
- PromptBuilder
- SourceBinder

验收：

```text
问题能命中正确文档
回答包含 sources
无依据问题能明确说明无法确认
```

### 阶段四：前端工作台

目标：

- 用户能通过 UI 完成核心操作。

交付：

- Dashboard
- Documents
- Upload
- Chat
- SourcePanel
- Settings

验收：

```text
可以上传文档
可以看到索引状态
可以提问并查看引用
可以调整 TopK
页面符合 Sitor 风格
```

### 阶段五：调试与验收

目标：

- 工程师能调试检索质量。
- 系统可用于 14 篇文档演示。

交付：

- Debugger
- Prompt Preview
- Feedback
- 30 条验收问题
- 基础日志

验收：

```text
检索调试页展示 score、chunk、metadata、prompt
30 条问题人工验收通过
安全类问题回答保守
```

---

## 4. 交付物清单

### 4.1 文档交付物

- 需求文档
- 技术架构设计
- API 接口文档
- 数据库设计
- 前端原型说明
- MVP 任务清单
- 实施计划

### 4.2 代码交付物

- 前端 Web 应用
- Node API Gateway
- Python RAG Service
- SQLite 初始化脚本
- RAG prompt 模板
- 14 篇初始知识文档
- 批量入库脚本

### 4.3 验收交付物

- 测试问题集
- 验收记录
- 已知问题清单
- 部署说明

---

## 5. 技术决策

### 5.1 为什么 Node + Python

Node 更适合：

- 前端 API
- 用户权限
- 文件上传
- 会话管理
- Web 生态

Python 更适合：

- 文档解析
- embedding
- ChromaDB
- RAG pipeline
- 评测

### 5.2 为什么先用 ChromaDB

- 嵌入式，零配置。
- 适合 MVP。
- 本地持久化简单。
- 后续可通过 VectorStore 接口替换。

### 5.3 为什么必须做检索调试页

企业 RAG 的难点通常不是“调用模型”，而是：

- 检索是否命中正确文档
- chunk 是否切得合理
- prompt 是否塞入了错误上下文
- 权限过滤是否生效

调试页是后续优化质量的核心工具。

---

## 6. 风险控制

| 风险 | 控制措施 |
|---|---|
| PDF 解析差 | 首批知识尽量使用 Markdown，PDF 做兜底 |
| 模型幻觉 | 强制引用、低温度、无依据拒答 |
| 检索不准 | 调整 chunk、增加标题上下文、做调试页 |
| 权限泄露 | Node 和 Python 双重 security_level 过滤 |
| API Key 泄露 | 只存在服务端，日志脱敏 |
| 依赖下载慢 | 模型首次下载时给出状态提示 |

---

## 7. 发布方案

### 7.1 本地开发

```text
Web:  http://localhost:5173
API:  http://localhost:3001
RAG:  http://localhost:8000
```

### 7.2 Demo 部署

- 单机部署。
- SQLite + ChromaDB + 本地文件。
- 使用 pm2 或 docker compose。

### 7.3 企业部署

- 前端静态资源由 Nginx 托管。
- Node 和 Python 分服务。
- PostgreSQL 替代 SQLite。
- 对象存储替代本地文件。
- 引入备份、日志、监控。

---

## 8. 最终验收清单

功能：

- 文档上传成功。
- 文档索引成功。
- 文档列表可查看。
- 问答可返回引用。
- 检索调试可查看 score。
- 系统设置可调整 TopK。
- 反馈可提交。

质量：

- 典型问题能命中正确文档。
- 无依据问题不编造。
- 安全问题回答保守。
- 引用来源可点击查看。

体验：

- UI 视觉统一。
- 响应式可用。
- 操作路径清晰。
- 错误提示明确。

运维：

- health endpoint 可用。
- 日志可查。
- 数据目录可备份。
- 环境变量配置完整。

