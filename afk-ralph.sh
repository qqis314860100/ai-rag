#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <iterations|until-complete>"
  exit 1
fi

LAST_MESSAGE_FILE="${RALPH_LAST_MESSAGE_FILE:-.git/ralph-loop.last.md}"
STATUS_FILE="${RALPH_STATUS_FILE:-.git/ralph-loop.status.md}"
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

commit_touches_service() {
  local files="$1"
  if printf '%s\n' "${files}" | awk -F/ '$1 == "web" || $1 == "api" || $1 == "rag" { found = 1 } END { exit(found ? 0 : 1) }'; then
    return 0
  fi
  return 1
}

commit_touches_status_files() {
  local files="$1"
  if printf '%s\n' "${files}" | awk '$0 == "PRD.md" || $0 == "progress.txt" { found = 1 } END { exit(found ? 0 : 1) }'; then
    return 0
  fi
  return 1
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
  local has_service_commit=0
  local has_status_commit=0
  local last_commit=""
  while IFS= read -r commit; do
    local files
    files="$(git diff-tree --no-commit-id --name-only -r "${commit}")"

    validate_commit_scope "${commit}"

    if commit_touches_service "${files}"; then
      has_service_commit=1
    fi

    if commit_touches_status_files "${files}"; then
      has_status_commit=1
    fi

    last_commit="${commit}"
  done <<< "${commits}"

  if [ "${has_service_commit}" -eq 0 ]; then
    echo "Ralph guard stopped: iteration finished without a service commit."
    exit 1
  fi

  if [ "${has_status_commit}" -eq 0 ]; then
    echo "Ralph guard stopped: iteration finished without a progress/PRD status commit."
    exit 1
  fi

  local last_files
  last_files="$(git diff-tree --no-commit-id --name-only -r "${last_commit}")"
  if [ -n "$(printf '%s\n' "${last_files}" | awk '$0 != "PRD.md" && $0 != "progress.txt" { print }')" ]; then
    echo "Ralph guard stopped: iteration must end with a progress/PRD status commit."
    printf '%s\n' "${last_files}"
    exit 1
  fi
}

build_status() {
  {
    printf '%s\n' "@AGENTS.md"
    printf '%s\n' "@PRD.md"
    printf '\n%s\n' "## 进度摘要"
    sed -n '1,14p' progress.txt
    printf '\n%s\n' "## 本轮要做"
    sed -n '/^## 下一轮建议$/,/^## 执行提醒$/p' progress.txt | sed -n '2,6p'
    printf '\n%s\n' "## 本轮要求"
    printf '%s\n' "1. 只做当前最高优先级的一个任务。"
    printf '%s\n' "2. 只改一个服务。"
    printf '%s\n' "3. 用最小验证，过了再提交。"
    printf '%s\n' "4. 先提交任务代码，再提交 progress.txt / PRD.md 状态。"
    printf '%s\n' "5. 状态提交后不要停，脚本会自动进入下一轮。"
    printf '%s\n' "6. 提交信息用 Conventional Commits，描述用中文。"
    printf '%s\n' "7. 如果 PRD 已完成，输出 <promise>COMPLETE</promise>。"
    printf '\n%s\n' "请直接执行本轮要做的任务，不要只复述摘要。"
  } > "${STATUS_FILE}"
}

build_prompt() {
  build_status
  printf '@%s\n' "${STATUS_FILE}"
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
