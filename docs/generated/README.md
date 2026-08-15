# 生成文档（Generated）

机器生成、可再生的项目上下文快照。**不要手工编辑**——由脚本生成后提交，保持与代码同步。

| 文件 | 内容 | 生成方式 |
|------|------|----------|
| [API_ROUTES.md](./API_ROUTES.md) | API 网关全部路由清单 | 扫描 `api/src/routes/` 生成 |

## 再生成命令

```bash
# API 路由清单
python3 scripts/gen-api-routes.py > docs/generated/API_ROUTES.md
```
