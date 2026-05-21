# 企业级 RAG 知识库系统

面向电池产线工艺、设备、检测、MES、维护、安全的可追溯 RAG 知识库。

## 技术栈

- **前端**: React 19 + TypeScript + TailwindCSS + Vite
- **API Gateway**: Node.js + Express + SQLite
- **RAG 服务**: Python + FastAPI + ChromaDB + BAAI/bge-small-zh-v1.5
- **LLM**: DeepSeek API (OpenAI 兼容)

## 快速启动

### 1. 环境要求

- Node.js >= 20
- Python >= 3.11
- pnpm

### 2. 安装依赖

```bash
# 前端和 API
pnpm install

# Python RAG 服务
cd services/rag
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入 DEEPSEEK_API_KEY
```

### 4. 启动服务

```bash
# 启动所有服务
pnpm dev          # Web + API

# 或分别启动
pnpm dev:web      # http://localhost:5173
pnpm dev:api      # http://localhost:3001
pnpm dev:rag      # http://localhost:8000
```

### 5. 初始化知识库

1. 访问 http://localhost:5173
2. 进入"文档管理"页面上传知识文档
3. 等待索引完成
4. 进入"智能问答"页面开始提问

## 项目结构

```
enterprise-rag-kb/
  apps/
    web/          # React 前端工作台
    api/          # Node.js API Gateway
  services/
    rag/          # Python RAG 服务
  data/
    uploads/      # 上传文档存储
    chroma/       # ChromaDB 持久化
  knowledge/      # 初始知识文档
  docs/           # 项目文档
  tests/          # 测试
  evals/          # RAG 评测
```
