# Project Agent Guide

## What This Is
Enterprise battery-line RAG with three services:
- `web` for the UI and interaction layer
- `api` for auth, documents, chat orchestration, and persistence
- `rag` for ingest, retrieval, embeddings, and prompt/LLM logic

## Start Here
Read these before editing anything:
- [AGENTS.md](AGENTS.md)
- [README.md](README.md)
- [docs/EXECUTION_RULES.md](docs/EXECUTION_RULES.md)
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)
- [docs/架构标准.md](docs/架构标准.md)
- [docs/Codex架构配置.md](docs/Codex架构配置.md)

## Hard Rules
- One commit should express one topic: one feature, one fix, one refactor, or one workflow/doc update.
- Cross-service changes are allowed when they are the same topic and preserve the architecture boundaries.
- Never mix unrelated changes in one commit.
- Never commit before the matching normal or high-risk verification is complete.
- Use Conventional Commits: `type(scope): description`.
- Prefer `web`, `api`, or `rag` scopes for single-service changes; use `repo` or omit scope for coherent cross-service or repository-level changes.
- Do not include AI-related footer text in commit messages.
- Treat single-topic commits as the unit for future rollback.
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
- Run the smallest verification that covers the change risk.
- Verify the real user or service flow only for high-risk paths.
- Keep the diff to one topic when preparing a commit.
- If the change crosses services, confirm it is one coherent topic before committing.
