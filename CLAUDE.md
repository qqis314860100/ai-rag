# Repo Rules

Start here:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/EXECUTION_RULES.md](docs/EXECUTION_RULES.md)
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- [scripts/check-harness.sh](scripts/check-harness.sh)

Before changing code, read:
- [docs/EXECUTION_RULES.md](docs/EXECUTION_RULES.md)
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)

Hard constraints:
- One commit must touch only one service: `web`, `api`, or `rag`.
- If a task spans services, split it into separate commits and verify each service independently.
- Never commit a mixed-service diff.
- Never commit before the relevant user-visible flow is verified.
- Use Conventional Commits: `type(scope): description`.
- `scope` must be one of `web`, `api`, or `rag`.
- Do not include AI-related footer text in commit messages.
- Treat single-service commits as the unit for future rollback.

If a change cannot be kept to one service, stop and split it before committing.
