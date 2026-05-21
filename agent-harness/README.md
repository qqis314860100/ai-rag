# Agent Teams + Harness 执行包

项目：企业级 RAG 知识库系统  
目标：把需求文档拆解为多 Agent 可并行执行的工程任务  
日期：2026-05-15

---

## 1. 这个 Harness 解决什么

该目录用于组织多个 coding agent 协作完成企业级 RAG 知识库系统开发。

它提供：

- Agent 团队分工
- 任务依赖图
- 并行执行波次
- 每个任务的上下文 brief
- 每个 agent 的输入、输出、验收标准
- Review Gate
- 集成流程
- 可复制给 agent 的 prompt 模板

---

## 2. 文档索引

| 文件 | 说明 |
|---|---|
| `team-manifest.yaml` | Agent 团队与职责定义 |
| `task-graph.md` | 任务依赖图和执行波次 |
| `harness-runbook.md` | 主控 harness 执行流程 |
| `agent-briefs.md` | 各 agent 冷启动任务说明 |
| `review-gates.md` | 架构、代码、RAG、UI、安全验收门禁 |
| `handoff-template.md` | Agent 完成任务后的交接模板 |
| `prompts.md` | 可复制给 coding agent 的标准 prompt |

---

## 3. 推荐执行方式

先由主控 Agent 执行：

```text
阅读 docs
 -> 创建项目脚手架
 -> 按 task-graph 分派并行任务
 -> 每个任务完成后进入 review gate
 -> 集成到主线
 -> 运行端到端验收
```

如果使用 git worktree：

```text
main
worktree/frontend-shell
worktree/node-api
worktree/python-rag
worktree/content-seed
worktree/qa-review
```

如果不使用 git worktree：

```text
按任务顺序串行执行，禁止多个 agent 同时修改同一目录。
```

---

## 4. 关键规则

- 每个 agent 必须只修改自己负责的目录。
- 不允许回滚其他 agent 的修改。
- 每个任务必须提交变更摘要、测试结果和风险说明。
- 所有答案必须有引用来源，这是产品硬性要求。
- 前端必须遵守 Sitor 风格设计 token。
- RAG 检索必须执行权限过滤。
- API Key 不得进入前端代码、日志或文档样例输出。

