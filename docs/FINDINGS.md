# ai-rag 项目审查报告（找茬）

> 审查日期：2026-05-23
> 审查范围：`web/`（React 19 + Vite）、`api/`（Express + SQLite）、`rag/`（FastAPI + ChromaDB）全量代码
> 审查方式：静态代码审查 + 依赖/配置核对（未启动真实服务复现，修复时逐项验证）

---

## 0. 结论摘要

| 严重度 | 数量 | 说明 |
|--------|------|------|
| 🔴 严重 (P0) | 8 | 认证绕过、越权读敏感文档、任意文件读取、跨服务无鉴权 |
| 🟠 高危 (P1) | 10 | 未授权会话访问、无限流、上传校验缺陷、功能未落地 |
| 🟡 中危 (P2) | 9 | 竞态、配置不一致、静默吞错、健康检查失真 |
| 🟢 低危 (P3) | 8 | 死代码、文档漂移、依赖未固定 |

共 **35 项**。其中与既有 `docs/security/security-review.md` 重叠的 P0 项（如 header 伪造、RAG 无鉴权）**此前报告后并未修复**，本次一并修复。

---

## 1. 🔴 严重 (P0)

### P0-1 认证可被完全绕过：未认证请求默认获得 system_admin
- **位置**：`api/src/middleware/auth.ts:78-133`（`extractUser`）
- **问题**：无 `Authorization` 头时，直接查库取 `system`/`admin` 用户并赋 `system_admin` 角色；该逻辑**不区分 NODE_ENV**，注释写"dev mode"但生产同样生效。只要生产忘记配置网关注入认证，所有请求即为最高权限。
- **影响**：全站 RBAC 形同虚设；审计日志中的操作人全部是 admin。
- **建议**：生产环境仅信任 JWT；开发环境保留降级但以 `NODE_ENV !== "production"` 硬门禁。

### P0-2 角色伪造：`X-User-Id` / `X-User-Role` 请求头无签名直接信任
- **位置**：`api/src/middleware/auth.ts:99-111`
- **问题**：任何客户端可发 `x-user-role: system_admin` 提权；JWT 校验失败后也会"fall through"到 header 模式，等于 JWT 形同虚设。
- **建议**：仅开发环境允许 header 认证；生产删除该分支。

### P0-3 硬编码 JWT 密钥，且 .env.example 无 JWT_SECRET
- **位置**：`api/src/middleware/auth.ts:83`、`api/src/middleware/jwtAuth.ts:6`
- **问题**：`JWT_SECRET || "battery-kb-dev-secret-key-change-in-prod"` 两处硬编码；`.env.example` 根本没有 `JWT_SECRET` 项 → 生产必然使用公开可猜的密钥，任何人都能签发任意角色 Token。
- **建议**：生产缺少 `JWT_SECRET` 直接拒绝启动；`.env.example` 补项；两个文件统一从 config 读取。

### P0-4 文档越权读取：无安全等级过滤
- **位置**：`api/src/routes/documents.ts:84-126, 284-300, 423-514`、`api/src/db/documents.ts:55-103`
- **问题**：`GET /api/documents`、`/documents/:id`、`/documents/:id/raw`、`/documents/:id/file`、`/documents/chunks/:chunk_id` 均不检查请求用户 `allowedSecurityLevels`。`viewer`（仅 public）可下载 confidential/restricted 文档的**全文内容**，安全等级体系完全失效。
- **建议**：所有文档读取入口按 `d.security_level IN (allowed)` 过滤；越权返回 403。

### P0-5 任意文件读取：`/documents/:id/raw` 路径穿越
- **位置**：`api/src/routes/documents.ts:440-449`
- **问题**：`section_path` 来自查询参数，`path.join(knowledgeDir, docName + ext)` 未校验，`docName="../../../../etc"` 可读取系统任意 `.md/.txt/.markdown` 文件；fuzzy 匹配分支还会全目录扫描。
- **建议**：`realpath` 后校验前缀必须落在 `knowledgeDir`/`uploadDir` 内；禁止 `..` 穿越。

### P0-6 RAG 服务无鉴权 + `file_path` 任意文件读取
- **位置**：`rag/app/main.py:13-19`、`rag/app/api/routes.py:70-99`、`rag/app/schemas/models.py:13-16`
- **问题**：RAG 无任何认证；`/rag/documents/ingest` 的 `file_path` 直接交给 parser 读取，攻击者可在内网直接调用并把 `/etc/passwd`、`.env` 等文件内容向量化后通过 `/rag/search` 读出；`allowed_security_levels` 也由调用方随意传。
- **建议**：API↔RAG 共享密钥（`X-API-Key`）；`file_path` 白名单目录校验（realpath 前缀）。

### P0-7 会话 IDOR：任意用户可读写删他人会话
- **位置**：`api/src/routes/chat.ts:251-404`
- **问题**：`GET/PATCH/DELETE /chat/sessions/:id`、`GET /chat/sessions/:id/messages`、`DELETE /chat/messages/:id`（部分）无 `user_id` 归属校验。知道他人 session id 即可读全部聊天内容、改标题、删会话。
- **建议**：统一 `assertSessionOwner(req, session)` 中间件；管理员例外。

### P0-8 统计面板泄露他人会话与查询内容
- **位置**：`api/src/routes/stats.ts:9-45`
- **问题**：`GET /api/stats/dashboard` 无任何鉴权，返回所有用户的会话标题、用户提问原文（含工艺参数等敏感信息）。
- **建议**：至少要求登录；敏感字段（popularQueries）仅 system_admin 可见。

---

## 2. 🟠 高危 (P1)

### P1-1 无速率限制，LLM 成本可被刷爆
- **位置**：`api/src/server.ts:23-48`（无 rate-limit 中间件）
- **影响**：暴力调用 `/api/chat` 耗尽 DeepSeek 配额；登录接口可撞库。
- **建议**：`express-rate-limit`：全局限流 + 登录/聊天/上传差异化限流。

### P1-2 聊天/搜索等核心接口无强制鉴权
- **位置**：`api/src/routes/chat.ts:14`、`search.ts:11`、`favorites.ts`、`feedback.ts:12`、`stats.ts`
- **问题**：依赖 `req.user?.id || "anonymous"`，未用 `requireAuth`；配合 P0-1 等于匿名即管理员。
- **建议**：核心读写接口挂 `requireAuth`（健康检查除外）。

### P1-3 前端「编辑消息」未持久化（伪功能）
- **位置**：`web/src/pages/ChatPage.tsx:328-334`
- **问题**：`handleEditUser` 只做本地 `setMessages(slice)` + 重发，**从未调用** `PATCH /api/chat/messages/:id`（该端点已实现却无人调用）；刷新后编辑丢失，且旧消息仍留在数据库，重发造成重复上下文。
- **建议**：PATCH 持久化 + 截断后续消息 + 原地再生（POST /chat 支持 `message_id` 原位更新）。

### P1-4 设置页「用户角色修改」无后端路由（假功能）
- **位置**：`web/src/pages/SettingsPage.tsx:73` 调用 `PUT /users/:id`；`api/src/routes/auth.ts` 只有 `GET /users`
- **问题**：前端已实现角色下拉，后端无对应路由 → 保存必然 404。
- **建议**：实现 `PUT /api/users/:id`（角色/状态），仅 `settings.update` 权限可调用。

### P1-5 上传校验缺陷：扩展名与 MIME 用 OR、无魔数、无 hash
- **位置**：`api/src/routes/documents.ts:62-70, 150-164`
- **问题**：扩展名 OR MIME 任一通过即放行；`security_level` 未校验枚举（可上传 restricted 标记文档）；`file_hash` 从不计算（字段恒为 null）。
- **建议**：AND 校验 + 魔数嗅探 + SHA-256 哈希 + security_level 白名单 + 上传前查重。

### P1-6 `sync-from-rag` 无权限校验 + 「最新一条」竞态
- **位置**：`api/src/routes/documents.ts:517-591`
- **问题**：任何人可触发同步；用 `ORDER BY created_at DESC LIMIT 1` 回填 RAG document_id，并发上传时可能改错行。
- **建议**：挂 `document.reindex` 权限；改为按 title 精确匹配回填，或直接以 RAG document_id 创建。

### P1-7 流式聊天：客户端断开不中断上游、失败静默
- **位置**：`api/src/routes/chat.ts:52-152`
- **问题**：无 `req.on("close")` 处理，客户端断开后仍读完整个 RAG 流并落库（浪费 LLM 费用）；流中途出错只 `res.end()`，不向客户端发错误事件；`streamFailed` 后用户消息已落库但无助手回复。
- **建议**：监听 close → abort 上游 fetch；错误时向客户端发 `error` 事件；记录明确状态。

### P1-8 流式/非流式 RAG 行为不一致
- **位置**：`rag/app/api/routes.py:155-197` vs `rag/app/core/pipeline.py:151-201`
- **问题**：非流式 `chat` 有 `_rewrite_query` + `_keyword_rerank`，流式 `chat_stream` 直接 `pipeline.search(...)`，同一问题两种答案质量不同。
- **建议**：抽出公共 `_retrieve(query, ...)` 供两条路径共用。

### P1-9 RAG 错误响应泄露内部细节
- **位置**：`rag/app/api/routes.py:67, 83, 99, 114, 130, 146`
- **问题**：`HTTPException(500, detail=str(e))` 把文件路径、库版本、堆栈原样返回客户端。
- **建议**：500 统一返回通用信息，详情只进日志。

### P1-10 无 CSRF / 安全头 / HTTPS 强制
- **位置**：`api/src/server.ts`（无 helmet）
- **建议**：helmet 默认头 + CORS 白名单环境变量化。

---

## 3. 🟡 中危 (P2)

| # | 位置 | 问题 |
|---|------|------|
| P2-1 | `api/src/routes/chat.ts:22` | 消息无长度上限（1MB 请求体可全塞进 prompt，浪费 token） |
| P2-2 | `api/src/routes/documents.ts:94-96`、`feedback.ts`、`admin.ts:72` | page/page_size 无边界校验（负 offset、超大 pageSize） |
| P2-3 | `api/src/routes/admin.ts:36-42` | 设置项无值域校验（rag_top_k 可为 -1、temperature 可为 99） |
| P2-4 | `api/src/services/auditService.ts:39-41` | 审计写入失败静默吞掉，无日志无告警 |
| P2-5 | `api/src/routes/documents.ts:204, 431` | `formatDocument` 暴露服务器绝对路径 `file_path` 给所有用户 |
| P2-6 | `rag/app/core/config.py:14-35` | RAG 直接读 API 的 SQLite 文件（跨服务 DB 耦合），违反"RAG 无状态"边界；且设置只在启动时加载，"在线调整"需重启（UI 有说明但架构不干净） |
| P2-7 | `rag/app/main.py:11` + `routes.py:18` | `pipeline = RagPipeline()` 导入即初始化；health 的 `chroma_status` 恒为 "ok" 不探测；embedding 降级到 hash 模式后 health 无任何标记 |
| P2-8 | `api/src/routes/documents.ts:52-79` | multer 文件名 `uuid+ext`，但上传后 `file_name` 存原始文件名且无扩展名/大小/内容一致性校验 |
| P2-9 | `rag/app/llm/client.py:84-94` | 非流式 LLM 出错时**静默降级为 mock 答案**（[Mock LLM - API Error]），工程场景下伪造内容风险高；应显式失败或降级开关 |
| P2-10 | `rag/app/llm/client.py:96-157` | 流式无重试（429/5xx 直接失败）、无 max_tokens 上限 |
| P2-11 | `rag/app/retrieval/vector_store.py:159-160` | `_get_collection` 全局单例无异常恢复，Chroma 重启后 `_collection` 失效 |
| P2-12 | `web/src/pages/ChatPage.tsx:267-273` | 删除会话前无确认（误删不可恢复） |
| P2-13 | `api/src/db/index.ts:381-393` | 预置账号 admin123/editor123/viewer123 弱口令 + 登录页明文展示，生产必须改密 |
| P2-14 | `api/src/middleware/jwtAuth.ts:7` | Token 24h 无刷新机制、无吊销；用户角色变更后旧 Token 仍有效 |

---

## 4. 🟢 低危 (P3)

| # | 位置 | 问题 |
|---|------|------|
| P3-1 | `rag/app/chunking/chunker.py:44-48, 181-185` | `_find_section_text` 死代码（赋值后从未使用）；段落循环重复扫描 sections O(n·m) |
| P3-2 | `rag/app/cleaning/cleaner.py:18, 21-24` | `_EMPTY_LINE_RE`、`_FULLWIDTH_MAP` 未使用 |
| P3-3 | `rag/app/parsers/text.py:23` | 运算符优先级 bug：sections 为空时即使 metadata 有 title 也返回空标题 |
| P3-4 | `rag/app/schemas/models.py:110-111, 55` | `ChatRequest.session_id/stream`、`SearchRequest.mode` 死字段 |
| P3-5 | `web/package.json:9` dev 脚本 `--port 5173` 与 `vite.config.ts:14` 端口 5174、README、API CORS（5174）不一致 |
| P3-6 | `web/src/services/api.ts:8-11` | headers 合并顺序 bug：`{headers, ...options}` 中 options.headers 会整体覆盖（上传分支丢失 Authorization/Content-Type） |
| P3-7 | `web/src` | 磁盘残留约 40 个已 gitignore 的编译产物 `.js`（main.js、App.js 等），易误导 |
| P3-8 | `rag/pyproject.toml` | `httpx`、`markdown-it-py`、`python-multipart` 未被使用；`rag/app/evaluation/`、`rag/evals/` 空目录 |
| P3-9 | 全仓 | 依赖未锁精确版本（api/web 均 ^），无 `npm audit`/`pip-audit` 环节；CI 只有 build+lint，无测试 |
| P3-10 | `docs/PRODUCT_SPEC.md` | 大量过时路径（apps/web、services/rag、enterprise-rag-kb），与扁平结构不符；「用户管理 ✅」实际是假功能（P1-4） |
| P3-11 | `.env.example` | 缺少 `JWT_SECRET`、`CORS_ORIGINS`、`RAG_API_KEY`、`LLM_*` 部分项与 rag 配置不一致（RAG_PORT 未用，实际 8000） |

---

## 5. 亮点（做得好的部分）

1. RBAC 模型（角色→权限→安全等级）设计清晰，链路贯通到 ChromaDB 过滤
2. Prompt 注入防护：上下文明确"不作为系统指令"
3. 上传文件名 UUID 化防穿越、错误统一 envelope（`{error:{code,message}}`）
4. 审计覆盖所有写操作；日志含 requestId
5. 前端打字机/流式体验实现较完整，草稿、收藏、反馈闭环
6. 已具备基础 CI（GitHub Actions）+ harness 脚本 + commitlint 强制规范

---

## 6. 修复计划与状态（2026-05-23 更新）

| 服务 | 提交 | 内容 | 状态 |
|------|------|------|------|
| api | `dbca33c` | P0-1/2/3 认证加固（生产仅 JWT、JWT_SECRET 缺失拒启）、P1-10 helmet/CORS 白名单/限流、P2-14 简化、畸形 JSON 400 | ✅ 已修复并验证 |
| api | `dbca33c` | P0-4 文档安全等级过滤、P0-5 路径穿越修复、P2-5 file_path 脱敏、P1-5 上传魔数/AND 校验/hash/枚举、P1-6 sync 权限与按标题回填、P1-7 流式中断中止上游、P1-4 PUT /users/:id、P2-1/2/3/4 校验与审计日志、chat 原地再生、测试脚本 JWT 化 | ✅ 已修复并验证 |
| rag | `fd9f47d` | P0-6 API Key 鉴权 + file_path 白名单、P1-9 错误脱敏、P1-8 流式/非流式检索一致性（retrieve 共用）、P2-9 LLM 失败显式抛错、P2-7 health 真实探测（chroma/embedding_mode）、P3-1/2/3/4 死代码与优先级 bug、ruff 全量通过 | ✅ 已修复并验证 |
| web | `9f0716d` | P1-3 编辑消息持久化再生、P3-6 api.ts 请求头合并、401 跳登录、P2-12 删除确认、P3-5 端口统一、P3-7 清理残留 js | ✅ 已修复并验证（构建+接口级；浏览器走查待补） |
| chore | `a925a63` / `7c30aa0` | pnpm 构建配置修复与依赖锁定；.env.example 补充 JWT_SECRET/CORS_ORIGINS/RAG_API_KEY 并对齐端口；api 生产打包（esbuild CJS bundle）修复 `start` 脚本 | ✅ 已修复并验证 |
| docs | 本轮 | 本报告 + 标准 PRD（docs/PRD.md） | ✅ 已完成 |

**已验证**：`pnpm build:web`、`pnpm build:api`、`node dist/server.cjs`（生产模式）、`api/tests/run-tests.sh`（6/6）、`api/tests/security/security-tests.sh`（16P/3W/0F，W 均为开发模式降级项，生产 strict 模式通过）、RAG ruff+compileall、鉴权/越权/穿越/魔数/限流/再生/生产 401 等逐项 curl 验证。

**未修复（列入 PRD 路线图）**：异步任务队列、S3 存储、SSO、多租户、OCR、数据库迁移框架、单元测试体系、消息加密、Token 刷新与吊销、弱口令强制改密。
