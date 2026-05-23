#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

RUNNER="${RALPH_RUNNER:-codex}"
LAST_MESSAGE_FILE="${RALPH_LAST_MESSAGE_FILE:-.ralph-loop.last.md}"

build_prompt() {
  cat <<'EOF'
@AGENTS.md @CLAUDE.md @docs/EXECUTION_RULES.md @docs/CONTRIBUTING.md @PRD.md @progress.txt
1. Find the highest-priority incomplete task and implement exactly one service slice.
2. Touch only one service: web, api, or rag. Do not edit root lockfiles or package metadata unless the task explicitly targets tooling.
3. Run the relevant verification, including build/lint and user-visible smoke checks when applicable.
4. Update progress.txt with what was done, verification run, commit hash if committed, and any blockers.
5. Commit only after verification passes, using Conventional Commits with scope web, api, or rag and no AI footer text.
ONLY WORK ON A SINGLE TASK. NEVER COMMIT A MIXED-SERVICE DIFF.
If the PRD is complete, output <promise>COMPLETE</promise>.
EOF
}

run_codex() {
  codex exec \
    --cd "$(pwd)" \
    --sandbox danger-full-access \
    --output-last-message "${LAST_MESSAGE_FILE}" \
    "$(build_prompt)"
}

run_claude() {
  claude --permission-mode acceptEdits -p "$(build_prompt)"
}

run_iteration() {
  if [[ "${RUNNER}" == "claude" ]]; then
    if run_claude; then
      return 0
    fi
    echo "Claude runner failed, falling back to Codex runner. Set RALPH_RUNNER=codex to skip Claude." >&2
    run_codex
    return $?
  fi

  if [[ "${RUNNER}" == "auto" ]]; then
    if command -v codex >/dev/null 2>&1; then
      run_codex
      return $?
    fi
    run_claude
    return $?
  fi

  run_codex
}

for ((i=1; i<=$1; i++)); do
  result=$(run_iteration)

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "PRD complete after $i iterations."
    exit 0
  fi
done
