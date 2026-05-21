# 企业级 RAG 知识库 MVP 开发任务清单

版本：v1.0  
日期：2026-05-15  
目标：一次性交付可开发、可验收的 MVP 任务拆解

---

## 1. MVP 范围

MVP 必须实现：

- React 前端工作台
- Node.js API Gateway
- Python RAG Service
- SQLite 元数据
- ChromaDB 嵌入式向量库
- BAAI/bge-small-zh-v1.5 embedding
- DeepSeek 问答
- 文档上传
- 文档解析
- 文档切块
- 向量索引
- 智能问答
- 引用来源
- 文档管理
- 检索调试
- 基础系统设置

MVP 暂不实现：

- SSO
- OCR
- 多租户
- 复杂审批流
- 高级 BI
- 生产级分布式任务队列

---

## 2. 里程碑

| 里程碑 | 目标 | 交付物 |
|---|---|---|
| M1 | 项目脚手架 | monorepo、启动脚本、环境变量 |
| M2 | RAG 服务 | FastAPI、ChromaDB、embedding、search |
| M3 | 文档入库 | 上传、解析、切块、索引 |
| M4 | 问答闭环 | DeepSeek、prompt、sources |
| M5 | 前端工作台 | Dashboard、Chat、Documents |
| M6 | 检索调试 | Debugger、trace、prompt preview |
| M7 | 验收优化 | 14 篇文档入库、评测问题、修复 |

---

## 3. 任务清单

### 3.1 项目脚手架

| ID | 任务 | 验收标准 |
|---|---|---|
| T001 | 创建 monorepo 目录 | 包含 apps/web、apps/api、services/rag |
| T002 | 创建根 README | 说明启动方式和项目结构 |
| T003 | 创建 .env.example | 覆盖 API、RAG、Chroma、DeepSeek 配置 |
| T004 | 配置前端 Vite | React 19 能正常启动 |
| T005 | 配置 Node API | health endpoint 可访问 |
| T006 | 配置 Python RAG | /rag/health 可访问 |
| T007 | 配置统一代码风格 | lint/format 脚本可运行 |

### 3.2 数据库与配置

| ID | 任务 | 验收标准 |
|---|---|---|
| T010 | 初始化 SQLite | 所有 MVP 表创建成功 |
| T011 | 实现 DB 访问层 | documents、sessions、messages 可 CRUD |
| T012 | 实现 settings 表 | 可读取默认 RAG 配置 |
| T013 | 实现 audit_logs | 上传、问答、重建索引可记录 |
| T014 | 创建种子数据 | 默认管理员和系统设置可用 |

### 3.3 Python RAG Service

| ID | 任务 | 验收标准 |
|---|---|---|
| T020 | FastAPI 应用初始化 | /rag/health 返回 ok |
| T021 | ChromaDB 初始化 | collection 自动创建 |
| T022 | embedding 模型加载 | bge-small-zh-v1.5 可生成 384 维向量 |
| T023 | Markdown 解析器 | 可提取标题和正文 |
| T024 | TXT 解析器 | 可按段落解析 |
| T025 | PDF 解析器 | 可提取页码和文本 |
| T026 | DOCX 解析器 | 可提取段落和表格 |
| T027 | Chunker | 支持标题优先、overlap |
| T028 | VectorStore | 支持 upsert、search、delete_by_document |
| T029 | /rag/documents/ingest | 输入文件路径后完成索引 |
| T030 | /rag/search | 返回 topK chunks 和 score |
| T031 | DeepSeek client | 可完成非流式问答 |
| T032 | PromptBuilder | 输出带来源上下文的 prompt |
| T033 | /rag/chat | 返回 answer、sources、confidence |
| T034 | /rag/search/debug | 返回 trace、prompt preview |

### 3.4 Node API Gateway

| ID | 任务 | 验收标准 |
|---|---|---|
| T040 | API 服务初始化 | /api/admin/health 可访问 |
| T041 | 文件上传接口 | 可保存文件到 data/uploads |
| T042 | 文档元数据接口 | documents 列表和详情可用 |
| T043 | 文档入库转发 | 上传后调用 Python ingest |
| T044 | 索引状态更新 | ready/failed 状态正确 |
| T045 | 搜索接口 | /api/search 转发并返回结果 |
| T046 | 检索调试接口 | /api/search/debug 可用 |
| T047 | 会话接口 | session CRUD 可用 |
| T048 | 问答接口 | /api/chat 可保存消息并返回答案 |
| T049 | 反馈接口 | 点赞点踩可保存 |
| T050 | 系统设置接口 | 可读取和更新 RAG 参数 |

### 3.5 前端 Web

| ID | 任务 | 验收标准 |
|---|---|---|
| T060 | 全局主题 | Sitor 风格 token 生效 |
| T061 | AppShell | 顶部导航和侧边栏可用 |
| T062 | Dashboard 页面 | 显示文档数、chunk 数、系统状态 |
| T063 | Documents 页面 | 列表、筛选、状态 badge 可用 |
| T064 | UploadDropzone | 可上传 Markdown/TXT/PDF/DOCX |
| T065 | DocumentDetail | 可查看元数据和索引状态 |
| T066 | Chat 页面 | 可输入问题并展示答案 |
| T067 | SourcePanel | 可展示引用来源和 chunk 原文 |
| T068 | Feedback 按钮 | 点赞点踩可提交 |
| T069 | Debugger 页面 | 可运行检索并展示 topK |
| T070 | Prompt Preview | 可查看最终 prompt |
| T071 | Settings 页面 | 可配置 TopK、temperature、模型 |
| T072 | 响应式适配 | 桌面、平板、手机可用 |

### 3.6 初始知识库

| ID | 任务 | 验收标准 |
|---|---|---|
| T080 | 准备 14 篇 Markdown 文档 | 每篇包含标题、分类、标签 |
| T081 | 批量导入脚本 | 可一次性入库 14 篇文档 |
| T082 | 检查 chunk 质量 | 表格和工艺步骤未严重断裂 |
| T083 | 检查检索效果 | 典型问题能命中正确文档 |

### 3.7 验收与测试

| ID | 任务 | 验收标准 |
|---|---|---|
| T090 | API 集成测试 | 上传、检索、问答通过 |
| T091 | RAG 标准问题集 | 至少 30 条 MVP 测试问题 |
| T092 | 引用正确性检查 | 答案 sources 能定位 chunk |
| T093 | 无答案测试 | 无依据问题不会编造 |
| T094 | 安全类问题测试 | 输出保守提示 |
| T095 | UI 走查 | 无明显错位、溢出、重叠 |

---

## 4. 开发顺序

推荐顺序：

```text
T001-T007
 -> T010-T014
 -> T020-T030
 -> T040-T046
 -> T031-T034
 -> T047-T050
 -> T060-T072
 -> T080-T095
```

可并行：

- 前端主题和 AppShell 可与 RAG 服务并行。
- 数据库表设计可与 Python parser 并行。
- 文档内容准备可与 API 开发并行。
- 检索调试页可在 /api/search 可用后开发。

---

## 5. 验收问题样例

### 5.1 工艺类

```text
极柱 Busbar 激光焊接有哪些关键控制参数？
电芯分选为什么要测试 OCV、内阻和 K 值？
电芯堆叠过程需要控制哪些精度？
```

### 5.2 设备类

```text
激光焊接设备由哪些核心模块组成？
CCD AI 视觉检测误判可能有哪些原因？
涂胶设备常见故障如何排查？
```

### 5.3 检测类

```text
模组 EOL 测试包含哪些项目？
Pack EOL 测试下线前需要确认什么？
绝缘耐压测试异常可能是什么原因？
```

### 5.4 安全类

```text
激光焊接工位维护前需要做哪些安全防护？
Pack 总装高压操作有哪些注意事项？
产线设备检修时如何执行断电挂牌？
```

### 5.5 无依据类

```text
这条产线昨天夜班的良率是多少？
某个未入库供应商的设备参数是多少？
当前实时 MES 工单状态是什么？
```

---

## 6. MVP 完成定义

MVP 完成必须满足：

- 三个服务可本地启动。
- 14 篇文档可入库。
- ChromaDB 持久化正常。
- 问答返回答案和引用。
- 检索调试能显示 topK chunk。
- 文档管理可上传、查看、重建索引。
- UI 风格符合设计要求。
- 至少 30 条验收问题通过人工检查。

