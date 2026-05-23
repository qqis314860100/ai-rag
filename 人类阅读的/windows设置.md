# Windows 运行指南

## 环境要求

| 依赖 | 版本 | 安装方式 |
|------|------|----------|
| Node.js | >= 20.0.0 | [nodejs.org](https://nodejs.org) 下载 LTS 安装包 |
| pnpm | 最新版 | `npm install -g pnpm`（Node 安装后执行） |
| Python | >= 3.11 | [python.org](https://python.org) 下载安装包，**安装时勾选 "Add Python to PATH"** |
| Git | 最新版 | [git-scm.com](https://git-scm.com) 下载安装包 |

### 验证安装

打开 **PowerShell** 或 **命令提示符**，确认各工具可用：

```powershell
node --version     # 应显示 v20.x.x 或更高
pnpm --version     # 应显示版本号
python --version   # 应显示 Python 3.11.x 或更高
git --version      # 应显示版本号
```

> **建议使用 PowerShell 7+ 或 Windows Terminal**，避免 Git Bash 下 Python 路径问题。

---

## 1. 克隆项目

```powershell
git clone <repo-url> ai-rag
cd ai-rag\enterprise-rag-kb
```

---

## 2. 安装 Node.js 依赖

```powershell
pnpm install
```

如果遇到 `better-sqlite3` 编译错误，需安装 C++ 编译工具链：

```powershell
# 以管理员身份运行 PowerShell，安装 windows-build-tools
npm install -g windows-build-tools

# 或者安装 Visual Studio Build Tools，勾选 "Desktop development with C++"
```

---

## 3. 安装 Python 依赖

```powershell
cd services\rag

# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境
.venv\Scripts\activate
# 如果 PowerShell 报执行策略错误，先执行：
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# 然后重试

# 安装依赖
pip install -e .

# 返回项目根目录
cd ..\..
```

### 关于 Embedding 模型

`BAAI/bge-small-zh-v1.5` 首次运行时会自动从 HuggingFace 下载（约 133 MB），需要网络通畅。如果下载困难，可在 `.env` 中设置：

```
EMBEDDING_MODEL=fallback
```

使用纯 Python fallback 模式，无需 PyTorch，功能不受影响。

---

## 4. 配置环境变量

```powershell
copy .env.example .env
```

编辑 `.env` 文件，至少填写：

```ini
# 必填：DeepSeek API Key（从 platform.deepseek.com 获取）
DEEPSEEK_API_KEY=sk-xxxxxxxx

# 以下端口可根据需要调整
WEB_PORT=5174
API_PORT=3002
RAG_PORT=8001
```

没有 API Key 时 RAG 会使用 mock 响应，可先行体验前端功能。

---

## 5. 启动服务

需要**三个终端窗口**，分别启动三个服务。

### 终端 1 — API 网关

```powershell
cd ai-rag\enterprise-rag-kb
pnpm dev:api
```

首次启动会自动创建 `data/app.db`（SQLite）并植入默认用户：
- `admin` / `admin123`
- `editor` / `editor123`
- `viewer` / `viewer123`

### 终端 2 — RAG 服务

```powershell
cd ai-rag\enterprise-rag-kb\rag
.venv\Scripts\activate
python -m uvicorn app.main:app --reload --port 8001
```

> 根目录的 `pnpm dev:rag` 使用 `cd rag && python ...`，在 Windows 下可能失败，建议手动激活 venv 后直接运行 uvicorn。

### 终端 3 — 前端

```powershell
cd ai-rag\enterprise-rag-kb
pnpm dev:web
```

---

## 6. 验证

| 服务 | 地址 | 预期结果 |
|------|------|----------|
| 前端 | http://localhost:5174 | 登录页面 |
| API | http://localhost:3002 | Express 服务运行中 |
| RAG | http://localhost:8001 | FastAPI 服务运行中 |

### 快速冒烟测试

```powershell
# 测试 API 健康检查
curl http://localhost:3002/health

# 测试 RAG 健康检查
curl http://localhost:8001/health
```

---

## Windows 常见问题

### `better-sqlite3` 编译失败

```
Error: Cannot find module 'better-sqlite3'
```

**原因**：缺少 C++ 编译环境。

**解决**：
```powershell
# 方案 A：安装 windows-build-tools（推荐）
npm install -g windows-build-tools

# 方案 B：安装 Visual Studio 2022 Community，勾选 "Desktop development with C++"
# 然后重试 pnpm install
```

### PowerShell 无法激活 venv

```
File .venv\Scripts\Activate.ps1 cannot be loaded because running scripts is disabled
```

**解决**：
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### `pnpm dev:rag` 在 Windows 下不工作

根 `package.json` 中的脚本 `cd rag && python -m uvicorn ...` 依赖 Unix shell 语义。

**解决**：直接手动启动：

```powershell
cd rag
.venv\Scripts\activate
python -m uvicorn app.main:app --reload --port 8001
```

### 端口被占用

```powershell
# 查看端口占用
netstat -ano | findstr :3002

# 根据 PID 结束进程
taskkill /PID <PID> /F
```

### 文件路径过长

Windows 默认路径长度限制 260 字符，pnpm 的嵌套 node_modules 可能超出。

**解决**：
```powershell
# 以管理员身份运行，启用长路径支持
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

或在项目根目录创建 `.npmrc` 追加一行：
```
node-linker=hoisted
```

### Python 未加入 PATH

安装 Python 时忘记勾选 "Add Python to PATH"。

**解决**：重新运行 Python 安装程序，选择 "Modify" → 勾选 "Add Python to environment variables"。或手动添加：
- `C:\Users\<用户名>\AppData\Local\Programs\Python\Python3xx\`
- `C:\Users\<用户名>\AppData\Local\Programs\Python\Python3xx\Scripts\`
到系统环境变量 PATH。

---

## 一键启动脚本（可选）

将以下内容保存为 `dev.ps1`：

```powershell
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# 激活 Python venv
. .\services\rag\.venv\Scripts\Activate.ps1

# 启动三个服务
Start-Process powershell -ArgumentList "-NoExit", "-Command", "pnpm dev:api"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd services\rag; .venv\Scripts\Activate.ps1; python -m uvicorn app.main:app --reload --port 8001"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "pnpm dev:web"

Write-Host "All services started in separate windows." -ForegroundColor Green
```

使用方式：
```powershell
.\dev.ps1
```
