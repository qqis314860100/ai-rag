# 企业级 RAG 知识库数据库设计

版本：v1.0  
日期：2026-05-15  
默认数据库：SQLite  
企业扩展目标：PostgreSQL

---

## 1. 设计原则

- 业务元数据存储在关系数据库。
- 向量与 chunk 检索数据存储在 ChromaDB。
- 原始文件存储在本地文件系统，后续可替换为对象存储。
- 所有 JSON 字段在 SQLite 中使用 TEXT 保存。
- 所有时间字段使用 ISO 8601 字符串。
- 主键使用业务生成 ID，例如 `doc_001`、`msg_001`。
- 删除文档默认软删除，避免审计链断裂。

---

## 2. 表清单

| 表名 | 说明 |
|---|---|
| users | 用户 |
| roles | 角色 |
| role_permissions | 角色权限 |
| documents | 文档元数据 |
| document_versions | 文档版本 |
| document_jobs | 文档解析和索引任务 |
| chat_sessions | 问答会话 |
| chat_messages | 问答消息 |
| feedback | 用户反馈 |
| evaluation_sets | 评测集 |
| evaluation_questions | 评测问题 |
| evaluation_runs | 评测运行 |
| evaluation_results | 评测结果 |
| audit_logs | 审计日志 |
| settings | 系统设置 |

---

## 3. 枚举值

### 3.1 document.status

```text
active
archived
deleted
```

### 3.2 document.index_status

```text
pending
processing
ready
failed
```

### 3.3 security_level

```text
public
internal
confidential
restricted
```

### 3.4 feedback.status

```text
open
in_progress
resolved
ignored
```

### 3.5 job.status

```text
queued
running
success
failed
cancelled
```

---

## 4. SQLite DDL

### 4.1 users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
```

### 4.2 roles

```sql
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 4.3 role_permissions

```sql
CREATE TABLE role_permissions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(role_id, permission)
);

CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
```

### 4.4 documents

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  process TEXT,
  station TEXT,
  version TEXT NOT NULL DEFAULT 'v1.0',
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  security_level TEXT NOT NULL DEFAULT 'internal',
  tags_json TEXT NOT NULL DEFAULT '[]',
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_hash TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  index_status TEXT NOT NULL DEFAULT 'pending',
  index_error TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_documents_category ON documents(category);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_index_status ON documents(index_status);
CREATE INDEX idx_documents_security_level ON documents(security_level);
CREATE INDEX idx_documents_created_at ON documents(created_at);
```

### 4.5 document_versions

```sql
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT,
  change_note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(document_id, version)
);

CREATE INDEX idx_document_versions_document_id ON document_versions(document_id);
```

### 4.6 document_jobs

```sql
CREATE TABLE document_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  result_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_document_jobs_document_id ON document_jobs(document_id);
CREATE INDEX idx_document_jobs_status ON document_jobs(status);
```

### 4.7 chat_sessions

```sql
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_updated_at ON chat_sessions(updated_at);
```

### 4.8 chat_messages

```sql
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
```

### 4.9 feedback

```sql
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  reason TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  handled_by TEXT,
  handled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_feedback_message_id ON feedback(message_id);
CREATE INDEX idx_feedback_status ON feedback(status);
CREATE INDEX idx_feedback_rating ON feedback(rating);
```

### 4.10 evaluation_sets

```sql
CREATE TABLE evaluation_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 4.11 evaluation_questions

```sql
CREATE TABLE evaluation_questions (
  id TEXT PRIMARY KEY,
  evaluation_set_id TEXT NOT NULL,
  question TEXT NOT NULL,
  expected_answer TEXT,
  expected_documents_json TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_eval_questions_set_id ON evaluation_questions(evaluation_set_id);
```

### 4.12 evaluation_runs

```sql
CREATE TABLE evaluation_runs (
  id TEXT PRIMARY KEY,
  evaluation_set_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  finished_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_eval_runs_set_id ON evaluation_runs(evaluation_set_id);
CREATE INDEX idx_eval_runs_status ON evaluation_runs(status);
```

### 4.13 evaluation_results

```sql
CREATE TABLE evaluation_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  passed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_eval_results_run_id ON evaluation_results(run_id);
CREATE INDEX idx_eval_results_question_id ON evaluation_results(question_id);
```

### 4.14 audit_logs

```sql
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  operator_id TEXT,
  operator_name TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  user_agent TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_logs_operator_id ON audit_logs(operator_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
```

### 4.15 settings

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  description TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
```

---

## 5. ChromaDB 数据结构

### 5.1 Collection

```text
battery_line_knowledge_v1
```

### 5.2 ID

```text
chunk_doc001_0001
```

### 5.3 document

保存 chunk 正文。

### 5.4 metadata

```json
{
  "chunk_id": "chunk_doc001_0001",
  "document_id": "doc_001",
  "document_title": "极柱 Busbar 激光焊接",
  "category": "模组组装",
  "process": "Busbar Welding",
  "station": "MW-040",
  "section_path": "工艺参数控制",
  "page_number": 5,
  "security_level": "internal",
  "status": "active",
  "version": "v1.0",
  "tags": "激光焊接,Busbar,极柱"
}
```

---

## 6. 初始种子数据

### 6.1 默认角色

```sql
INSERT INTO roles (id, name, description, created_at, updated_at)
VALUES
('role_viewer', 'viewer', '只读用户', datetime('now'), datetime('now')),
('role_operator', 'operator', '产线操作员', datetime('now'), datetime('now')),
('role_process_engineer', 'process_engineer', '工艺工程师', datetime('now'), datetime('now')),
('role_equipment_engineer', 'equipment_engineer', '设备工程师', datetime('now'), datetime('now')),
('role_quality_engineer', 'quality_engineer', '质量工程师', datetime('now'), datetime('now')),
('role_knowledge_admin', 'knowledge_admin', '知识库管理员', datetime('now'), datetime('now')),
('role_system_admin', 'system_admin', '系统管理员', datetime('now'), datetime('now'));
```

### 6.2 默认设置

```sql
INSERT INTO settings (key, value, value_type, description, updated_at)
VALUES
('rag_top_k', '5', 'number', '默认检索 TopK', datetime('now')),
('rag_temperature', '0.2', 'number', '默认模型温度', datetime('now')),
('rag_max_context_chars', '12000', 'number', 'RAG 最大上下文字符数', datetime('now')),
('embedding_model', 'BAAI/bge-small-zh-v1.5', 'string', '默认 embedding 模型', datetime('now')),
('chroma_collection', 'battery_line_knowledge_v1', 'string', '默认 ChromaDB collection', datetime('now'));
```

---

## 7. 迁移建议

第一阶段可以直接使用 SQL 文件初始化 SQLite。

后续如迁移 PostgreSQL：

- `TEXT` JSON 字段改为 `JSONB`。
- 时间字段改为 `TIMESTAMPTZ`。
- 增加外键约束。
- 增加全文索引用于 BM25 或混合检索。
- 审计日志表按时间分区。

---

## 8. 数据库验收标准

- 可以保存 14 篇初始文档元数据。
- 可以记录每篇文档索引状态和 chunk 数。
- 可以保存完整问答会话和引用来源。
- 可以保存用户反馈。
- 可以保存审计日志。
- 可以支持评测集、评测运行和结果。
- ChromaDB metadata 能支持权限过滤和来源展示。

