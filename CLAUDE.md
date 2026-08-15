# Repo Rules

Start here:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/EXECUTION_RULES.md](docs/EXECUTION_RULES.md)
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- [docs/PRD.md](docs/PRD.md) — 产品需求（事实源）
- [docs/glossary.md](docs/glossary.md) — 领域术语
- [docs/decisions/](docs/decisions/) — 决策记录
- [scripts/check-harness.sh](scripts/check-harness.sh) — 本地全量检查
- [skills/coding-implementation/SKILL.md](skills/coding-implementation/SKILL.md) — 变更工作流（.ai/pipeline.yaml 路由风险）

Before changing code, read:
- [docs/EXECUTION_RULES.md](docs/EXECUTION_RULES.md)
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- [.ai/pipeline.yaml](.ai/pipeline.yaml) — Fast/Standard/Strict 风险路由与检查

Hard constraints:
- One commit must touch only one service: `web`, `api`, or `rag`.
- If a task spans services, split it into separate commits and verify each service independently.
- Never commit a mixed-service diff.
- Never commit before the relevant user-visible flow is verified.
- Use Conventional Commits: `type(scope): description`.
- `scope` must be one of `web`, `api`, or `rag`.
- Do not include AI-related footer text in commit messages.
- Treat single-service commits as the unit for future rollback.

Safety red lines:
- Never touch production systems, real credentials, or `data/` runtime state unless explicitly authorized.
- Production requires `JWT_SECRET` and `RAG_API_KEY`; never hardcode or commit secrets.
- Never record credentials/secrets in logs, audits, commits, or change records.
- Destructive or irreversible actions (data deletion, DB migration, deployment) need a human gate.

If a change cannot be kept to one service, stop and split it before committing.
