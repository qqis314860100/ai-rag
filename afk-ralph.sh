#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <iterations|until-complete>"
  exit 1
fi

LAST_MESSAGE_FILE="${RALPH_LAST_MESSAGE_FILE:-.git/ralph-loop.last.md}"
MODE="${1}"

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

ensure_clean_worktree() {
  local phase="$1"
  local status
  status="$(git status --short)"

  if [ -n "${status}" ]; then
    echo "Ralph guard stopped: worktree is dirty ${phase}."
    echo "${status}"
    exit 1
  fi
}

validate_commit_scope() {
  local commit="$1"
  local files
  files="$(git diff-tree --no-commit-id --name-only -r "${commit}")"

  if [ -z "${files}" ]; then
    echo "Ralph guard stopped: commit ${commit} has no file changes."
    exit 1
  fi

  local service_count
  service_count="$(printf '%s\n' "${files}" | awk -F/ '$1 == "web" || $1 == "api" || $1 == "rag" { print $1 }' | sort -u | wc -l | tr -d ' ')"

  if [ "${service_count}" -gt 1 ]; then
    echo "Ralph guard stopped: commit ${commit} touches multiple services."
    printf '%s\n' "${files}"
    exit 1
  fi

  if [ "${service_count}" -eq 1 ]; then
    local mixed_files
    mixed_files="$(printf '%s\n' "${files}" | awk -F/ '$1 != "web" && $1 != "api" && $1 != "rag" { print }')"
    if [ -n "${mixed_files}" ]; then
      echo "Ralph guard stopped: commit ${commit} mixes a service with non-service files."
      printf '%s\n' "${files}"
      exit 1
    fi
  fi
}

validate_new_commits() {
  local before_head="$1"
  local commits
  commits="$(git rev-list --reverse "${before_head}..HEAD")"

  if [ -z "${commits}" ]; then
    echo "Ralph guard stopped: iteration finished without a new commit or COMPLETE signal."
    exit 1
  fi

  local commit
  while IFS= read -r commit; do
    validate_commit_scope "${commit}"
  done <<< "${commits}"
}

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

run_iteration() {
  codex exec \
    --cd "$(pwd)" \
    --sandbox danger-full-access \
    --output-last-message "${LAST_MESSAGE_FILE}" \
    "$(build_prompt)"
}

run_guarded_iteration() {
  local iteration="$1"
  local before_head
  local result

  ensure_clean_worktree "before iteration ${iteration}"
  before_head="$(git rev-parse HEAD)"
  result="$(run_iteration)"

  echo "${result}"

  if [[ "${result}" == *"<promise>COMPLETE</promise>"* ]]; then
    ensure_clean_worktree "after COMPLETE"
    echo "PRD complete after ${iteration} iterations."
    exit 0
  fi

  ensure_clean_worktree "after iteration ${iteration}"
  validate_new_commits "${before_head}"
}

if is_positive_integer "${MODE}"; then
  max_iterations="${MODE}"
elif [ "${MODE}" = "until-complete" ]; then
  max_iterations=0
else
  echo "Usage: $0 <iterations|until-complete>"
  exit 1
fi

i=1
while [ "${max_iterations}" -eq 0 ] || [ "${i}" -le "${max_iterations}" ]; do
  run_guarded_iteration "${i}"
  i=$((i + 1))
done
