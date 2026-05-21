# Phase 1: 权限系统 + 会话记录增强

**日期**: 2026-05-22
**状态**: Draft
**范围**: 登录系统、RBAC 三角色、页面级权限、会话记录增强

---

## 1. 登录系统

### 1.1 方案

- JWT 无状态认证，access token 有效期 24h
- 用户名 + 密码登录，密码 bcrypt 哈希存储
- 用户表内置在 SQLite `users` 表
- 前端 token 存储在 localStorage，每次请求带 `Authorization: Bearer <token>`
- Login page 作为未认证用户的唯一入口

### 1.2 数据模型

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
  department TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 1.3 预置账号

系统首次启动自动创建：
- `admin / admin123` (role: admin)
- `editor / editor123` (role: editor)
- `viewer / viewer123` (role: viewer)

### 1.4 API 端点

| 端点 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/api/auth/login` | POST | 登录，返回 JWT token + 用户信息 | 公开 |
| `/api/auth/me` | GET | 获取当前用户信息 | 登录 |
| `/api/users` | GET | 用户列表 | admin |
| `/api/users` | POST | 创建用户 | admin |
| `/api/users/:id` | PATCH | 更新用户角色/信息 | admin |
| `/api/users/:id` | DELETE | 删除用户 | admin |

---

## 2. RBAC 权限控制

### 2.1 角色定义

| 角色 | 文档查看 | 文档上传 | 文档删除 | 检索调试 | 系统设置 | 用户管理 |
|------|---------|---------|---------|---------|---------|---------|
| admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| editor | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| viewer | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 2.2 实现方式

- 前端：路由守卫组件 `<RequireRole roles={['admin','editor']}>` 包裹受保护路由
- 后端：`requireRole('admin')` 中间件检查 JWT claims 中的 role
- 导航栏：根据角色动态显隐菜单项
- 当前 `extractUser` 中间件改为从 JWT 解析真实用户

### 2.3 路由级权限

| 路由 | admin | editor | viewer |
|------|-------|--------|--------|
| `/` 仪表盘 | ✅ | ✅ | ✅ |
| `/chat` | ✅ | ✅ | ✅ |
| `/documents` | ✅ | ✅ | ✅ (只读) |
| `/debugger` | ✅ | ✅ | ❌ |
| `/settings` | ✅ | ❌ | ❌ |

---

## 3. 会话记录增强

### 3.1 当前状态

- 会话存储到 SQLite `chat_sessions` + `chat_messages`
- 会话归属 `user_id`（当前固定 "anonymous"）
- 前端侧栏显示会话列表，可切换、删除

### 3.2 增强功能

| 功能 | 说明 |
|------|------|
| **用户归属** | 会话绑定真实用户 ID，用户只能看到自己的会话 |
| **时间筛选** | 侧栏顶部加"今天/本周/全部"筛选 |
| **搜索会话** | 侧栏顶部加搜索框，按标题/内容关键词搜索 |
| **导出会话** | 单会话导出为 Markdown/JSON |
| **会话重命名** | 双击标题可编辑 |
| **置顶** | 支持置顶重要会话 |

### 3.3 前端改动

- `SessionList` 组件顶部加搜索框 + 时间筛选 tabs
- 会话项支持双击重命名
- 会话项右侧菜单（置顶、导出、删除）
- `ChatPage` 初始化时按用户过滤加载会话

---

## 4. 实现顺序

### W1: 后端认证基础设施
1. 创建 `users` 表 + 预置账号 seed
2. 实现 `/api/auth/login` + `/api/auth/me`
3. 实现 JWT 签发 + 验证中间件
4. 更新现有 `extractUser` 为 JWT 解析

### W2: 前端登录
1. 创建 `LoginPage` + 登录表单
2. Auth context (`AuthProvider`) 管理 token + 用户状态
3. 路由守卫 `<RequireAuth>` + `<RequireRole>`
4. 修改 `api.ts` 自动带 Authorization header

### W3: 权限集成
1. 导航栏根据角色显隐
2. 页面级权限控制（Settings/Debugger/DocumentUpload）
3. 用户管理页面（admin only）

### W4: 会话增强
1. SessionList 加搜索 + 时间筛选
2. 会话重命名、置顶、导出
3. 用户隔离（只能看自己会话）

---

## 5. 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 认证方式 | JWT（无状态） | 无需 session store，部署简单 |
| 密码存储 | bcrypt | 行业标准 |
| Token 存储 | localStorage | 简单，SPA 场景够用 |
| 权限模型 | 三角色 RBAC | 满足当前需求，不过度设计 |
| 用户管理 | SQLite users 表 | 内网小团队，不需要 LDAP |

---

## 6. 不做的（YAGNI）

- OAuth/SSO/LDAP — 内网小团队不需要
- 细粒度文档权限 — Phase 2 再说
- 密码重置流程 — 管理员手动改
- MFA — 内网环境不需要
- Session 过期刷新 token — token 24h 够用，过期重新登录
