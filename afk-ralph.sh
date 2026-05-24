#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <iterations|until-complete>"
  exit 1
fi

LAST_MESSAGE_FILE="${RALPH_LAST_MESSAGE_FILE:-.git/ralph-loop.last.md}"
STATUS_FILE="${RALPH_STATUS_FILE:-.git/ralph-loop.status.md}"
QUEUE_SCRIPT="${RALPH_QUEUE_SCRIPT:-scripts/ralph_task_queue.py}"
QUEUE_PREVIEW_LIMIT="${RALPH_QUEUE_PREVIEW_LIMIT:-12}"
MODE="${1}"

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

next_task() {
  python3 "${QUEUE_SCRIPT}" --mode next
}

remaining_task_count() {
  python3 "${QUEUE_SCRIPT}" --mode count
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

validate_new_commits() {
  local before_head="$1"
  local commits
  commits="$(git rev-list --reverse "${before_head}..HEAD")"

  if [ -z "${commits}" ]; then
    echo "Ralph guard stopped: iteration finished without a new commit or COMPLETE signal."
    exit 1
  fi
}

validate_queue_advanced() {
  local before_count="$1"
  local after_count="$2"
  local iteration="$3"

  if [ "${after_count}" -ge "${before_count}" ]; then
    echo "Ralph guard stopped: PRD task queue did not advance in iteration ${iteration}."
    echo "Before remaining: ${before_count}"
    echo "After remaining:  ${after_count}"
    exit 1
  fi
}

build_status() {
  local current_task
  local remaining_count
  local remaining_tasks
  current_task="$(next_task)"
  remaining_count="$(remaining_task_count)"
  remaining_tasks="$(python3 "${QUEUE_SCRIPT}" --mode remaining --limit "${QUEUE_PREVIEW_LIMIT}")"

  {
    printf '%s\n' "@AGENTS.md"
    printf '\n%s\n' "## 任务来源"
    printf '%s\n' "PRD.md 是任务队列来源，但本轮不要整份读取 PRD。需要勾选完成项时，用本轮任务文本通过 rg 定位对应 checkbox。"
    printf '\n%s\n' "## 进度摘要"
    sed -n '1,24p' progress.txt
    printf '\n%s\n' "## 自动任务队列"
    printf '剩余任务数：%s\n' "${remaining_count}"
    if [ -n "${remaining_tasks}" ]; then
      printf '%s\n' "${remaining_tasks}"
    else
      printf '%s\n' "无剩余任务。"
    fi
    printf '\n%s\n' "## 本轮要做"
    if [ -n "${current_task}" ]; then
      printf '%s\n' "${current_task}"
    else
      printf '%s\n' "<promise>COMPLETE</promise>"
    fi
    printf '\n%s\n' "## 本轮要求"
    printf '%s\n' "1. 只执行自动任务队列第 1 条，不要跳任务。"
    printf '%s\n' "2. 只做一个主题；允许同主题少量跨服务，但不要混入无关改动。"
    printf '%s\n' "3. 按普通/高风险两档选择最小验证；普通改动不要跑全量流程。"
    printf '%s\n' "4. 完成后把 PRD.md 对应任务标记为 [x]，允许和功能代码放在同一个提交里以推进队列。"
    printf '%s\n' "5. 不要每轮都更新 progress.txt；只在阶段完成、阻塞、范围变化或 loop 结束时同步。"
    printf '%s\n' "6. 提交信息用 Conventional Commits，描述用中文。"
    printf '%s\n' "7. 如果自动任务队列为空，输出 <promise>COMPLETE</promise>。"
    printf '%s\n' "8. 控制上下文：不要读取整份 PRD、完整 progress、构建产物或长日志；需要证据时只截取关键片段。"
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
  local before_count
  local after_count
  local result

  if [ -z "$(next_task)" ]; then
    echo "<promise>COMPLETE</promise>"
    echo "PRD complete before iteration ${iteration}."
    exit 0
  fi

  ensure_clean_worktree "before iteration ${iteration}"
  before_head="$(git rev-parse HEAD)"
  before_count="$(remaining_task_count)"
  result="$(run_iteration)"

  echo "${result}"

  if [[ "${result}" == *"<promise>COMPLETE</promise>"* ]]; then
    ensure_clean_worktree "after COMPLETE"
    after_count="$(remaining_task_count)"
    if [ "${after_count}" -eq 0 ]; then
      echo "PRD complete after ${iteration} iterations."
      exit 0
    fi
    echo "Ralph guard stopped: COMPLETE was emitted but ${after_count} PRD task(s) remain."
    exit 1
  fi

  ensure_clean_worktree "after iteration ${iteration}"
  validate_new_commits "${before_head}"
  after_count="$(remaining_task_count)"
  validate_queue_advanced "${before_count}" "${after_count}" "${iteration}"

  if [ "${after_count}" -eq 0 ]; then
    echo "<promise>COMPLETE</promise>"
    echo "PRD complete after ${iteration} iterations."
    exit 0
  fi
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
