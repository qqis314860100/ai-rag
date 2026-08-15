---
target: 聊天页、ArtifactCard、ArtifactModal、ConversationNavigator 和图解弹窗
total_score: 27
p0_count: 1
p1_count: 3
timestamp: 2026-05-27T15-51-49Z
slug: web-src-features-chat-components
---
# 第一轮 UI 质量审查问题清单

## 审查范围

- 页面：`http://localhost:5173/chat`
- 组件：`web/src/features/chat/components/ChatThread.tsx`
- 组件：`web/src/features/chat/components/ArtifactCard.tsx`
- 组件：`web/src/features/chat/components/ArtifactModal.tsx`
- 组件：`web/src/features/chat/components/ConversationNavigator.tsx`
- 组件：`web/src/features/chat/components/DiagramModal.tsx`
- 组件：`web/src/features/chat/components/ExcalidrawDiagramCanvas.tsx`

本轮目标不是直接改 UI，而是按 Impeccable critique 的方式输出第一轮问题清单，为后续 `polish`、`adapt` 和组件沉淀任务提供明确输入。

## 设计健康度

| # | 启发式 | 分数 | 关键问题 |
|---|---:|---:|---|
| 1 | 系统状态可见 | 3 | 流式、生成中、低置信状态已有提示，但 artifact 生成状态和失败原因还不够靠近用户目标。 |
| 2 | 匹配真实工作场景 | 3 | 证据、路线图、知识笔记方向正确；但整理按钮和图解入口仍带有偏 AI 工具感的视觉表达。 |
| 3 | 用户控制与自由 | 3 | 关闭弹窗、取消编辑、停止生成齐全；移动端侧栏/右栏叠加时控制成本偏高。 |
| 4 | 一致性与标准 | 2 | `ArtifactModal` 和 `DiagramModal` 结构重复，按钮、badge、卡片样式在页面级反复定义。 |
| 5 | 错误预防 | 3 | 低置信和拒答已拦截整理入口；图解布局仍依赖前端兜底，存在语义和视觉错配风险。 |
| 6 | 识别优先于记忆 | 3 | 引用、笔记、路线图标签清楚；部分 icon-only 操作需要 hover 才出现，发现成本偏高。 |
| 7 | 灵活与效率 | 3 | 会话定位、引用追问、知识卡/FAQ 沉淀可用；高频操作层级略分散。 |
| 8 | 美学与极简 | 2 | 右侧栏、回答卡片、artifact 卡片都偏重，圆角卡片和 badge 数量偏多。 |
| 9 | 错误恢复 | 3 | 重试、反馈原因、生成失败 toast 存在；图解失败后的下一步提示不够明确。 |
| 10 | 帮助与文档 | 2 | 空态有提示，图解弹窗缺少“只读白板/证据/布局异常”的轻量解释和恢复路径。 |
| **总计** |  | **27/40** | **可用但未精修，主要短板是移动布局、图解布局责任和组件一致性。** |

## 反 AI Slop 判断

整体没有走霓虹渐变、营销 hero、装饰仪表盘路线，符合企业知识库的克制方向。但还有三处容易显得“AI 工具模板化”：

1. 回答下方的“可继续整理”区域使用 `Sparkles`、圆角 pill、hover 上浮，和企业知识工作台的克制调性不完全一致。
2. 空态主图标仍使用星光符号，表达“AI 感”强于“可靠知识库”。
3. artifact、右侧栏、引用资料、笔记聚合大量使用白卡、软阴影和 badge，局部会显得像组件堆叠，而不是一套稳定的信息工作台。

## 自动检测与浏览器证据

- Impeccable 上下文已加载：`PRODUCT.md` 和 `DESIGN.md` 均存在，register 为 `product`。
- CLI 检测已尝试：`node .agents/skills/impeccable/scripts/detect.mjs --json web/src/features/chat/components`。
- 检测结果：失败，原因是当前项目内安装包缺少 bundled detector，输出为 `Error: bundled detector not found.`。
- 浏览器检查已执行：`http://localhost:5173/chat` 可打开。
- 桌面观察：聊天主区、会话历史和右侧知识工作台同时出现时，主阅读区被压到约 464px，信息密度偏紧。
- 移动观察：390px 宽度下，左侧全局导航仍占 220px，主区被挤到约 170px，同时右侧工作台以 336px 宽覆盖，移动首屏结构明显失衡。

## 做得好的地方

1. 方向是对的：artifact 已经跟随回答出现，详情进入弹窗，符合“回答 -> 图解/表格 -> 沉淀知识”的产品心智。
2. 低信息保护已经开始落地：低置信、拒答和不确定回答会隐藏整理入口，避免用户乱输也生成“有模有样”的假内容。
3. 右侧工作台从功能堆叠收敛为 `路线图 / 知识笔记` 两个 tab，信息架构比之前更接近企业知识库。

## 优先问题

### P0：移动端布局被左右面板挤坏

**位置**

- `web/src/features/chat/ChatPage.tsx`
- `web/src/features/chat/components/ConversationNavigator.tsx`

**问题**

390px 宽度下，全局导航、聊天主区和右侧知识工作台同时参与布局。主区只剩约 170px，输入框和消息阅读区被压缩，右侧面板覆盖感强。

**影响**

产线技术员或工程师在移动端查看答案、证据和图解时，会先被布局干扰，而不是直接进入查询任务。这是信任感和可用性的硬伤。

**修复建议**

1. 移动端默认关闭全局导航和右侧知识工作台，只保留聊天主线。
2. 右侧工作台在移动端改为 bottom sheet 或全屏临时面板，不参与主 flex 宽度计算。
3. 打开右侧工作台时锁定背景滚动，并保留明确关闭入口。

**建议命令**

`$impeccable adapt 聊天页移动端布局`

### P1：流程图布局责任仍偏前端，源头语义不够稳

**位置**

- `web/src/features/chat/components/ExcalidrawDiagramCanvas.tsx`

**问题**

前端仍承担了大量流程图布局推断，包括主线选择、分支左右分配、泳道节点排序、回流线折线和 mindmap 边重建。虽然没有抽取业务词表，但布局语义仍可能在前端被二次解释。

**影响**

用户已经明确指出“不是线头，是布局源头”。如果布局算法在前端兜底过重，RAG/API 输出的结构语义和最终图面可能不一致，导致父子方向、分支位置、循环回流看起来混乱。

**修复建议**

1. RAG/API 优先输出 `layout_hint`、节点层级、泳道、分支方向、排序和可选坐标。
2. 前端只做安全兜底：缺布局时使用确定性布局，但不重建语义边。
3. 对流程图增加布局验收规则：父节点指向子节点、主线自上而下、异常分支右侧、循环线回指上游。

**建议命令**

`$impeccable polish 图解弹窗流程图布局`

### P1：回答下方整理动作视觉层级过杂

**位置**

- `web/src/features/chat/components/ChatThread.tsx`

**问题**

`总结`、`知识卡`、`FAQ`、`思维导图`、`流程图` 并列展示，全部使用圆角 pill、阴影、hover 上浮和图标。虽然位置已经在回答下方，但视觉上仍像一组 AI 功能按钮，而不是企业知识整理动作。

**影响**

用户容易把“图解/知识资产”理解成装饰性生成按钮，而不是基于当前回答证据的后续工作流。按钮多时还会抬高认知负担。

**修复建议**

1. 改成“回答操作栏”：主动作只保留 1 个，次级动作折叠到 `整理` 菜单或紧凑分组。
2. 去掉 sparkle 作为默认智能符号，使用更中性的 `整理`、`沉淀`、`图解` 表达。
3. 生成中和失败态直接显示在对应动作旁，不依赖 toast 作为唯一反馈。

**建议命令**

`$impeccable polish 回答整理操作栏`

### P1：ArtifactCard 和 ArtifactModal 信息层级不够像“证据产物”

**位置**

- `web/src/features/chat/components/ArtifactCard.tsx`
- `web/src/features/chat/components/ArtifactModal.tsx`
- `web/src/features/chat/components/DiagramModal.tsx`

**问题**

ArtifactCard 当前展示类型、状态、可信度、证据数、标题、摘要、原因和查看按钮，短卡片里 badge 偏多。两个 modal 头部结构重复，图解弹窗在移动端仍有 `min-w-[860px]` 的白板尺寸压力。

**影响**

企业知识库里，用户最关心的是“这个产物是否可信、依据是什么、能不能查看”。现在视觉重点被多个 badge 平分，证据感没有成为第一层。

**修复建议**

1. 卡片第一行改为：类型 + 标题 + 状态；第二行只保留一句摘要。
2. 可信度和证据数量合并为一个证据状态区，避免 badge 噪声。
3. 合并 `ArtifactModal` 和 `DiagramModal` 的 shell，抽出统一 `ModalShell`。
4. 移动端弹窗改为全屏，白板内部横向滚动或提供适配缩放。

**建议命令**

`$impeccable polish ArtifactCard 和 ArtifactModal`

### P2：右侧知识工作台仍然偏重

**位置**

- `web/src/features/chat/components/ConversationNavigator.tsx`

**问题**

顶部标题、3 个统计块、tab、路线图标题、artifact badge、节点卡片、节点状态、日期、证据数、图解数同时出现。单个路线图节点虽然已经压缩，但整个右侧栏仍是多层卡片和多组 badge。

**影响**

右侧栏本应帮助用户快速定位会话和沉淀笔记，现在会和主回答争夺注意力。用户看一眼要先判断哪些数字重要。

**修复建议**

1. 顶部统计块只保留在有价值时展示，默认折叠或移到 tab 旁小计数。
2. 路线图节点保持 `[序号] [标题]` 和一行简介，状态/证据/artifact 放到低权重尾部。
3. 笔记页的引用资料和聚合笔记减少卡片嵌套，优先用列表行。

**建议命令**

`$impeccable distill ConversationNavigator`

### P2：组件规则还没沉淀成通用 UI 语言

**位置**

- `web/src/features/chat/components/*`
- `web/src/components/ui/*`

**问题**

按钮、badge、modal shell、artifact card、空态和状态提示仍多在页面级直接写 Tailwind class。后续继续迭代时，容易出现同样含义的按钮和 badge 长得不一样。

**影响**

小团队和 AI 协作会频繁改 UI，如果没有可复用组件规则，越改越难保持一致。

**修复建议**

1. 提取 `ActionBarButton`、`StatusBadge`、`ModalShell`、`ArtifactSummaryCard`、`EmptyState`。
2. 保留少量变体：primary、secondary、ghost、danger、status。
3. 把图解弹窗和 artifact 弹窗统一到同一个 shell。

**建议命令**

`$impeccable extract chat UI components`

## 角色红旗

### 产线技术员

主任务是快速查 SOP、异常处理和设备步骤。移动端布局失衡会直接阻断任务，流程图弹窗如果需要横向拖动太多，也会降低现场可用性。

### 工艺工程师

主任务是确认参数、标准和证据。ArtifactCard 里多个 badge 并列时，可信度和证据数量没有形成最强视觉优先级，容易让工程师怀疑产物到底是否可用。

### 新人和培训人员

主任务是理解知识点和流程。回答下方多个整理按钮并列，会让新人不确定该先点总结、知识卡、FAQ、思维导图还是流程图。

## 下一轮执行建议

1. 先做 P0 移动端适配，确保聊天页在 390px、768px、1280px 都不被左右栏挤坏。
2. 再做 P1 回答操作栏和 ArtifactCard/Modal polish，降低按钮和 badge 噪声。
3. 图解布局从源头推进：RAG/API 输出更明确布局语义，前端减少二次推断。
4. 最后抽通用组件，把本轮修出的稳定样式沉淀下来。

## 本轮审查结论

当前 UI 已经从“功能堆叠”走向“企业知识工作台”，但还没有达到 10 分状态。最值得优先修的不是再加功能，而是移动端结构、回答后操作层级、artifact 证据表达和图解布局源头。
