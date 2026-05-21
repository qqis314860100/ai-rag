# 企业级 RAG 知识库 API 接口文档

版本：v1.0  
日期：2026-05-15  
关联文档：`enterprise-rag-kb-requirements.md`、`enterprise-rag-kb-architecture.md`

---

## 1. 接口总览

系统采用前端统一访问 Node.js API Gateway，Node.js 再调用 Python RAG Service 的双层接口设计。

对外接口前缀：

```text
/api
```

内部 RAG 接口前缀：

```text
/rag
```

接口类型：

- REST：文档、用户、设置、反馈、评测
- SSE：问答流式输出
- multipart/form-data：文件上传
- JSON：普通业务请求

---

## 2. 通用规范

### 2.1 请求头

```http
Authorization: Bearer <token>
Content-Type: application/json
X-Request-Id: optional-request-id
```

上传文件：

```http
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

### 2.2 通用成功响应

```json
{
  "data": {},
  "request_id": "req_001"
}
```

### 2.3 通用错误响应

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "当前用户无权限访问该资源。",
    "detail": {}
  },
  "request_id": "req_001"
}
```

### 2.4 分页格式

请求参数：

```text
page=1&page_size=20
```

响应格式：

```json
{
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 120,
      "total_pages": 6
    }
  }
}
```

---

## 3. 认证接口

### 3.1 登录

```text
POST /api/auth/login
```

请求：

```json
{
  "email": "engineer@example.com",
  "password": "password"
}
```

响应：

```json
{
  "data": {
    "token": "jwt-token",
    "user": {
      "id": "user_001",
      "name": "张工",
      "email": "engineer@example.com",
      "role": "process_engineer"
    }
  }
}
```

### 3.2 当前用户

```text
GET /api/auth/me
```

响应：

```json
{
  "data": {
    "id": "user_001",
    "name": "张工",
    "email": "engineer@example.com",
    "role": "process_engineer",
    "permissions": [
      "document.read",
      "document.upload",
      "chat.use",
      "search.debug"
    ]
  }
}
```

---

## 4. 文档接口

### 4.1 上传文档

```text
POST /api/documents/upload
```

Content-Type:

```text
multipart/form-data
```

字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| file | File | 是 | 文档文件 |
| title | string | 是 | 文档标题 |
| category | string | 是 | 分类 |
| process | string | 否 | 工序 |
| station | string | 否 | 工站 |
| version | string | 否 | 版本 |
| owner | string | 否 | 责任部门 |
| security_level | string | 是 | 安全等级 |
| tags | string | 否 | 逗号分隔标签 |

响应：

```json
{
  "data": {
    "document_id": "doc_001",
    "title": "极柱 Busbar 激光焊接",
    "index_status": "processing",
    "message": "文档已上传，正在构建索引。"
  }
}
```

### 4.2 文档列表

```text
GET /api/documents
```

查询参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| page | number | 页码 |
| page_size | number | 每页数量 |
| keyword | string | 标题关键词 |
| category | string | 分类 |
| status | string | active / archived / deleted |
| index_status | string | pending / processing / ready / failed |
| security_level | string | 文档安全等级 |

响应：

```json
{
  "data": {
    "items": [
      {
        "id": "doc_001",
        "title": "极柱 Busbar 激光焊接",
        "category": "模组组装",
        "process": "Busbar Welding",
        "version": "v1.0",
        "security_level": "internal",
        "status": "active",
        "index_status": "ready",
        "chunk_count": 36,
        "updated_at": "2026-05-15T10:00:00+08:00"
      }
    ],
    "pagination": {
      "page": 1,
      "page_size": 20,
      "total": 14,
      "total_pages": 1
    }
  }
}
```

### 4.3 文档详情

```text
GET /api/documents/:id
```

响应：

```json
{
  "data": {
    "id": "doc_001",
    "title": "极柱 Busbar 激光焊接",
    "category": "模组组装",
    "process": "Busbar Welding",
    "station": "MW-040",
    "version": "v1.0",
    "owner": "工艺工程部",
    "status": "active",
    "security_level": "internal",
    "tags": ["激光焊接", "Busbar", "极柱"],
    "file_type": "pdf",
    "chunk_count": 36,
    "index_status": "ready",
    "created_at": "2026-05-15T10:00:00+08:00",
    "updated_at": "2026-05-15T10:00:00+08:00"
  }
}
```

### 4.4 更新文档元数据

```text
PATCH /api/documents/:id
```

请求：

```json
{
  "title": "极柱 Busbar 激光焊接",
  "category": "模组组装",
  "tags": ["激光焊接", "Busbar", "质量检测"],
  "security_level": "internal"
}
```

响应：

```json
{
  "data": {
    "id": "doc_001",
    "updated": true
  }
}
```

### 4.5 重建单文档索引

```text
POST /api/documents/:id/reindex
```

响应：

```json
{
  "data": {
    "document_id": "doc_001",
    "index_status": "processing"
  }
}
```

### 4.6 全库重建索引

```text
POST /api/documents/rebuild-index
```

响应：

```json
{
  "data": {
    "job_id": "job_reindex_001",
    "status": "processing"
  }
}
```

### 4.7 删除文档

```text
DELETE /api/documents/:id
```

响应：

```json
{
  "data": {
    "id": "doc_001",
    "deleted": true
  }
}
```

---

## 5. 搜索接口

### 5.1 普通检索

```text
POST /api/search
```

请求：

```json
{
  "query": "Busbar 激光焊接有哪些关键参数？",
  "top_k": 5,
  "mode": "vector",
  "filters": {
    "category": "模组组装",
    "process": "Busbar Welding",
    "tags": ["激光焊接"]
  }
}
```

响应：

```json
{
  "data": {
    "query": "Busbar 激光焊接有哪些关键参数？",
    "results": [
      {
        "chunk_id": "chunk_doc001_0003",
        "document_id": "doc_001",
        "document_title": "极柱 Busbar 激光焊接",
        "section_path": "工艺参数控制",
        "page_number": 5,
        "content": "Busbar 激光焊接需要重点控制激光功率、焊接速度、焦距...",
        "score": 0.86,
        "metadata": {
          "category": "模组组装",
          "security_level": "internal"
        }
      }
    ],
    "latency_ms": 128
  }
}
```

### 5.2 检索调试

```text
POST /api/search/debug
```

请求：

```json
{
  "query": "CCD 检测频繁误判可能是什么原因？",
  "top_k": 8,
  "mode": "vector",
  "filters": {
    "category": "检测设备"
  },
  "include_prompt": true
}
```

响应：

```json
{
  "data": {
    "query": "CCD 检测频繁误判可能是什么原因？",
    "normalized_query": "CCD 检测 误判 原因 排查",
    "filters": {
      "category": "检测设备",
      "security_level": ["public", "internal"]
    },
    "retrieval": {
      "mode": "vector",
      "top_k": 8,
      "latency_ms": 142,
      "results": []
    },
    "prompt_preview": "你是企业电池产线知识库助手...",
    "context_chars": 9340,
    "estimated_tokens": 3100
  }
}
```

---

## 6. 问答接口

### 6.1 创建会话

```text
POST /api/chat/sessions
```

请求：

```json
{
  "title": "Busbar 焊接问题"
}
```

响应：

```json
{
  "data": {
    "id": "session_001",
    "title": "Busbar 焊接问题",
    "created_at": "2026-05-15T10:00:00+08:00"
  }
}
```

### 6.2 会话列表

```text
GET /api/chat/sessions
```

响应：

```json
{
  "data": {
    "items": [
      {
        "id": "session_001",
        "title": "Busbar 焊接问题",
        "updated_at": "2026-05-15T10:20:00+08:00"
      }
    ]
  }
}
```

### 6.3 会话详情

```text
GET /api/chat/sessions/:id
```

响应：

```json
{
  "data": {
    "id": "session_001",
    "title": "Busbar 焊接问题",
    "messages": [
      {
        "id": "msg_001",
        "role": "user",
        "content": "Busbar 激光焊接有哪些关键参数？",
        "created_at": "2026-05-15T10:01:00+08:00"
      },
      {
        "id": "msg_002",
        "role": "assistant",
        "content": "Busbar 激光焊接需要重点控制...",
        "sources": [],
        "created_at": "2026-05-15T10:01:05+08:00"
      }
    ]
  }
}

```

### 6.4 发送消息

```text
POST /api/chat
```

请求：

```json
{
  "session_id": "session_001",
  "message": "Busbar 激光焊接有哪些关键参数？",
  "top_k": 5,
  "filters": {
    "category": "模组组装"
  },
  "stream": false
}
```

响应：

```json
{
  "data": {
    "message_id": "msg_002",
    "answer": "Busbar 激光焊接需要重点控制激光功率、焊接速度、焦距、保护气体和夹具定位。对于虚焊、飞溅和焊偏等缺陷，应结合 CCD 检测和 EOL 测试结果进行确认。",
    "sources": [
      {
        "chunk_id": "chunk_doc001_0003",
        "document_id": "doc_001",
        "document_title": "极柱 Busbar 激光焊接",
        "section_path": "工艺参数控制",
        "page_number": 5,
        "score": 0.86,
        "snippet": "Busbar 激光焊接需要重点控制激光功率、焊接速度、焦距..."
      }
    ],
    "confidence": 0.82,
    "followups": [
      "Busbar 焊接常见缺陷有哪些？",
      "虚焊如何通过 CCD 检测识别？"
    ],
    "trace": {
      "retrieval_ms": 126,
      "llm_ms": 2410,
      "total_ms": 2612
    }
  }
}
```

### 6.5 流式问答

```text
POST /api/chat/stream
```

响应类型：

```text
text/event-stream
```

事件：

```text
event: sources
data: {"sources":[...]}

event: delta
data: {"text":"Busbar "}

event: delta
data: {"text":"激光焊接"}

event: done
data: {"message_id":"msg_002","confidence":0.82}
```

---

## 7. 反馈接口

### 7.1 提交反馈

```text
POST /api/feedback
```

请求：

```json
{
  "message_id": "msg_002",
  "rating": "down",
  "reason": "source_incorrect",
  "comment": "引用来源和问题不匹配。"
}
```

响应：

```json
{
  "data": {
    "id": "feedback_001",
    "status": "open"
  }
}
```

### 7.2 反馈列表

```text
GET /api/feedback
```

查询参数：

```text
status=open&rating=down&page=1&page_size=20
```

### 7.3 更新反馈状态

```text
PATCH /api/feedback/:id
```

请求：

```json
{
  "status": "resolved",
  "resolution": "已补充 Busbar 焊接参数文档。"
}
```

---

## 8. 评测接口

### 8.1 创建评测集

```text
POST /api/evaluations
```

请求：

```json
{
  "name": "电池产线 RAG 基准测试集",
  "description": "覆盖工艺、设备、检测、安全问题。"
}
```

### 8.2 导入评测问题

```text
POST /api/evaluations/:id/questions/import
```

请求：

```json
{
  "questions": [
    {
      "question": "模组 EOL 测试包含哪些项目？",
      "expected_answer": "应包含绝缘、耐压、通讯、采样等测试。",
      "expected_documents": ["模组 EOL 测试"],
      "category": "检测工序"
    }
  ]
}
```

### 8.3 运行评测

```text
POST /api/evaluations/:id/run
```

响应：

```json
{
  "data": {
    "run_id": "eval_run_001",
    "status": "running"
  }
}
```

### 8.4 评测结果

```text
GET /api/evaluations/:id/results
```

响应：

```json
{
  "data": {
    "summary": {
      "question_count": 100,
      "recall_at_5": 0.87,
      "citation_accuracy": 0.85,
      "answer_accuracy": 0.82,
      "hallucination_rate": 0.06
    },
    "items": []
  }
}
```

---

## 9. 管理接口

### 9.1 健康检查

```text
GET /api/admin/health
```

响应：

```json
{
  "data": {
    "status": "ok",
    "services": {
      "api": "ok",
      "rag": "ok",
      "chroma": "ok",
      "database": "ok",
      "llm": "ok"
    }
  }
}
```

### 9.2 索引状态

```text
GET /api/admin/index-status
```

响应：

```json
{
  "data": {
    "collection": "battery_line_knowledge_v1",
    "document_count": 14,
    "chunk_count": 520,
    "embedding_model": "BAAI/bge-small-zh-v1.5",
    "last_rebuild_at": "2026-05-15T12:00:00+08:00"
  }
}
```

### 9.3 系统设置

```text
GET /api/admin/settings
PATCH /api/admin/settings
```

更新请求：

```json
{
  "rag_top_k": 5,
  "rag_temperature": 0.2,
  "rag_max_context_chars": 12000,
  "deepseek_model": "deepseek-chat"
}
```

### 9.4 审计日志

```text
GET /api/admin/audit-logs
```

查询参数：

```text
action=document.upload&operator_id=user_001&page=1&page_size=20
```

---

## 10. Python RAG 内部接口

### 10.1 健康检查

```text
GET /rag/health
```

### 10.2 文档入库

```text
POST /rag/documents/ingest
```

请求：

```json
{
  "document_id": "doc_001",
  "file_path": "./data/uploads/doc_001.pdf",
  "metadata": {
    "title": "极柱 Busbar 激光焊接",
    "category": "模组组装",
    "security_level": "internal"
  }
}
```

响应：

```json
{
  "document_id": "doc_001",
  "chunk_count": 36,
  "index_status": "ready"
}
```

### 10.3 内部检索

```text
POST /rag/search
```

### 10.4 内部问答

```text
POST /rag/chat
```

请求：

```json
{
  "query": "Busbar 激光焊接有哪些关键参数？",
  "top_k": 5,
  "allowed_security_levels": ["public", "internal"],
  "filters": {
    "category": "模组组装"
  },
  "history": []
}
```

---

## 11. 权限矩阵

| 接口 | viewer | operator | engineer | knowledge_admin | system_admin |
|---|---:|---:|---:|---:|---:|
| GET /api/documents | 是 | 是 | 是 | 是 | 是 |
| POST /api/documents/upload | 否 | 否 | 是 | 是 | 是 |
| PATCH /api/documents/:id | 否 | 否 | 是 | 是 | 是 |
| DELETE /api/documents/:id | 否 | 否 | 否 | 是 | 是 |
| POST /api/chat | 是 | 是 | 是 | 是 | 是 |
| POST /api/search/debug | 否 | 否 | 是 | 是 | 是 |
| GET /api/admin/audit-logs | 否 | 否 | 否 | 否 | 是 |
| PATCH /api/admin/settings | 否 | 否 | 否 | 否 | 是 |

---

## 12. API 验收标准

- 所有接口返回统一格式。
- 所有写接口必须记录审计日志。
- 所有文档和检索接口必须应用权限过滤。
- 问答接口必须返回 sources。
- 检索调试接口必须返回 score 和 chunk 原文。
- 上传接口必须支持异步索引状态。
- API Key 不得出现在任何前端响应中。

