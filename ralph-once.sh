#!/usr/bin/env bash
set -euo pipefail

PROMPT="@AGENTS.md @CLAUDE.md @docs/EXECUTION_RULES.md @docs/CONTRIBUTING.md @PRD.md @progress.txt \
1. Read the project rules, PRD, and progress file. \
2. Find the next incomplete task and implement exactly one service slice. \
3. Touch only one service: web, api, or rag. Do not edit root lockfiles or package metadata unless the task explicitly targets tooling. \
4. Run the smallest relevant verification, including build/lint and user-visible smoke checks when applicable. \
5. Update progress.txt with what you did, verification run, commit hash if committed, and any blockers. \
6. Commit only after verification passes, using Conventional Commits with scope web, api, or rag and no AI footer text. \
ONLY DO ONE TASK AT A TIME. NEVER COMMIT A MIXED-SERVICE DIFF."

RUNNER="${RALPH_RUNNER:-codex}"
LAST_MESSAGE_FILE="${RALPH_LAST_MESSAGE_FILE:-.ralph-loop.last.md}"

run_codex() {
  codex exec \
    --cd "$(pwd)" \
    --sandbox danger-full-access \
    --output-last-message "${LAST_MESSAGE_FILE}" \
    "${PROMPT}"
}

run_claude() {
  claude --permission-mode acceptEdits -p "${PROMPT}"
}

if [[ "${RUNNER}" == "claude" ]]; then
  if run_claude; then
    exit 0
  fi
  echo "Claude runner failed, falling back to Codex runner. Set RALPH_RUNNER=codex to skip Claude." >&2
  run_codex
  exit $?
fi

if [[ "${RUNNER}" == "auto" ]]; then
  if command -v codex >/dev/null 2>&1; then
    run_codex
    exit $?
  fi
  run_claude
  exit $?
fi

run_codex
