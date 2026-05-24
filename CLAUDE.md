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

## Rule Source
- [docs/EXECUTION_RULES.md](docs/EXECUTION_RULES.md) is the detailed workflow source of truth.
- This file and [AGENTS.md](AGENTS.md) are short entry summaries; if they drift from the execution rules, follow the execution rules.
- The project standard is light by default, strict only for architecture boundaries, high-risk flows, release work, and AFK automation.

## Hard Rules
- Keep commits single-topic; cross-service changes are allowed only when they serve the same topic.
- Keep the architecture boundaries below intact.
- Use the smallest verification that covers the risk; real browser/API/RAG flow validation is for high-risk paths.
- Use Conventional Commits, write Chinese descriptions, and do not include AI-related footer text.
- New human-readable docs created from project discussion must use Chinese filenames and Chinese titles.

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
