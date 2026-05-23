# PRD

## Goal

Continue the chat experience rebuild in small, verified, single-service commits.
The desired end state is a chat UI that keeps the main question-and-answer flow clear while supporting interruption, message actions, source inspection, session context navigation, preview, notes, and later structured graph output.

This Ralph loop must follow the repository rules in `AGENTS.md`, `CLAUDE.md`, `docs/EXECUTION_RULES.md`, and `docs/CONTRIBUTING.md`.

## Hard Constraints

- Work on exactly one incomplete task per iteration.
- Touch only one service per commit: `web`, `api`, or `rag`.
- Do not commit mixed-service diffs.
- Run the relevant verification before committing.
- Verify the user-visible flow when changing UI or API behavior.
- Use Conventional Commits with scope `web`, `api`, or `rag`.
- Do not include AI-related footer text in commit messages.
- If a task needs more than one service, implement only the current service slice and leave a clear progress note.
- Do not edit generated lockfiles or root package metadata unless the selected task is explicitly about tooling.

## Tasks

- [x] `web`: Replace the current source side panel behavior with an answer-scoped source detail drawer or modal so source clicks open focused evidence details instead of treating the right side as a full source warehouse.
- [ ] `web`: Add a right-side session navigator shell for current conversation context, including sections for current thread, recent evidence, and notes placeholders without requiring new backend APIs.
- [ ] `web`: Add a unified preview shell that can render the existing source detail fields and expose format tabs for text/markdown/raw content, leaving PDF/HTML/code expansion behind clear disabled states if backend data is not ready.
- [ ] `web`: Add a graph generation entry point in the chat UI with a disabled or local placeholder state that does not call missing backend APIs.
- [ ] `api`: Review and harden message delete/update semantics for branch truncation, including tests or API smoke verification for deleting a user message and preserving authorization behavior.
- [ ] `api`: Add a source detail API contract if existing stored message sources contain enough data; otherwise document the missing RAG fields in progress without fabricating data.
- [ ] `rag`: Extend source metadata shape to include enough context for source detail views when available, keeping response compatibility with current API consumers.
- [ ] `web`: Run an end-to-end chat regression covering login, sending, interrupting, switching sessions, source detail opening, and existing copy/retry actions.

## Acceptance Criteria

- Each completed task has one commit.
- Each commit touches exactly one service.
- `progress.txt` records what changed, verification run, commit hash, and any blocked follow-up.
- `web` tasks pass at least `pnpm run lint:web` and `pnpm run build:web`; UI tasks also include a browser smoke test when feasible.
- `api` tasks pass at least `pnpm run build:api`; endpoint behavior changes include API smoke tests or existing integration tests.
- `rag` tasks pass at least `rag/.venv/bin/python -m compileall rag/app` or `python3 -m compileall rag/app` depending on the available interpreter, plus a health or endpoint smoke test when feasible.
- The loop emits `<promise>COMPLETE</promise>` only when every task is complete or explicitly marked out of scope with a reason.
