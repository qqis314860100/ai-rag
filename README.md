# 电池产线 RAG 知识库

面向电池产线工艺、设备、检测、MES、维护、安全的可追溯智能问答系统。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + TailwindCSS + Vite |
| API | Node.js + Express + SQLite |
| RAG | Python + FastAPI + ChromaDB |
| LLM | DeepSeek API |

## 项目结构

```
├── web/           ← React 前端 (localhost:5174)
├── api/           ← Express API (localhost:3001)
├── rag/           ← Python RAG 服务 (localhost:8001)
├── knowledge/     ← 知识库源文档 (14 篇)
├── docs/          ← 项目文档 (含 CONTRIBUTING.md)
├── package.json   ← pnpm workspace 编排
└── README.md
```

## 快速启动

### 环境

- Node.js >= 20
- Python >= 3.11
- pnpm

### 安装

```bash
# 前端 + API 依赖
pnpm install

# RAG 服务
cd rag
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

### 配置

```bash
cp .env.example .env
# 编辑 .env, 填入 DEEPSEEK_API_KEY
```

### 启动

```bash
pnpm dev          # Web + API 并行启动
pnpm dev:rag      # RAG 服务 (Python)
```

### 初始化

1. 访问 http://localhost:5174
2. 进入文档管理 → 同步文档
3. 进入智能问答 → 开始提问

### 开发与提交规则

- 先看 [CLAUDE.md](CLAUDE.md) 和 [项目执行规则清单](docs/EXECUTION_RULES.md)
- 先验证功能真的可用，再提交
- 一个 commit 只改一个服务，不能混 `web` / `api` / `rag`

### 聊天体验文档

- [需求文档](docs/CHAT_EXPERIENCE_SPEC.md)
- [开发计划](docs/CHAT_EXPERIENCE_PLAN.md)

## 三个服务

| 服务 | 端口 | 命令 |
|------|------|------|
| web | 5174 | `pnpm dev:web` |
| api | 3001 | `pnpm dev:api` |
| rag | 8001 | `pnpm dev:rag` |
