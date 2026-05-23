# Project Agent Guide

## What This Is
Enterprise battery-line RAG with three services:
- `web` for the UI and interaction layer
- `api` for auth, documents, chat orchestration, and persistence
- `rag` for ingest, retrieval, embeddings, and prompt/LLM logic

## Agent Architecture
- Layer 1: `AGENTS.md` - memory layer, repo rules, naming, structure, engineering red lines
- Layer 2: `skills/` - knowledge layer, reusable best practices and scenario-specific workflows
- Layer 3: `hooks/` - guardrail layer, pre/post checks, risky-command interception, audit trails
- Layer 4: `subagents/` - delegation layer, isolated contexts, parallel execution, result handoff
- Layer 5: `plugins/` - distribution layer, versioned team sync, installable capability bundles

## Start Here
Read these before editing anything:
- [README.md](README.md)
- [docs/EXECUTION_RULES.md](docs/EXECUTION_RULES.md)
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- [docs/架构标准.md](docs/架构标准.md)
- [docs/Codex架构配置.md](docs/Codex架构配置.md)

## Hard Rules
- One commit must touch only one service: `web`, `api`, or `rag`.
- If a task spans services, split it into separate commits and verify each service independently.
- Never commit a mixed-service diff.
- Never commit before the relevant user-visible flow is verified.
- Use Conventional Commits: `type(scope): description`.
- `scope` must be one of `web`, `api`, or `rag`.
- Do not include AI-related footer text in commit messages.
- Treat single-service commits as the unit for future rollback.
- If you run a Ralph loop or any other autonomous coding loop, it still must obey the same single-service, single-task, verify-before-commit rules.
- Do not start an autonomous loop on a dirty worktree unless the user explicitly accepts the risk.
- New human-readable documentation files created from project discussion must use Chinese filenames and Chinese titles, such as requirements, design, architecture, technical notes, and plans. Do not force rename historical English docs, and do not apply this rule to code, config, scripts, tests, assets, or identifiers.

## Architecture Boundaries
- `web` should only handle presentation, routing, and client state.
- `web` talks to backend services through HTTP APIs only.
- `api` owns auth, sessions, documents, feedback, favorites, stats, and request logging.
- `api` may call `rag` through the service client, but should not embed retrieval logic itself.
- `rag` owns ingestion, chunking, embedding, retrieval, and prompt assembly.
- Human-readable project docs live in `docs/`; new discussion-driven docs should use Chinese filenames and titles.

## Common Commands
- Install: `pnpm install`
- Start web + api: `pnpm dev`
- Start rag: `pnpm dev:rag`
- Lint: `pnpm run lint`
- Build: `pnpm run build`
- Verify: `pnpm run verify`
- Audit harness: `pnpm run audit:harness`
- API integration tests: `pnpm run test:api`

## Before Finishing
- Run the relevant build and lint checks for the touched service.
- Verify the user-visible flow, not just compilation.
- Keep the diff to one service when preparing a commit.
- If the change crosses services, split it before commit.
