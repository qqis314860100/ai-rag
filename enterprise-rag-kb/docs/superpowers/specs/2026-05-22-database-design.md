# 数据库设计 — Enterprise RAG Agent Platform

**日期**: 2026-05-22 | **版本**: v2.0 | **状态**: Approved

## 设计原则

1. UUID 主键，所有表
2. FOREIGN KEY + 级联声明 (ON DELETE CASCADE / SET NULL)
3. N:M 关系拆中间表
4. UNIQUE 约束防止重复数据
5. 软删除 (deleted_at)，永不物理删除
6. JSON 仅存不可查询的元数据
7. 所有表标配: created_at, updated_at

## 完整 Schema

详见上述 7 层设计:
- L0: 基础层 (users, documents)
- L1: 会话层 (chat_sessions, chat_messages, message_sources, feedback)
- L2: Agent 定义层 (agents, agent_knowledge_scopes)
- L3: 工具&插件层 (tools, agent_tools)
- L4: 工作空间&团队 (workspaces, workspace_members, workspace_documents)
- L5: 记忆&上下文 (agent_memories)
- L6: 集成&API (api_keys, webhooks)
- L7: 审计&分析 (browse_history, usage_stats)

## 关系全景

```
workspaces ←─N:M─→ users ←─1:N─→ chat_sessions ←─1:N─→ chat_messages ←─1:N─→ message_sources
                                    │                                    │
                              agent_memories                        feedback (UNIQUE)
                              api_keys                              browse_history
                              documents                            usage_stats
                              
agents ←─N:M─→ tools (via agent_tools)
agents ←─N:M─→ documents (via agent_knowledge_scopes)
workspaces ←─N:M─→ documents (via workspace_documents)
```

## W1 执行范围

- 重建 users, documents, chat_sessions, chat_messages 表带 FK
- 新增 message_sources 表替代 sources_json
- feedback 加 UNIQUE(message_id, user_id)
- browse_history 带 FK
- 数据迁移脚本
