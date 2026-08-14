# 电池产线 RAG 知识库平台 — 产品需求文档 (PRD)

| 项 | 内容 |
|----|------|
| 文档版本 | v1.0 |
| 状态 | 已评审待开发 / 迭代中 |
| 产品负责人 | — |
| 技术负责人 | — |
| 关联文档 | [PRODUCT_SPEC.md](./PRODUCT_SPEC.md)（实施规格）、[FINDINGS.md](./FINDINGS.md)（审查报告）、[ARCHITECTURE.md](./ARCHITECTURE.md) |

---

## 1. 背景与目标

### 1.1 背景

公司现有 EP（Rosefinch）平台以文件管理为主，仅支持关键词+筛选项匹配，无法进行内容级检索。产线工程师查找工艺参数、故障处理、设备维护知识依赖人工翻阅 PDF/Word 文档，效率低且不可追溯。

### 1.2 产品目标

构建一套可独立部署、可嵌入 EP 的 **RAG 知识库平台**：

1. 让产线工程师通过**自然语言**快速获得**带引用来源**的技术答案；
2. 全流程可追溯：答案引用 → 原文位置 → 原文档；
3. 安全等级体系（public/internal/confidential/restricted）贯穿检索与展示；
4. 保持「可嵌入」能力，后续可集成进 EP 或公司 AI 平台。

### 1.3 成功指标（North Star）

| 指标 | 目标 |
|------|------|
| AI 问答采纳率（回答被点赞/追问率） | ≥ 40% |
| 检索命中率（Top-5 含相关文档） | ≥ 80% |
| 事实性错误率 | < 5% |
| 文档处理成功率 | ≥ 95% |
| 首字响应时间 | < 2s |
| 用户日活（DAU/MAU） | ≥ 30% |

---

## 2. 用户与角色

### 2.1 用户画像

| 角色 | 画像 | 核心场景 |
|------|------|----------|
| 产线操作员 | 一线生产人员，快速查 SOP | 查操作规程、故障处理步骤、安全要求 |
| 工艺工程师 | 参数制定者，需溯源 | 查工艺规范、参数对比、版本差异 |
| 设备工程师 | 设备维护 | 查设备手册、维护记录、备件 |
| 质量工程师 | 质量管控 | 查检测标准、质量报告、异常处理 |
| 知识库管理员 | 内容维护 | 上传文档、分类、监控索引质量、处理反馈 |
| 系统管理员 | 平台运维 | 用户权限、模型配置、系统监控 |

### 2.2 角色权限矩阵

| 能力 | viewer | operator | 工程师类 | knowledge_admin | system_admin |
|------|--------|----------|----------|-----------------|--------------|
| 文档阅读（按安全等级） | public | +internal | +confidential | +restricted | +restricted |
| 智能问答 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 文档上传/编辑 | — | — | ✅ | ✅ | ✅ |
| 文档删除/重建索引 | — | — | — | ✅ | ✅ |
| 反馈提交 | — | ✅ | ✅ | ✅ | ✅ |
| 反馈处理 | — | — | — | ✅ | ✅ |
| 搜索调试 | — | — | ✅ | ✅ | ✅ |
| 系统设置/用户管理/审计 | — | — | — | — | ✅ |

> 安全等级（security_level）是文档级强制属性：任何角色的检索与文件读取都不得越过 `allowedSecurityLevels`。

---

## 3. 范围

### 3.1 In Scope（本版本）

- 文档管理：上传（拖拽、进度）、分类/工位/工艺/版本/安全等级、索引状态追踪、重建索引、删除（软删）、同步
- AI 智能问答：多轮对话、SSE 流式、引用来源面板、文档预览、追问建议、回答反馈（赞/踩+原因）、收藏
- 消息操作：重试、**编辑并重新生成**（原地截断）、删除（截断后续）
- 语义搜索 + 传统关键词搜索、搜索调试（Prompt 预览、检索耗时）
- 认证与权限：JWT 登录、7 角色 RBAC、文档安全等级过滤
- 系统管理：RAG 参数在线调整、用户角色管理、审计日志、健康检查
- 统计：仪表盘（文档/会话/反馈）、浏览埋点

### 3.2 Out of Scope（本版本不包含，见路线图）

- 多租户隔离、单文件 AI 分析、跨文件对比、中英双语 UI
- OCR 扫描件识别、.x_t 解析
- Agent 自定义与长期记忆
- 自动生成技术报告、RAG 效果评估工具
- SSO（OIDC/SAML）、S3 存储、PostgreSQL 迁移

---

## 4. 功能需求

> 优先级：P0=必须（MVP 验收）、P1=重要（本迭代）、P2=增强（后续迭代）

### 4.1 认证与权限（P0）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| AUTH-1 | 用户名+密码登录，签发 JWT（24h） | P0 | 登录成功返回 token；失败提示"用户名或密码错误"且不区分账号是否存在 |
| AUTH-2 | 登录限流 | P0 | 同一来源 10 次/分钟超限返回 429 |
| AUTH-3 | 会话续期与过期处理 | P1 | Token 过期后前端自动跳转登录页 |
| AUTH-4 | 生产环境强制 JWT | P0 | `NODE_ENV=production` 且未配置 `JWT_SECRET` 时服务拒绝启动；无 Token 请求返回 401 |
| AUTH-5 | 用户管理（角色/停用） | P1 | 仅 system_admin 可修改用户角色与状态；不能停用自己；`system` 内置账号不可改 |
| AUTH-6 | 登录/登出审计 | P1 | 审计日志记录登录成功、失败（含用户名） |

### 4.2 文档管理（P0）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| DOC-1 | 上传文档（PDF/MD/TXT/DOCX，≤20MB） | P0 | 拖拽/选择上传，显示进度；白名单+魔数校验，伪装文件被拒（400） |
| DOC-2 | 元数据维护 | P0 | 标题/分类/工艺/工位/版本/安全等级/标签可编辑；安全等级修改仅限管理员 |
| DOC-3 | 异步索引与状态追踪 | P0 | 上传后立即返回，索引状态 pending→processing→ready/failed；失败原因可见 |
| DOC-4 | 文档列表/详情/搜索 | P0 | 分页、分类/状态/安全等级/关键词筛选；**列表按当前用户安全等级过滤**；不暴露服务器路径 |
| DOC-5 | 原文预览 | P0 | `/documents/:id/raw`、`/file` 仅返回当前用户可见等级的文档内容；路径穿越被拒绝 |
| DOC-6 | 重建索引 / 删除 | P0 | 重建索引可修复损坏数据；删除为软删（审计留痕） |
| DOC-7 | 与 RAG 同步 | P1 | 管理员可一键同步 Chroma 中已有文档到业务库；幂等（不重复建行） |
| DOC-8 | 文档评论（chunk 级） | P1 | 按 chunk 评论、嵌套回复、本人可编辑/删除 |

### 4.3 智能问答（P0，核心体验）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| CHAT-1 | 多轮流式问答 | P0 | SSE 打字机效果；首字 <2s；meta（检索耗时/命中数）→ tokens → done（引用）事件完整 |
| CHAT-2 | 引用来源 | P0 | 每条回答带引用卡片（文档/章节/页码/相似度/片段），可点击预览原文 |
| CHAT-3 | 会话管理 | P0 | 会话创建/列表/重命名/置顶/删除；**会话仅本人或管理员可见可操作** |
| CHAT-4 | 追问建议 | P1 | 回答末尾给出 2-3 条相关追问 |
| CHAT-5 | 重试 | P1 | 重新生成最近一次回答 |
| CHAT-6 | 编辑并重新生成 | P1 | 编辑用户消息 → 服务端原地更新并截断后续消息 → 重新生成；刷新后保持一致 |
| CHAT-7 | 删除消息 | P1 | 删除用户/助手消息并截断后续 |
| CHAT-8 | 停止生成 | P1 | 停止后服务端中止上游 LLM 流（避免继续计费），本地保留已生成内容 |
| CHAT-9 | 输入保护 | P0 | 空消息拒绝；单条消息 ≤20000 字符；top_k 1-20 |

### 4.4 搜索与调试（P0）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| SEARCH-1 | 语义搜索 | P0 | 自然语言查询返回 Top-K 片段（含文档/章节/相似度），按安全等级过滤 |
| SEARCH-2 | 关键词搜索 | P1 | 标题/内容 LIKE 检索，毫秒级返回 |
| SEARCH-3 | 搜索调试 | P1 | 仅授权角色可见 Prompt 预览、检索耗时、分块命中详情 |

### 4.5 反馈与收藏（P1）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| FB-1 | 回答点赞/点踩 | P1 | 每人每条回答限一次，可改；点踩可选填原因 |
| FB-2 | 反馈处理 | P1 | knowledge_admin/system_admin 可查看/处理反馈（状态流转 open→处理中→已解决） |
| FB-3 | 收藏回答 | P1 | 收藏/取消收藏助手回答；收藏页展示问题+答案+引用 |

### 4.6 系统管理与统计（P1）

| 编号 | 需求 | 优先级 | 验收标准 |
|------|------|--------|----------|
| SYS-1 | RAG 参数调整 | P1 | rag_top_k/temperature/max_context_chars/embedding_model 在线修改，值域校验，重启生效说明 |
| SYS-2 | 健康检查 | P0 | `/api/admin/health` 返回 api/rag/database 状态；RAG 健康含 Chroma 真实状态与 embedding 模式 |
| SYS-3 | 审计日志 | P1 | 记录操作人/IP/UA/requestId/详情；可按操作/人/资源筛选；仅 system_admin 可查 |
| SYS-4 | 统计仪表盘 | P1 | 文档/会话/反馈概览；**需登录**；查询明细仅管理员可见 |

---

## 5. 非功能需求

| 维度 | 要求 | 验收标准 |
|------|------|----------|
| 性能 | 用户规模 50-200 人；首字 <2s；检索 <500ms | 压测：20 并发 chat 无 5xx，P95 检索 <500ms |
| 安全 | 见 §4.1 与安全基线 | 安全测试脚本（`api/tests/security/security-tests.sh`）全部通过 |
| 安全基线 | JWT 强制、CORS 白名单、helmet 安全头、登录/聊天/上传限流、安全等级过滤、错误不泄露内部细节、审计不静默丢失 | 通过上述脚本（生产模式 strict） |
| 可用性 | 服务降级策略明确 | LLM 不可用：非流式返回明确错误而非伪造答案；RAG 不可用：health 显示异常，上传标记 failed 可重试 |
| 可维护性 | 单服务可独立构建、测试、回滚 | `scripts/check-harness.sh` 全绿；一个 commit 只改一个服务 |
| 数据 | SQLite + ChromaDB 本地持久化；`data/` 可备份恢复 | 备份/恢复演练通过；reindex 可重建向量 |
| 合规 | 敏感数据最小化 | 日志与审计对查询内容截断（200 字符）；聊天记录可清理 |

---

## 6. 系统架构概要

```
web (React 19 + Vite, :5174)
  │ REST + SSE
  ▼
api (Express + SQLite, :3001)   ← JWT 认证 / RBAC / 安全等级 / 审计 / 限流
  │ HTTP + X-API-Key (内网)
  ▼
rag (FastAPI + ChromaDB, :8001) ← 解析→清洗→分块→Embedding→检索→LLM(SSE)
```

**关键架构决策**（详见 [docs/decisions](./decisions/) 与 [ARCHITECTURE.md](./ARCHITECTURE.md)）：

1. 权限在 API 网关层统一裁决，RAG 无状态、不感知用户；
2. 安全等级从认证中间件 → 路由 → ragClient → ChromaDB 过滤全链路传递；
3. API↔RAG 以共享密钥（`RAG_API_KEY`）鉴权，RAG 拒绝直接暴露；
4. RAG 只读白名单目录（`data/uploads`、`knowledge`），杜绝任意文件读取；
5. 流式与非流式问答共用同一检索管线（改写+重排），保证结果一致。

**数据模型**（SQLite）：users / roles / role_permissions / documents / document_versions / document_jobs / chat_sessions / chat_messages / message_sources / feedback / favorites / browse_history / doc_comments / audit_logs / settings / agents（预留）/ agent_tools（预留）/ agent_memories（预留）。

---

## 7. API 一览（v1）

| 模块 | 端点 | 说明 |
|------|------|------|
| 认证 | POST /api/auth/login、GET /api/auth/me、GET /api/users、PUT /api/users/:id | 登录/当前用户/用户列表/角色与状态 |
| 文档 | GET/POST /api/documents、POST /api/documents/upload、PATCH/DELETE /api/documents/:id、POST /api/documents/:id/reindex、POST /api/documents/sync-from-rag、GET /api/documents/:id/raw、/file、/comments | 文档全生命周期 |
| 对话 | POST /api/chat（SSE）、GET/POST /api/chat/sessions、GET/PATCH/DELETE /api/chat/sessions/:id、PATCH/DELETE /api/chat/messages/:id | 会话与消息 |
| 搜索 | POST /api/search、POST /api/search/debug | 语义搜索/调试 |
| 反馈 | POST /api/feedback、GET /api/feedback、PATCH /api/feedback/:id | 反馈闭环 |
| 收藏 | GET/POST /api/favorites、DELETE /api/favorites/:messageId、GET /api/favorites/status | 收藏 |
| 统计 | GET /api/stats/dashboard、GET /api/stats/feedback-counts、POST/GET /api/stats/browse | 仪表盘/埋点 |
| 管理 | GET/PUT /api/admin/settings、GET /api/admin/audit-logs、GET /api/admin/health | 设置/审计/健康 |

> 响应统一 envelope：`{ data: ... }` / `{ error: { code, message }, request_id }`；分页 `{ data: { items, pagination } }`。

---

## 8. 验收与发布计划

### 8.1 版本计划

| 版本 | 内容 | 验收口径 |
|------|------|----------|
| v1.0（当前） | P0 全部 + P1 大部分 | 功能测试 + 安全测试通过；`check-harness.sh` 全绿；浏览器走查聊天/文档/设置三条主流程 |
| v1.1 | 传统+AI 搜索切换、单文件分析、.x_t 解析 | 搜索页双模式可用 |
| v1.2 | 跨文件对比、中英双语、Agent 与记忆 | 双语界面 + Agent CRUD |
| v2.0 | 多租户、S3、PG、SSO、评估工具 | 平台化验收 |

### 8.2 发布门禁（Definition of Done）

- [ ] 相关服务构建通过（`pnpm build:web` / `pnpm build:api` / `ruff + compileall`）
- [ ] `api/tests/run-tests.sh` 与 `api/tests/security/security-tests.sh` 通过
- [ ] 用户可见流程真实走查通过（登录 → 上传 → 索引 → 问答 → 引用 → 反馈）
- [ ] 提交符合规范（单服务 commit、Conventional Commits、无 AI footer）

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| LLM 接口不稳定/成本失控 | 问答不可用、费用超支 | 限流 + 每日用量保护（LLM_DAILY_*）+ 失败显式报错；预算保护拦截提示 |
| Embedding 模型不可用 | 检索质量崩塌 | fallback 模式 + 健康检查暴露 embedding_mode 告警 |
| 上传恶意文件 | 服务被利用 | 扩展名+MIME+魔数三重校验；uuid 重命名 |
| 安全等级误配 | 敏感文档泄露 | 服务端强制过滤（不信任客户端）；管理员才能改等级；审计留痕 |
| SQLite/Chroma 单点 | 数据丢失 | `data/` 定期备份；reindex 一键重建 |
| 文档解析质量差 | 检索精度下降 | 优先文本型 PDF；后续 OCR 覆盖扫描件 |
| 认证凭据泄露 | 越权 | 生产强制 JWT_SECRET；限流；停用账号即时失效（登录态校验） |

---

## 10. 术语表

| 术语 | 说明 |
|------|------|
| RAG | Retrieval-Augmented Generation，检索增强生成 |
| chunk | 文档切片（默认 600 字符/120 重叠） |
| security_level | 文档安全等级：public/internal/confidential/restricted |
| index_status | 索引状态：pending/processing/ready/failed |
| SSE | Server-Sent Events，服务端流式推送 |
| top_k | 检索返回的片段数量（1-50，默认 5） |

---

## 11. 附录：待办与已知缺口（来自 FINDINGS.md，非本版本范围）

- 异步任务队列（BullMQ/Redis）替代 fire-and-forget 上传索引
- 单元/集成测试体系（Vitest + pytest）
- 数据库迁移框架（drizzle/knex）
- 消息内容加密存储
- CI 增加安全扫描（npm audit / pip-audit）与测试阶段
