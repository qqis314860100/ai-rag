#!/usr/bin/env bash
set -euo pipefail

STATUS_FILE="${RALPH_STATUS_FILE:-.git/ralph-loop.status.md}"

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
    printf '%s\n' "4. 进度写回 progress.txt。"
    printf '%s\n' "5. 提交信息用 Conventional Commits，描述用中文。"
    printf '%s\n' "6. 如果 PRD 已完成，输出 <promise>COMPLETE</promise>。"
    printf '\n%s\n' "请直接执行本轮要做的任务，不要只复述摘要。"
  } > "${STATUS_FILE}"
}

PROMPT="@${STATUS_FILE}"

LAST_MESSAGE_FILE="${RALPH_LAST_MESSAGE_FILE:-.ralph-loop.last.md}"

run_agent() {
  build_status
  codex exec \
    --cd "$(pwd)" \
    --sandbox danger-full-access \
    --output-last-message "${LAST_MESSAGE_FILE}" \
    "${PROMPT}"
}

run_agent
