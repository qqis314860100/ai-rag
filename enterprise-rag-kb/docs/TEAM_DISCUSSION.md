# RAG 知识库平台 — 架构讨论与决策汇总

> 日期：2026-05-22 | 用途：团队对齐 / 方案评审 / 个人参考

## 1. 背景

公司现有 **EP (Rosefinch)** 平台，Java 后端 + Umi4/React 前端，面向 CATL 电池产线做传统文件管理（CRUD + 关键词搜索 + S3存储 + Rosefinch 认证）。搜索机制为文件名/标签/分类匹配，不支持内容级检索。

另有一份 `ep-front.md` 文档，描述了给 EP 平台叠加 RAG 能力的完整计划（Java→Python RAG 微服务架构，4 阶段路线图）。

我们已有 `enterprise-rag-kb` 项目，Node.js + Python RAG，跑通全链路，可作为 Demo 或演进基础。

**核心问题：这三个东西怎么整合？技术路线选哪条？**

---

## 2. 现有系统对比

### 2.1 ep-front.md 规划 vs enterprise-rag-kb 现状

| 维度 | ep-front.md 规划 | enterprise-rag-kb 现状 |
|------|-----------------|----------------------|
| 后端语言 | **Java** (Rosefinch 已有) | **Node.js/Express** |
| 前端框架 | Umi4 + React | React 19 + Vite + TailwindCSS |
| 业务数据库 | PostgreSQL | SQLite（可随时迁PG） |
| 向量数据库 | pgvector / Milvus | ChromaDB |
| AI 网关 | Java 透传 (WebFlux) | Express 透传 |
| 文档解析 | PyMuPDF + python-docx + PaddleOCR | ✅ 同方案（OCR未接入） |
| 分块策略 | 500 tokens / 50 overlap | ✅ 同方案 |
| Embedding | 公司AI平台 / bge-large-zh | BAAI/bge-small-zh-v1.5 |
| LLM | 公司内部模型 | DeepSeek API（可切换） |
| .x_t 支持 | 仅文件头+零件编号 | ✅ 已标记待启用（同方案） |
| 流式SSE | ✅ | ✅ 已实现 |
| 用户认证 | Rosefinch SSO | JWT + bcrypt（可对接SSO） |
| 权限模型 | 文件级可见范围 | security_level + RBAC |
| 聊天会话 | 规划新增 | ✅ 已实现（session+messages+sources） |
| 对话反馈 | — | ✅ 已实现（up/down+reason+处理） |
| 文档评论 | — | ✅ 已实现（chunk级+嵌套回复） |
| 审计日志 | — | ✅ 已实现 |
| Agent扩展 | — | ✅ 表结构已预留 |

**结论：enterprise-rag-kb 在 AI 能力上已经覆盖了 ep-front.md 第一阶段的全部 + 第二阶段的对话部分，且多了反馈、评论、审计、Agent预留等能力。**

---

## 3. 后端架构选型讨论

### 3.1 三种方案对比

```
方案 A: Java 做网关透传（ep-front.md 原方案）
方案 B: 前端直连 RAG（省事但有权限问题）
方案 C: Express 做 BFF 聚合层（保留现在架构）
```

```
方案 A:          方案 B:             方案 C (当前):
────────         ────────            ────────────
EP前端           EP前端              任意前端
  │                │    ╲               │
  ▼                ▼      ▼             ▼
Java EP          Java EP  Python RAG   Express BFF
  │   ╲            (文件)  (AI)         │    ╲
  ▼     ▼                              ▼      ▼
Python RAG  PG                    Python RAG  SQLite
```

详细对比：

| 维度 | 方案A (Java透传) | 方案B (前端直连) | 方案C (Node BFF) |
|------|-----------------|-----------------|------------------|
| Java改动量 | 3个透传端点 + 2张表 | 仅上传后调ingest | 不动 |
| 权限控制 | Java全权控制 | 需JWT共享或RAG回调 | Express全权控制 |
| 前端改动 | 中（加AI UI） | 大（需直管两套认证） | 小（现有即可用） |
| SSE性能 | Java WebFlux透传+20ms | 直连最优 | Express透传+5ms |
| 团队依赖 | 需要Java团队 | 需要Java团队配合 | Node团队独立 |
| 技术栈统一 | 前后端异构 | 前后端异构 | 全栈TypeScript |
| 可嵌入性 | 一般（依赖Java） | 差（认证碎片） | 好（独立部署） |
| 公司合规 | 无阻力 | 可能受阻 | 需确认Node可用 |

### 3.2 Java 透传 SSE 的延迟分析

```
用户提问 → Java → Python RAG → LLM → Java → 前端

环节              耗时          累计
Token验证         < 5ms         5ms
权限查PG          10-30ms       35ms
网络(Java→RAG)    1-3ms         38ms
RAG检索           100-500ms     538ms
LLM首字           ~1500ms       2038ms
SSE透传返回       0（chunk直通） 2038ms
```

**结论：Java 透传比直连多 ~40ms，用户无感知（LLM推理占了95%的时间）。** 真正的代价不是延迟，而是连接管理复杂度（100并发用户 = 200 SSE长连接挂在Java上），但 WebFlux 非阻塞IO可以轻松应对。

### 3.3 最终建议：方案 C（Node.js BFF）

**理由：**
- enterprise-rag-kb 的 Express 层已经承载了70%的业务逻辑，丢弃重写不经济
- 50-200 用户规模，Node.js 单进程完全胜任
- 全栈 TypeScript 开发效率远高于 Java ↔ Python 异构对接
- RAG 服务保持无状态，可被任何语言的后端调用（包括未来的Java）

**Java EP 的定位：** 如果公司强制要求，可以后续改为"Java 做文件管理 + Node 做 AI 编排"的双后端模式，两者通过 REST 协作，不互相侵入。

---

## 4. 权限方案讨论

### 核心结论：认证逻辑在网关层，RAG不感知用户

```
用户请求 → Express/JWT中间件解密Token → 提取user_id + role
         → 查用户可见的安全等级 (security_level)
         → 组装 allowed_security_levels: ["internal","confidential"]
         → 透传到 RAG
         → RAG检索时: where security_level IN allowed_security_levels
```

**RAG 端不存用户、不管认证、不拿Token。** 只接收一个白名单数组做检索过滤。

这样做的好处：
1. 安全审计简单（认证点只有一个）
2. RAG 可以单独部署、单独扩容、单独测试
3. 未来换LLM/向量库/Embedding模型都不影响权限逻辑

---

## 5. 用户系统与对话记录

### 决定：全放在 API 网关层（Express/Java），RAG 无状态

| 数据 | 存储位置 | 理由 |
|------|---------|------|
| 用户/角色/权限 | SQLite (→PG) | 与RAG无关 |
| 文档元数据 | SQLite (→PG) | 文件管理归属 |
| 聊天会话/消息 | SQLite (→PG) | 需关联user_id，审计需要 |
| 引用来源 | SQLite (message_sources) | 结构化查询方便 |
| 反馈 | SQLite | 需关联user_id |
| 审计日志 | SQLite | 合规需求 |
| 文本向量/chunks | ChromaDB | RAG独有数据 |
| RAG配置 | SQLite settings表 + .env | 在线可调 |

---

## 6. 存量数据迁移

### 当前方案（已实现）

```typescript
// POST /api/documents/sync-from-rag
// 从 ChromaDB 拉取已索引文档列表，同步到 SQLite documents 表
// 适用于：RAG 侧已有数据（通过脚本批量导入），需要在前端文件管理页展示
```

### 反向方案（EP 场景）

```
Java PG 导出现有文档列表 → 批量调 POST /rag/documents/ingest → ChromaDB

文件量     并发     预计耗时
< 1,000     4       < 30分钟
1k-5k       8       1-3小时
> 10k      16       半天
```

提供断点续跑（记录已处理的 document_id，中断可继续）。

---

## 7. Java vs Node.js 全面对比

| 维度 | Node.js/Express | Java/Spring | 评判 |
|------|----------------|-------------|------|
| AI生态集成 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | SSE/流式Node天然优势 |
| 开发效率 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 全栈TypeScript |
| 现有代码复用 | ⭐⭐⭐⭐⭐ (70%已就绪) | ⭐ (需从零写) | — |
| 公司合规 | ⚠️ 需确认 | ✅ 无阻力 | — |
| 50-200人负载 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 都足够 |
| 文件上传/IO | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 同等水平 |
| 数据库 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | SQLite→PG零成本 |
| 运维复杂度 | ⭐⭐⭐⭐ (轻) | ⭐⭐⭐ (重) | — |
| 招聘/接手 | 容易 | 需要Java工程师 | — |

**结论：没有技术理由必须用 Java 做 AI 网关。唯一的阻力是公司技术栈规定。**

---

## 8. 关键决策记录

| # | 决策 | 结论 | 理由 |
|---|------|------|------|
| 1 | AI网关用什么 | **Node.js/Express** | 已有实现，全栈TypeScript，高效迭代 |
| 2 | RAG服务定位 | **无状态AI引擎** | 不感知用户、不存业务数据、可嵌入任意系统 |
| 3 | 权限放哪 | **网关层（Express/Java）** | 认证点单一，审计清晰 |
| 4 | 向量数据库 | **ChromaDB（当前）** | 轻量免运维；后续可选pgvector |
| 5 | LLM | **DeepSeek（当前）→ 公司内部模型（未来）** | 先跑通再切换 |
| 6 | RAG框架 | **自建管道** | 灵活可控，避免LangChain抽象开销 |
| 7 | 流式 or 非流式 | **SSE流式** | 用户体验好，首字延迟低 |
| 8 | .x_t全文切片 | **第一版不做** | 用户提问与坐标数据不匹配，ROI低 |
| 9 | 对话记录 | **存网关层SQLite/PG** | 需关联user_id |
| 10 | 数据库 | **SQLite → 后期可选PG** | 当前数据量小，零运维 |

---

## 9. 待讨论的开放问题

1. **公司技术栈规定** — Node.js 后端能否过安全审查？是否有硬性 Java 要求？
2. **Rosefinch SSO 对接方式** — 是标准 OIDC/SAML 还是定制协议？Express 侧对接成本多大？
3. **企业 AI 平台接口** — 公司内部模型 API 的协议是什么？OpenAI 兼容吗？Embedding 接口呢？
4. **文件存储** — 是否必须用 S3？当前本地 `data/uploads/` 在生产环境是否可接受？
5. **部署环境** — 内网 Docker/K8s？还是裸机？Python + Node 双运行时运维是否接受？
6. **现有 EP 前端** — 是直接在 EP 代码库里加 AI 页面，还是独立部署我们的前端？
7. **数据库选择** — 生产环境 SQLite 是否可接受？还是必须迁移 PostgreSQL？

---

## 10. 推荐的演进路径

```
现在 ──→ 短期（1-2月）──→ 中期（3-6月）──→ 长期
 │            │                 │               │
 │  完善Demo   │  内部试用       │  对标EP        │  平台化
 │  - 文档评论 │  - 导入真实文档  │  - 对接SSO     │  - 多租户
 │  - .x_t解析│  - 收集反馈     │  - S3存储      │  - pgvector
 │  - 搜索页UI│  - 调优检索质量  │  - PG迁移      │  - 报告生成
 │            │                │  - EP前端嵌入   │  - 效果评估
```

**当前阶段目标：把 Demo 做到可演示可试用，同时架构上保持"可嵌入"能力，不锁定到任何特定系统。**
