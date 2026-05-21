# 企业级 RAG 知识库前端原型说明

版本：v1.0  
日期：2026-05-15  
技术栈：React 19、TailwindCSS、Vite  
设计参考：Sitor

---

## 1. UI 总体方向

系统视觉参考 Sitor 的暖白、克制、可信赖风格，但功能定位是企业级知识工作台。

关键词：

- 暖白纸感
- 深石墨主色
- 金色点缀
- 轻边框
- 轻阴影
- 清爽卡片
- 企业信息密度
- 强引用溯源

---

## 2. 设计 Token

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
  --shadow-sm: 0 1px 4px #0000000a;
  --shadow-md: 0 2px 12px #00000014;
  --shadow-lg: 0 8px 24px #0000001f;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
}
```

---

## 3. 页面地图

```text
/
  Dashboard

/chat
  智能问答

/documents
  知识库管理

/documents/:id
  文档详情

/debugger
  检索调试

/evaluations
  评测中心

/feedback
  反馈中心

/settings
  系统设置

/admin/audit-logs
  审计日志
```

---

## 4. 全局布局

### 4.1 AppShell

```text
┌──────────────────────────────────────────────┐
│ TopNav                                       │
├──────────────┬───────────────────────────────┤
│ Sidebar      │ Main Content                  │
│              │                               │
│              │                               │
└──────────────┴───────────────────────────────┘
```

### 4.2 TopNav

内容：

- Logo：电池产线知识中枢
- 当前知识库名称
- 全局搜索入口
- 模型状态
- 用户头像
- 设置入口

风格：

- sticky top
- 背景 `--color-bg`
- 下边框 `--color-border`
- 高度 64px

### 4.3 Sidebar

菜单：

- 仪表盘
- 智能问答
- 知识库管理
- 检索调试
- 评测中心
- 反馈中心
- 系统设置

风格：

- 宽度 240px
- 当前菜单使用 `--color-primary-soft`
- 图标使用 lucide-react

---

## 5. 仪表盘页面

### 5.1 页面目标

让管理员快速了解知识库健康状态。

### 5.2 页面结构

```text
标题区
  电池产线知识中枢
  今日系统状态、索引状态、模型状态

指标卡片
  文档数 / Chunk 数 / 今日问答 / 低置信答案

主体区域
  左：最近问答
  中：热门问题
  右：最近更新文档

底部
  失败问题与反馈队列
```

### 5.3 卡片内容

- 文档总数：14
- Chunk 总数：自动统计
- 索引状态：Ready
- 今日问答：0
- 低置信答案：0
- 待处理反馈：0

### 5.4 组件

- `MetricCard`
- `RecentQuestions`
- `HotQuestionList`
- `RecentDocuments`
- `SystemHealthCard`

---

## 6. 智能问答页面

### 6.1 页面目标

为产线人员和工程师提供可信、可追溯的知识问答。

### 6.2 页面结构

```text
┌───────────────┬───────────────────────────┬────────────────────┐
│ FilterPanel   │ ChatThread                │ SourcePanel        │
│               │                           │                    │
│ 分类           │ 用户问题                   │ 引用来源             │
│ 工序           │ AI 答案                    │ Chunk 原文          │
│ 设备           │                           │ 置信度              │
│ 标签           │                           │ 相关文档             │
│               │ InputBox                  │                    │
└───────────────┴───────────────────────────┴────────────────────┘
```

### 6.3 FilterPanel

筛选项：

- 分类
- 工序
- 设备
- 文档安全等级
- 标签
- 检索 TopK
- 检索模式

### 6.4 ChatThread

消息样式：

- 用户消息：深石墨气泡，右对齐
- AI 消息：白色或浅米灰卡片，左对齐
- AI 答案底部显示引用数量、置信度、耗时
- 支持点赞、点踩、复制

### 6.5 SourcePanel

引用卡片字段：

- 文档标题
- 章节路径
- 页码
- score
- snippet
- chunk_id

交互：

- 点击引用卡片展开原文。
- 点击文档标题进入文档详情。
- 支持复制引用。

### 6.6 输入框

功能：

- 多行输入
- Enter 发送
- Shift+Enter 换行
- 上传附件入口预留
- TopK 快捷设置
- 模型状态展示

---

## 7. 知识库管理页面

### 7.1 页面目标

管理文档上传、分类、索引和版本。

### 7.2 页面结构

```text
页面标题 + 上传按钮

上传 Dropzone

筛选工具条
  keyword / category / status / index_status / security_level

文档表格
  标题 / 分类 / 版本 / 安全等级 / Chunk / 索引状态 / 更新时间 / 操作
```

### 7.3 文档状态 Badge

| 状态 | 样式 |
|---|---|
| ready | success soft |
| processing | accent soft |
| failed | error soft |
| pending | primary soft |

### 7.4 操作

- 查看详情
- 编辑元数据
- 重建索引
- 归档
- 删除

删除需要二次确认。

---

## 8. 文档详情页面

### 8.1 页面结构

```text
文档标题
  元数据 badges

基础信息
  分类 / 工序 / 工站 / 版本 / 责任部门 / 安全等级

索引状态
  chunk 数 / embedding 模型 / 最近重建时间

Chunk 列表
  章节 / 页码 / 内容摘要 / token 数

操作区
  重建索引 / 下载原文 / 编辑元数据
```

---

## 9. 检索调试页面

### 9.1 页面目标

帮助工程师调试 RAG 检索质量。

### 9.2 页面结构

```text
Query 输入区
  问题 / TopK / 检索模式 / filters

Trace Summary
  retrieval_ms / llm_ms / context_chars / estimated_tokens

结果列表
  Score / 文档 / 章节 / Chunk 内容

Prompt Preview
  最终上下文和系统提示词
```

### 9.3 检索结果卡片

字段：

- 排名
- score
- 文档标题
- 分类
- 章节
- 页码
- chunk 内容
- metadata

视觉：

- score 使用金色细进度条
- chunk 文本使用 mono 或较小字号

---

## 10. 评测中心页面

### 10.1 页面目标

管理 RAG 标准问题集，持续评估系统质量。

### 10.2 页面结构

```text
评测集列表
  名称 / 问题数 / 最近运行 / 指标

评测结果
  Recall@5 / 引用正确率 / 答案准确率 / 幻觉率

失败样本
  问题 / 期望文档 / 实际引用 / 错误原因
```

---

## 11. 反馈中心页面

### 11.1 页面目标

处理用户对答案的纠错与低质量反馈。

### 11.2 字段

- 问题
- AI 答案
- 用户反馈
- 反馈原因
- 引用来源
- 状态
- 处理人
- 处理结论

### 11.3 操作

- 标记处理中
- 标记已解决
- 忽略
- 跳转到对应文档
- 跳转到对应会话

---

## 12. 系统设置页面

设置分组：

- 模型配置
- RAG 参数
- 文档解析
- 权限策略
- 系统健康

字段：

- DeepSeek Base URL
- DeepSeek Model
- TopK
- Temperature
- Max Context Chars
- Embedding Model
- Chroma Collection

敏感字段：

- DeepSeek API Key 只允许保存，不回显明文。

---

## 13. 响应式要求

桌面端：

- 主要工作区三栏布局。
- SourcePanel 固定在右侧。

平板：

- 左侧筛选可折叠。
- SourcePanel 可抽屉显示。

移动端：

- 单列布局。
- 菜单折叠。
- 引用来源放到答案下方。

---

## 14. 组件清单

基础组件：

- Button
- IconButton
- Badge
- Card
- Input
- Textarea
- Select
- Tabs
- Dialog
- Drawer
- Table
- Tooltip
- Progress
- Toast

业务组件：

- AppShell
- TopNav
- SideNav
- MetricCard
- UploadDropzone
- DocumentTable
- DocumentDetailDrawer
- ChatThread
- ChatMessage
- ChatInput
- SourcePanel
- SourceCard
- SearchDebugger
- DebugTrace
- EvaluationMetric
- FeedbackQueue

---

## 15. 文案规范

按钮：

- 上传文档
- 重建索引
- 开始检索
- 发送
- 查看引用
- 复制答案
- 提交反馈

空状态：

```text
暂无文档。上传第一批产线知识文档后，即可开始构建知识库。
```

无答案：

```text
当前知识库中没有找到足够依据回答该问题。你可以尝试补充关键词，或联系知识库管理员补充相关文档。
```

安全提示：

```text
该问题涉及安全操作，请以企业正式 SOP 和现场安全要求为准。
```

---

## 16. UI 验收标准

- 整体视觉符合 Sitor 参考风格。
- 问答页清晰展示答案和引用来源。
- 检索调试页能展示 score、chunk、prompt。
- 文档管理页能完成上传、筛选、重建索引操作。
- 所有主要页面在 1440px、1024px、390px 宽度下可用。
- 文本不重叠、不溢出按钮和卡片。
- 企业功能信息密度足够，不做空泛营销页。

