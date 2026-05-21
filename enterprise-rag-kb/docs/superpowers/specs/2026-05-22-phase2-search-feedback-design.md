# Phase 2: 知识质量 — 混合检索 + 反馈闭环

**日期**: 2026-05-22
**状态**: Draft
**范围**: 混合检索 (BM25 + 向量)、检索高亮、答案反馈、知识时效

---

## 1. 混合检索

### 1.1 当前状态

仅向量检索 (ChromaDB cosine similarity)，问题：
- 专业术语/编号（如"MW-030"、"CS-010"）向量语义弱
- 短查询（"OEE"、"CPK"）缺乏上下文

### 1.2 方案：向量 + BM25 混合检索 + RRF 融合

**BM25 关键词检索**：
- 在 ChromaDB 已有 chunk 上，用内存 BM25（`rank_bm25` 库）对 `documents` 字段建索引
- 每次搜索同时跑向量检索 + BM25 检索，各自返回 top_k * 2 结果
- 用 RRF（Reciprocal Rank Fusion）融合两个结果列表：
  ```
  RRF_score(d) = 1/(k + rank_vector(d)) + 1/(k + rank_bm25(d))
  ```
  k=60，最终取 top_k

### 1.3 实现

- RAG Pipeline 新增 `search_hybrid()` 方法
- 检索接口新增 `mode` 参数：`vector` | `keyword` | `hybrid`（默认）
- BM25 索引在 document upsert 时同步更新
- ChromaDB 的 `documents` 字段已有全文，直接用

### 1.4 文件变更

| 文件 | 改动 |
|------|------|
| `services/rag/app/retrieval/bm25.py` | **新建** — BM25 索引类 |
| `services/rag/app/retrieval/vector_store.py` | 新增 `search_keyword()` 方法 |
| `services/rag/app/retrieval/fusion.py` | **新建** — RRF 融合算法 |
| `services/rag/app/core/pipeline.py` | 新增 `search_hybrid()` |
| `services/rag/app/api/routes.py` | 更新 search 端点支持 `mode=hybrid` |

---

## 2. 检索高亮

### 2.1 方案

搜索返回结果时，在 `content` 字段中标记命中关键词：
```
...电芯<mark>分选</mark>是动力电池 Pack 生产线的第一道核心工序...
```

- 前端用 `dangerouslySetInnerHTML` 渲染（已做 XSS 防护的 mark 标签）
- 高亮 CSS: `bg-warning-soft text-warning rounded px-0.5`

### 2.2 实现

- RAG 检索结果新增 `highlights` 字段（原 content + mark 包裹的关键词）
- 前端 `MarkdownContent` 支持 `highlights` prop

---

## 3. 答案反馈闭环

### 3.1 当前状态

前端有 👍/👎 按钮但未接通后端。feedback 路由存在但未完善。

### 3.2 增强功能

| 功能 | 说明 |
|------|------|
| **踩了必问原因** | 点 👎 弹出原因选择：不准确 / 已过时 / 不完整 / 不理解问题 |
| **反馈列表** | admin 可查看全部反馈，按状态/时间筛选 |
| **反馈统计** | Dashboard 加反馈趋势图、高频踩文档 top 5 |
| **知识缺口** | 多次反馈"不完整"的查询 → 自动标记为知识缺口 |
| **通知** | 收到 👎 时通知管理员（简单：轮询或 Dashboard 红点） |

### 3.3 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/feedback` | POST | 提交反馈（message_id, rating, reason, comment） |
| `/api/feedback` | GET | 反馈列表（支持 status/rating 筛选） |
| `/api/feedback/:id` | PATCH | 更新状态 (open→in_progress→resolved) |
| `/api/feedback/stats` | GET | 反馈统计（总数、趋势、top issues） |

---

## 4. 文档时效管理

### 4.1 方案

- 上传文档时可选设 `expires_at` 过期时间
- 过期前 7 天 Dashboard 显示提醒："X 篇文档即将过期"
- 过期文档在搜索结果中标记 ⚠️ "内容可能已过时"
- 管理员可批量延期或下架过期文档

### 4.2 数据模型

```sql
ALTER TABLE documents ADD COLUMN expires_at TEXT;
ALTER TABLE documents ADD COLUMN review_cycle_days INTEGER DEFAULT 90;
```

---

## 5. 实现顺序

1. BM25 索引 + 混合检索 + RRF
2. 检索高亮
3. 反馈弹窗 + 保存
4. 反馈统计 Dashboard
5. 文档时效
