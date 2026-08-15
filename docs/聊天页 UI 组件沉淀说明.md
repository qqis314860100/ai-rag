# 聊天页 UI 组件沉淀说明

## 本轮沉淀

为减少聊天页页面级临时样式，本轮新增并接入 3 个通用 UI 组件，同时补强已有空态组件：

1. `ActionButton`：用于回答整理、查看 artifact 等上下文动作，统一尺寸、边框、禁用态和 hover 表达。
2. `StatusBadge`：用于 artifact 状态等轻量状态标签，统一成功、失败、警告、弱化和强调色。
3. `ModalShell`：统一 artifact 弹窗和图解弹窗的遮罩、移动端全屏壳、头部、关闭按钮和 Escape 关闭逻辑。
4. `EmptyState`：补充 `compact`、`className` 和 `children`，支持更灵活的产品空态组合。

## 已接入位置

- `ChatThread`：回答整理操作栏改用 `ActionButton`。
- `ArtifactCard`：查看动作改用 `ActionButton`，状态标签改用 `StatusBadge`。
- `ArtifactModal`：改用 `ModalShell`。
- `DiagramModal`：改用 `ModalShell`。

## 组件边界

- 通用组件只负责视觉、布局、交互状态和壳层行为。
- 业务语义仍留在聊天领域组件中，例如 artifact 类型、可信度、证据数量和图解内容。
- 图解语义和布局来源仍由 RAG/API 主导，前端通用组件不做业务抽取。

## 验证

```bash
pnpm run build:web
pnpm run lint:web
```

浏览器 smoke：`http://localhost:5173/chat` 在 `390 x 844` 下可正常打开，无新增控制台错误。
