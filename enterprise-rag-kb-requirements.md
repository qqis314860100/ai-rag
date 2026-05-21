# 企业级 RAG 知识库系统需求文档

版本：v1.0  
日期：2026-05-15  
项目方向：电池产线工艺与设备知识库  
技术栈：Node.js、Python、ChromaDB、BAAI/bge-small-zh-v1.5、DeepSeek API、React 19、TailwindCSS、Vite  
UI 参考：Sitor 风格，暖白纸感背景、深石墨主色、低饱和金色点缀、轻量卡片、清爽企业工作台

---

## 1. 项目背景

企业电池产线涉及前段分选、模组组装、激光焊接、EOL 检测、Pack 总装、MES 追溯、设备维护和安全防护等复杂知识。当前知识多分散在工艺文档、设备手册、培训资料、维护经验和人员经验中，存在以下问题：

- 工程师查询信息效率低，需要在多个文档中手动查找。
- 工艺、设备、安全、检测知识之间缺少统一关联。
- 文档更新后，现场人员难以及时使用最新版本。
- 传统关键词搜索难以理解中文工艺语义。
- AI 问答若没有引用来源，难以满足企业可信要求。
- 设备故障、检测异常、工艺参数类问题需要可追溯、可解释、可审计。

本项目目标是建设一个企业级 RAG 知识库系统，将电池产线相关知识转化为可检索、可问答、可追溯、可评测、可运维的智能知识中枢。

---

## 2. 项目目标

### 2.1 总体目标

构建一个面向电池产线的企业级 RAG 知识库平台，支持文档管理、语义检索、智能问答、引用溯源、权限控制、检索调试、质量评测和系统运维。

### 2.2 核心目标

- 让用户可以通过自然语言提问获取工艺、设备、检测、安全等知识。
- 每个 AI 答案必须提供明确引用来源。
- 支持中文优化的语义检索。
- 支持知识库文档上传、解析、切块、向量化和索引重建。
- 支持企业内部角色权限与审计。
- 支持检索效果调试与 RAG 质量评测。
- 前端体验参考 Sitor 风格，但适配企业知识工作台。

### 2.3 非目标

第一阶段不实现以下能力：

- 不训练私有大模型。
- 不自研向量数据库。
- 不做复杂 BPM 审批流引擎。
- 不直接接入真实产线 PLC、SCADA 或 MES 实时生产数据。
- 不替代正式工艺文件审批系统。

---

## 3. 知识库范围

初始知识库包含 14 篇文档。

| 分类 | 主题 |
|---|---|
| 概述 | 产线总览与工艺架构 |
| 前段工序 | 电芯分选（OCV/内阻/K值测试） |
| 模组组装 | 电芯堆叠与精密涂胶 |
| 模组组装 | 端板/侧板激光焊接 |
| 模组组装 | 极柱 Busbar 激光焊接 |
| 检测工序 | 模组 EOL 测试 |
| Pack 组装 | Pack 总装工序 |
| 检测工序 | Pack EOL 测试与下线 |
| 核心技术 | CTP 1.0/2.0/3.0 麒麟电池技术演进 |
| 核心设备 | 激光焊接设备详解 |
| 检测设备 | CCD AI 视觉检测系统 |
| 信息系统 | MES 制造执行系统 |
| 设备维护 | 常见设备故障与维护 |
| 安全 | 产线安全与防护 |

### 3.1 后续知识扩展方向

- 工艺参数表
- SOP 作业指导书
- PFMEA / 控制计划
- 设备报警代码
- 维修工单与历史故障案例
- 质量异常 8D 报告
- 安全培训资料
- 设备点检与保养规范
- MES 操作手册
- 产线培训题库

---

## 4. 用户角色

| 角色 | 说明 | 核心权限 |
|---|---|---|
| 访客用户 | 仅体验或演示 | 查看公开知识、基础问答 |
| 产线操作员 | 一线使用人员 | 查询 SOP、安全、异常处理 |
| 工艺工程师 | 工艺知识维护者 | 查询、上传、编辑工艺文档 |
| 设备工程师 | 设备维护人员 | 查询设备、故障、维护文档 |
| 质量工程师 | 质量和检测人员 | 查询 EOL、CCD、质量异常文档 |
| 安全管理员 | 安全规范维护者 | 管理安全类文档、审核安全答案 |
| 知识库管理员 | 系统知识管理员 | 文档管理、索引管理、反馈处理 |
| 系统管理员 | 平台运维人员 | 用户、权限、配置、审计、备份 |

---

## 5. 典型使用场景

### 5.1 工艺查询

用户提问：

> 极柱 Busbar 激光焊接有哪些关键参数？

系统应返回：

- 参数类别
- 控制要点
- 常见缺陷
- 检测方式
- 引用来源文档和章节

### 5.2 故障排查

用户提问：

> CCD 检测频繁误判可能是什么原因？

系统应返回：

- 可能原因
- 排查步骤
- 设备维护建议
- 与光源、相机、算法阈值、治具定位相关的引用

### 5.3 安全规范查询

用户提问：

> 激光焊接工位维护前需要做哪些安全防护？

系统应返回：

- 断电挂牌
- 激光防护
- 烟尘处理
- 防护眼镜
- 互锁检查
- 明确安全警示
- 高置信引用来源

### 5.4 文档入库

管理员上传新的设备手册后，系统应：

- 解析文档
- 提取结构
- 自动切块
- 生成向量
- 写入 ChromaDB
- 更新索引状态
- 支持检索调试

### 5.5 RAG 效果调试

知识库管理员输入一个问题，系统展示：

- 原始 query
- 改写 query
- TopK 检索结果
- 每条 chunk 的 score
- rerank 结果
- 最终拼接到 prompt 的上下文
- 生成答案

---

## 6. 产品信息架构

系统包含以下一级模块：

- 仪表盘
- 智能问答
- 知识库管理
- 文档详情
- 检索调试
- 评测中心
- 反馈中心
- 权限管理
- 系统设置
- 审计日志

### 6.1 仪表盘

展示系统整体状态：

- 文档总数
- chunk 总数
- 向量索引状态
- 今日问答次数
- 低置信答案数量
- 用户反馈数量
- 热门问题
- 最近更新文档
- 模型调用状态

### 6.2 智能问答

核心问答工作区：

- 左侧：知识库分类、工序、设备、标签过滤
- 中间：问答对话
- 右侧：引用来源、chunk 详情、置信度、相关文档
- 底部：输入框、TopK 设置、检索模式、模型配置

### 6.3 知识库管理

管理文档生命周期：

- 上传文档
- 查看文档列表
- 编辑元数据
- 查看解析状态
- 查看向量化状态
- 重建索引
- 废止文档
- 删除文档
- 查看版本

### 6.4 检索调试

用于工程调优：

- query 输入
- metadata filter 设置
- TopK 设置
- 向量检索结果
- 混合检索结果
- rerank 结果
- prompt 预览
- token 统计
- latency 统计

### 6.5 评测中心

管理标准问题集和效果评估：

- 创建评测集
- 导入问题与标准答案
- 批量运行评测
- 查看召回率
- 查看答案准确率
- 查看引用正确率
- 查看失败样本

---

## 7. UI 设计要求

### 7.1 设计风格

参考 Sitor 的整体视觉语言：

- 暖白纸感背景
- 深石墨主色
- 金色低饱和点缀
- 细边框卡片
- 轻阴影
- 胶囊按钮
- Serif 标题
- Inter 正文
- 克制、温暖、可信赖

### 7.2 色彩规范

```css
:root {
  --color-primary: #44403c;
  --color-primary-hover: #292524;
  --color-primary-soft: #eceae7;
  --color-accent: #d4a574;
  --color-accent-soft: #fdf6ee;
  --color-success: #10b981;
  --color-success-soft: #ecfdf5;
  --color-error: #ef4444;
  --color-error-soft: #fef2f2;
  --color-bg: #f5f5f0;
  --color-surface: #ffffff;
  --color-text: #1c1917;
  --color-text-secondary: #57534e;
  --color-text-muted: #a8a29e;
  --color-border: #e7e5e4;
  --color-border-hover: #d6d3d1;
}
```

### 7.3 字体规范

- 主标题：Instrument Serif / Playfair Display
- 正文：Inter
- 代码与 chunk：SF Mono / JetBrains Mono
- 中文 fallback：PingFang SC、Microsoft YaHei、Noto Sans CJK

### 7.4 页面布局规范

- 顶部导航使用 sticky header。
- 主内容最大宽度建议 1200px。
- 企业工作台页面可采用三栏布局。
- 卡片圆角建议 8px 到 16px。
- 表格使用轻量边框和 hover 高亮。
- 不使用过度鲜艳渐变。
- 不使用大面积纯蓝后台风格。
- 不使用装饰性 orb 或无意义背景图。

---

## 8. 功能需求

### 8.1 文档上传

#### 8.1.1 支持格式

第一阶段：

- Markdown
- TXT
- PDF
- DOCX

第二阶段：

- HTML
- CSV
- XLSX
- 图片 OCR

#### 8.1.2 上传方式

- 单文件上传
- 多文件批量上传
- 拖拽上传
- 指定分类上传
- 指定权限等级上传

#### 8.1.3 上传校验

- 文件大小限制
- 文件格式校验
- 重名提示
- 重复内容检测
- 空文档检测
- 解析失败提示

### 8.2 文档解析

系统应根据文件类型提取：

- 标题
- 正文段落
- 表格
- 列表
- 图片说明
- 页码
- 章节结构
- 原始文件信息

PDF 解析需要尽量保留页码，用于引用溯源。

### 8.3 元数据管理

每篇文档应支持以下元数据：

```json
{
  "title": "极柱 Busbar 激光焊接",
  "category": "模组组装",
  "process": "Busbar Welding",
  "station": "MW-040",
  "version": "v1.0",
  "owner": "工艺工程部",
  "effective_date": "2026-05-15",
  "tags": ["激光焊接", "Busbar", "极柱", "模组"],
  "security_level": "internal",
  "status": "active"
}
```

### 8.4 文档切块

切块策略：

- 优先按标题层级切分。
- 保留章节路径。
- 表格作为独立 chunk 或结构化 chunk。
- 工艺步骤不应被过度拆散。
- 参数表、故障排查表、安全注意事项应保持语义完整。
- chunk 建议 400 到 800 中文字。
- overlap 建议 80 到 150 中文字。

每个 chunk 应包含：

- chunk_id
- document_id
- title
- section_path
- content
- page_number
- token_count
- metadata
- embedding_status

### 8.5 向量化

使用模型：

- `BAAI/bge-small-zh-v1.5`
- 向量维度：384
- 首次启动自动下载，约 130MB

要求：

- 支持批量 embedding。
- 支持失败重试。
- 支持增量向量化。
- 支持单文档重建索引。
- 支持全库重建索引。

### 8.6 向量库

使用 ChromaDB 嵌入式模式：

- 零配置启动
- 本地持久化
- collection 按知识库隔离
- metadata 用于权限和过滤

建议 collection 命名：

```text
battery_line_knowledge_v1
```

### 8.7 检索

第一阶段支持：

- 中文语义检索
- TopK 配置
- 分类过滤
- 标签过滤
- 文档状态过滤
- 权限过滤

第二阶段支持：

- BM25 关键词检索
- 向量 + 关键词混合检索
- query 改写
- 多查询扩展
- reranker 重排序

### 8.8 智能问答

使用 DeepSeek API，OpenAI 兼容接口。

问答流程：

1. 接收用户问题。
2. 识别用户权限。
3. 可选 query 改写。
4. 执行向量检索。
5. 可选混合检索。
6. 可选 rerank。
7. 构造 prompt。
8. 调用 DeepSeek。
9. 返回答案、来源、置信度、追问建议。

### 8.9 答案要求

AI 答案必须满足：

- 必须基于检索上下文回答。
- 必须展示引用来源。
- 不确定时必须明确说明。
- 不允许编造工艺参数。
- 安全类问题应采用保守策略。
- 涉及设备维护时应提示遵循企业 SOP。
- 涉及高风险操作时应提示联系专业人员或主管确认。

### 8.10 引用溯源

每个答案应返回：

- 文档名
- 分类
- 章节路径
- 页码或段落位置
- chunk_id
- 检索分数
- 片段摘要

前端应支持点击引用后查看原文片段。

### 8.11 多轮对话

要求：

- 支持会话列表。
- 支持会话标题自动生成。
- 支持上下文关联。
- 每轮问题仍需重新检索。
- 支持清空会话。
- 支持导出会话。

### 8.12 反馈闭环

用户可对答案进行：

- 点赞
- 点踩
- 标记无帮助
- 标记引用错误
- 提交纠错建议
- 转交知识库管理员处理

管理员可查看：

- 低评分答案
- 高频失败问题
- 无检索结果问题
- 引用错误问题

### 8.13 权限控制

支持基于角色的访问控制。

权限维度：

- 页面权限
- 文档查看权限
- 文档上传权限
- 文档删除权限
- 索引重建权限
- 系统配置权限
- 审计查看权限

文档安全等级：

- public
- internal
- confidential
- restricted

### 8.14 审计日志

记录以下行为：

- 登录
- 文档上传
- 文档删除
- 文档编辑
- 索引重建
- 用户提问
- 模型调用
- 权限变更
- 系统配置变更

审计日志字段：

- operator_id
- operator_name
- action
- resource_type
- resource_id
- timestamp
- ip
- user_agent
- detail

---

## 9. RAG 技术流程

### 9.1 入库流程

```text
文档上传
 -> 文件校验
 -> 文档解析
 -> 文本清洗
 -> 结构化切块
 -> 元数据绑定
 -> embedding 生成
 -> 写入 ChromaDB
 -> 写入文档元数据
 -> 索引状态更新
```

### 9.2 问答流程

```text
用户提问
 -> 权限识别
 -> 问题预处理
 -> query 改写
 -> metadata filter 构造
 -> 向量检索
 -> 可选混合检索
 -> 可选 rerank
 -> 上下文组装
 -> prompt 构造
 -> DeepSeek 生成
 -> 答案后处理
 -> 引用来源绑定
 -> 返回前端
 -> 记录日志
```

### 9.3 Prompt 要求

系统 prompt 应包含：

- 角色定义：企业电池产线知识助手。
- 知识边界：只能基于上下文回答。
- 引用要求：答案必须标注引用。
- 不确定策略：上下文不足时明确说明。
- 安全策略：安全相关问题必须保守。
- 输出格式：结构化、清晰、可操作。

---

## 10. 后端架构

### 10.1 总体架构

```text
React 19 + TailwindCSS + Vite
        |
        | REST / SSE
        v
Node.js API Gateway
        |
        | HTTP / Internal API
        v
Python RAG Service
        |
        |-- Document Parser
        |-- Chunker
        |-- Embedding Service
        |-- Retriever
        |-- Reranker
        |-- Prompt Builder
        |-- DeepSeek Client
        |
        v
ChromaDB Embedded
        |
        v
Local File Storage + SQLite/PostgreSQL
```

### 10.2 Node.js 职责

- 用户认证
- 权限控制
- 文件上传
- 前端 API
- 会话管理
- 审计日志
- 系统配置
- 对接 Python RAG 服务

### 10.3 Python 职责

- 文档解析
- 文本清洗
- chunk 切分
- embedding 生成
- ChromaDB 管理
- 检索
- rerank
- prompt 构造
- DeepSeek 调用
- RAG 评测

### 10.4 数据存储

第一阶段：

- ChromaDB：向量和 chunk metadata
- SQLite：用户、文档、会话、反馈、审计
- 本地文件系统：原始文档

企业部署阶段建议：

- PostgreSQL 替代 SQLite
- 对象存储替代本地文件系统
- ChromaDB 可替换为 Qdrant / Milvus / pgvector

---

## 11. API 需求

### 11.1 文档 API

```text
POST   /api/documents/upload
GET    /api/documents
GET    /api/documents/:id
PATCH  /api/documents/:id
DELETE /api/documents/:id
POST   /api/documents/:id/reindex
POST   /api/documents/rebuild-index
```

### 11.2 搜索 API

```text
POST /api/search
POST /api/search/debug
```

搜索请求：

```json
{
  "query": "Busbar 激光焊接有哪些关键参数？",
  "top_k": 5,
  "filters": {
    "category": "模组组装",
    "security_level": ["public", "internal"]
  }
}
```

### 11.3 问答 API

```text
POST /api/chat
GET  /api/chat/sessions
GET  /api/chat/sessions/:id
POST /api/chat/sessions/:id/messages
DELETE /api/chat/sessions/:id
```

问答响应：

```json
{
  "answer": "Busbar 激光焊接需要重点控制焊接功率、焊接速度、焦距、保护气体和夹具定位。",
  "sources": [
    {
      "document_id": "doc_busbar_welding",
      "document_title": "极柱 Busbar 激光焊接",
      "section": "工艺参数控制",
      "chunk_id": "chunk_003",
      "score": 0.86
    }
  ],
  "confidence": 0.82,
  "followups": [
    "Busbar 焊接常见缺陷有哪些？",
    "虚焊如何通过 CCD 检测识别？"
  ]
}
```

### 11.4 反馈 API

```text
POST /api/feedback
GET  /api/feedback
PATCH /api/feedback/:id
```

### 11.5 评测 API

```text
POST /api/evaluations
GET  /api/evaluations
POST /api/evaluations/:id/run
GET  /api/evaluations/:id/results
```

### 11.6 系统 API

```text
GET  /api/admin/health
GET  /api/admin/index-status
GET  /api/admin/audit-logs
GET  /api/admin/settings
PATCH /api/admin/settings
```

---

## 12. 数据模型

### 12.1 Document

```json
{
  "id": "doc_001",
  "title": "产线总览与工艺架构",
  "category": "概述",
  "version": "v1.0",
  "owner": "工艺工程部",
  "status": "active",
  "security_level": "internal",
  "tags": ["产线", "工艺架构"],
  "file_path": "/uploads/doc_001.pdf",
  "file_type": "pdf",
  "created_at": "2026-05-15T10:00:00+08:00",
  "updated_at": "2026-05-15T10:00:00+08:00"
}
```

### 12.2 Chunk

```json
{
  "id": "chunk_001",
  "document_id": "doc_001",
  "section_path": "产线总览 / 工艺流程",
  "content": "产线主要包含电芯分选、模组组装、Pack 总装和 EOL 测试...",
  "page_number": 3,
  "token_count": 420,
  "metadata": {
    "category": "概述",
    "security_level": "internal",
    "tags": ["产线", "工艺流程"]
  }
}
```

### 12.3 ChatSession

```json
{
  "id": "session_001",
  "user_id": "user_001",
  "title": "Busbar 焊接问题",
  "created_at": "2026-05-15T10:00:00+08:00",
  "updated_at": "2026-05-15T10:20:00+08:00"
}
```

### 12.4 ChatMessage

```json
{
  "id": "message_001",
  "session_id": "session_001",
  "role": "user",
  "content": "Busbar 激光焊接有哪些关键参数？",
  "sources": [],
  "created_at": "2026-05-15T10:01:00+08:00"
}
```

### 12.5 Feedback

```json
{
  "id": "feedback_001",
  "message_id": "message_002",
  "user_id": "user_001",
  "rating": "down",
  "reason": "引用来源不准确",
  "comment": "答案引用了 Pack EOL 文档，但问题是 Busbar 焊接。",
  "status": "open",
  "created_at": "2026-05-15T10:05:00+08:00"
}
```

---

## 13. 前端页面详细需求

### 13.1 仪表盘页面

组件：

- 顶部导航
- 系统状态卡片
- 知识库统计
- 最近问答
- 热门问题
- 失败问题
- 最近更新文档

关键交互：

- 点击统计卡片进入对应页面。
- 点击失败问题进入反馈处理。
- 点击文档进入文档详情。

### 13.2 智能问答页面

组件：

- 分类过滤器
- 标签过滤器
- 聊天消息流
- 引用来源面板
- 输入框
- 参数工具栏

关键交互：

- 输入问题后流式生成答案。
- 点击引用查看 chunk 原文。
- 可调整 TopK。
- 可切换检索模式。
- 可对答案反馈。

### 13.3 知识库管理页面

组件：

- 上传区域
- 文档表格
- 筛选器
- 状态标签
- 操作菜单
- 文档详情抽屉

关键交互：

- 拖拽上传。
- 编辑文档元数据。
- 单文档重建索引。
- 删除文档前二次确认。

### 13.4 检索调试页面

组件：

- query 输入区
- filter 设置区
- 检索结果列表
- chunk 详情
- prompt 预览
- latency 统计

关键交互：

- 运行检索。
- 查看 score。
- 比较 rerank 前后顺序。
- 复制 prompt。

### 13.5 评测中心页面

组件：

- 评测集列表
- 创建评测集弹窗
- 批量运行按钮
- 结果图表
- 失败样本表格

关键交互：

- 导入 CSV/JSON 问题集。
- 运行评测。
- 查看单题详情。

---

## 14. 非功能需求

### 14.1 性能

- 普通问答首 token 响应时间小于 3 秒。
- 非流式完整答案小于 10 秒。
- TopK 检索小于 1 秒。
- 1000 篇以内文档本地 ChromaDB 可正常运行。
- 文档上传后异步构建索引。

### 14.2 可用性

- 系统应提供健康检查接口。
- 文档解析失败不能影响其他文档。
- 模型调用失败时应返回明确错误。
- ChromaDB 不可用时应提示索引服务异常。

### 14.3 安全性

- API Key 不得暴露到前端。
- 用户输入需要做基础清洗。
- 文档下载需要鉴权。
- RAG 检索必须应用权限过滤。
- 审计日志不可由普通用户删除。

### 14.4 可维护性

- RAG pipeline 模块化。
- LLM Provider 可替换。
- Embedding 模型可替换。
- 向量库接口可抽象。
- Prompt 模板可配置。

### 14.5 可观测性

记录：

- 请求耗时
- 检索耗时
- 模型耗时
- token 使用量
- 检索命中情况
- 错误日志
- 用户反馈

---

## 15. 部署需求

### 15.1 本地开发

前端：

```text
npm install
npm run dev
```

Node API：

```text
npm run dev:api
```

Python RAG：

```text
python -m venv .venv
pip install -r requirements.txt
python app.py
```

### 15.2 环境变量

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

CHROMA_PERSIST_DIR=./data/chroma
UPLOAD_DIR=./data/uploads
SQLITE_DB_PATH=./data/app.db

EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
RAG_TOP_K=5
RAG_TEMPERATURE=0.2
```

### 15.3 生产部署建议

- 前端静态资源由 Nginx 托管。
- Node API 和 Python RAG 分服务部署。
- 使用进程管理器或容器编排。
- 数据目录定期备份。
- API Key 使用环境变量或密钥管理系统。

---

## 16. 评测指标

### 16.1 检索指标

- Recall@5
- Recall@10
- MRR
- TopK 命中文档准确率
- chunk 相关性评分

### 16.2 生成指标

- 答案准确率
- 引用正确率
- 幻觉率
- 不确定回答正确率
- 安全合规率

### 16.3 产品指标

- 日活用户数
- 问答次数
- 平均响应时间
- 点赞率
- 点踩率
- 无答案率
- 搜索失败率

---

## 17. 验收标准

### 17.1 MVP 验收

- 可以上传 14 篇初始知识文档。
- 可以完成文档解析、切块、embedding 和写入 ChromaDB。
- 可以通过自然语言提问。
- 答案包含至少 1 条引用来源。
- 可以查看引用 chunk 原文。
- 可以在前端查看文档列表。
- 可以重建索引。
- 可以配置 DeepSeek API Key。

### 17.2 企业级验收

- 支持用户登录和角色权限。
- 检索结果应用权限过滤。
- 支持文档版本和状态管理。
- 支持问答反馈。
- 支持检索调试页面。
- 支持评测集运行。
- 支持审计日志。
- 支持系统健康检查。
- 支持数据备份。

### 17.3 RAG 质量验收

使用不少于 100 条标准问题评测：

- Recall@5 不低于 85%。
- 引用正确率不低于 85%。
- 安全类问题合规率不低于 95%。
- 明确无依据问题时，拒答或不确定表达率不低于 90%。

---

## 18. 迭代计划

### 阶段一：MVP 基础版

目标：跑通完整 RAG 闭环。

范围：

- React 前端基础页面
- Node API
- Python RAG 服务
- 文档上传
- 文档解析
- chunk 切分
- embedding
- ChromaDB 检索
- DeepSeek 问答
- 引用来源展示

### 阶段二：知识库管理版

目标：具备企业知识管理能力。

范围：

- 文档元数据
- 文档状态
- 分类标签
- 单文档重建索引
- 全库重建索引
- 文档详情
- 上传记录

### 阶段三：RAG 调优版

目标：提升答案质量和可解释性。

范围：

- 检索调试
- query 改写
- 混合检索
- rerank
- prompt 预览
- token 和耗时统计

### 阶段四：企业治理版

目标：满足企业管理要求。

范围：

- 用户登录
- 角色权限
- 文档权限
- 审计日志
- 反馈中心
- 系统设置

### 阶段五：评测运维版

目标：持续质量优化。

范围：

- 评测集
- 批量评测
- 质量指标
- 失败样本分析
- 健康检查
- 备份恢复

---

## 19. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| PDF 解析质量差 | 检索不准 | 优先支持 Markdown/DOCX，PDF 加人工校验 |
| chunk 切分不合理 | 答案上下文缺失 | 按标题和表格结构切分，提供调试页面 |
| 模型幻觉 | 企业可信度下降 | 强制引用、无依据拒答、低温度 |
| 权限过滤遗漏 | 数据泄露 | 检索前后都做权限校验 |
| 文档版本混乱 | 答案引用旧知识 | 文档状态和版本控制 |
| ChromaDB 本地规模限制 | 后续扩展受限 | 抽象向量库接口，预留迁移 |
| DeepSeek API 不稳定 | 问答不可用 | 错误重试、降级提示、可配置 provider |

---

## 20. 优先级清单

### P0

- 文档上传
- 文档解析
- 文档切块
- embedding
- ChromaDB 存储
- 语义检索
- DeepSeek 问答
- 引用来源
- 前端问答页
- 文档列表

### P1

- 文档元数据
- 分类过滤
- 标签过滤
- 检索调试
- 反馈
- 索引重建
- 系统设置

### P2

- 用户权限
- 审计日志
- 文档版本
- 混合检索
- rerank
- 评测中心

### P3

- SSO
- OCR
- 多知识库
- 备份恢复
- 模型 provider 插件化
- 向量库迁移

---

## 21. 第一版推荐落地范围

第一版应聚焦“能用、可信、可调试”。

必须交付：

- 一个漂亮但不浮夸的 Sitor 风格前端。
- 一个完整的 RAG 问答闭环。
- 14 篇电池产线文档入库。
- 每个答案带引用来源。
- 一个检索调试页。
- 一个知识库管理页。

建议暂缓：

- 复杂审批流
- SSO
- OCR
- 多租户
- 高级 BI 看板

---

## 22. 成功标准

项目成功不是“页面能聊天”，而是满足以下标准：

- 现场人员能用自然语言查到工艺和设备知识。
- 工程师能确认答案来自哪份文档。
- 管理员能知道系统哪里答得不好。
- 文档更新后知识库可以可靠重建。
- 安全类、参数类、维护类问题有可控输出。
- 系统具备后续扩展到更多产线知识的基础。

