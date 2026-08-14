# Architecture Map

> This document is the navigation layer for long-lived AI development.
> It does not replace existing rules. It points to them and shows how the repo hangs together.

## What This Repo Is

`ai-rag` is a three-service knowledge base platform:

- `web` for the user interface
- `api` for auth, persistence, and orchestration
- `rag` for document parsing, retrieval, and generation

The repo already has stronger process rules in:

- [CLAUDE.md](../CLAUDE.md)
- [docs/EXECUTION_RULES.md](EXECUTION_RULES.md)
- [docs/CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/PRODUCT_SPEC.md](PRODUCT_SPEC.md)

Read those as the source of truth. Use this file as the map.

## Service Boundaries

### `web`

- Owns pages, UI state, and browser-facing flows
- Verifies user-visible behavior
- Does not own auth policy or RAG logic

### `api`

- Owns authentication, permissions, document metadata, chat/session persistence, audit logs, and RAG proxying
- Verifies REST and SSE behavior
- Does not do heavy AI parsing or embedding work

### `rag`

- Owns parsing, chunking, embeddings, retrieval, prompt assembly, and LLM calls
- Verifies content-processing behavior
- Does not own user identity or business data storage

## Canonical Working Rules

- Touch one service per commit.
- Verify the user-visible flow before committing.
- Keep changes small enough to review and revert.
- Split cross-service work into separate commits.
- Treat tests, build output, and smoke checks as required backpressure.

## Suggested Read Order For Agents

1. `CLAUDE.md`
2. `docs/EXECUTION_RULES.md`
3. `docs/CONTRIBUTING.md`
4. `docs/PRODUCT_SPEC.md`
5. The relevant service code

## Verification Map

- `web`: build plus browser verification for the touched flow
- `api`: build plus endpoint smoke tests
- `rag`: lint/compile plus health or retrieval smoke tests
- Local baseline: `bash scripts/check-harness.sh`

## If You Add New Rules

- Put durable rules in `docs/`
- Put repeated enforcement in scripts or CI
- Keep the root guide short and navigational
