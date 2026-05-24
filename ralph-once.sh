#!/usr/bin/env bash
set -euo pipefail

STATUS_FILE="${RALPH_STATUS_FILE:-.git/ralph-loop.status.md}"
QUEUE_SCRIPT="${RALPH_QUEUE_SCRIPT:-scripts/ralph_task_queue.py}"

next_task() {
  python3 "${QUEUE_SCRIPT}" --mode next
}

build_status() {
  local current_task
  local remaining_tasks
  current_task="$(next_task)"
  remaining_tasks="$(python3 "${QUEUE_SCRIPT}" --mode remaining)"

  {
    printf '%s\n' "@AGENTS.md"
    printf '%s\n' "@PRD.md"
    printf '\n%s\n' "## 进度摘要"
    sed -n '1,24p' progress.txt
    printf '\n%s\n' "## 自动任务队列"
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
    printf '%s\n' "2. 只改一个服务。"
    printf '%s\n' "3. 用最小验证，过了再提交。"
    printf '%s\n' "4. 完成后把 PRD.md 对应任务标记为 [x]，并追加 progress.txt 记录。"
    printf '%s\n' "5. 先提交任务代码，再提交 progress.txt / PRD.md 状态。"
    printf '%s\n' "6. 状态提交后不要停，脚本会自动进入下一轮。"
    printf '%s\n' "7. 提交信息用 Conventional Commits，描述用中文。"
    printf '%s\n' "8. 如果自动任务队列为空，输出 <promise>COMPLETE</promise>。"
    printf '\n%s\n' "请直接执行本轮要做的任务，不要只复述摘要。"
  } > "${STATUS_FILE}"
}

PROMPT="@${STATUS_FILE}"

LAST_MESSAGE_FILE="${RALPH_LAST_MESSAGE_FILE:-.ralph-loop.last.md}"

run_agent() {
  if [ -z "$(next_task)" ]; then
    printf '%s\n' "<promise>COMPLETE</promise>"
    exit 0
  fi
  build_status
  codex exec \
    --cd "$(pwd)" \
    --sandbox danger-full-access \
    --output-last-message "${LAST_MESSAGE_FILE}" \
    "${PROMPT}"
}

run_agent
