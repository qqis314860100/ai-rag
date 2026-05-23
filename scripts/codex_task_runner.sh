#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUEUE_DIR="${CODEX_TASK_QUEUE_DIR:-${ROOT_DIR}/.codex/task-queue}"
PENDING_DIR="${QUEUE_DIR}/pending"
RUNNING_DIR="${QUEUE_DIR}/running"
DONE_DIR="${QUEUE_DIR}/done"
FAILED_DIR="${QUEUE_DIR}/failed"
LOG_DIR="${QUEUE_DIR}/logs"
LOCK_DIR="${QUEUE_DIR}/runner.lock"
MAX_TASKS="${CODEX_TASK_MAX_TASKS:-1}"

mkdir -p "${PENDING_DIR}" "${RUNNING_DIR}" "${DONE_DIR}" "${FAILED_DIR}" "${LOG_DIR}"

if ! command -v codex >/dev/null 2>&1; then
  echo "ERROR: codex CLI not found in PATH" >&2
  exit 1
fi

if [[ "${CODEX_TASK_ALLOW_DIRTY:-0}" != "1" ]]; then
  if [[ -n "$(git -C "${ROOT_DIR}" status --porcelain)" ]]; then
    echo "ERROR: worktree is dirty. Resolve or set CODEX_TASK_ALLOW_DIRTY=1." >&2
    git -C "${ROOT_DIR}" status --short >&2
    exit 1
  fi
fi

run_task() {
  local task_path="$1"
  local task_name timestamp running_path log_path final_path prompt

  task_name="$(basename "${task_path}")"
  timestamp="$(date '+%Y%m%d-%H%M%S')"
  running_path="${RUNNING_DIR}/${timestamp}-${task_name}"
  log_path="${LOG_DIR}/${timestamp}-${task_name%.md}.log"
  final_path="${LOG_DIR}/${timestamp}-${task_name%.md}.final.md"

  mv "${task_path}" "${running_path}"

  prompt="$(cat <<EOF
你是这个仓库的 Codex 自动任务执行器。请严格遵守仓库规则：

1. 先阅读 CLAUDE.md、docs/EXECUTION_RULES.md、docs/CONTRIBUTING.md、docs/架构标准.md。
2. 一次只处理当前任务文件描述的任务。
3. 不要回滚或覆盖用户已有改动。
4. 如果工作区有无关脏改动，只忽略；如果直接冲突，停止并说明。
5. 修改后必须运行相关验证。
6. 功能或 bug 修复必须真实验证通过后才提交。
7. commit 必须使用仓库约定的 Conventional Commits，不包含 AI footer。
8. 如果无法安全完成，说明原因，不要强行提交。

当前任务文件：
${running_path}

任务内容：
$(cat "${running_path}")
EOF
)"

  echo "[$(date '+%F %T')] start ${task_name}" | tee "${log_path}"

  if codex exec \
    --cd "${ROOT_DIR}" \
    --sandbox danger-full-access \
    --ask-for-approval never \
    --output-last-message "${final_path}" \
    "${prompt}" >>"${log_path}" 2>&1; then
    mv "${running_path}" "${DONE_DIR}/${timestamp}-${task_name}"
    echo "[$(date '+%F %T')] done ${task_name}" | tee -a "${log_path}"
    return 0
  fi

  mv "${running_path}" "${FAILED_DIR}/${timestamp}-${task_name}"
  echo "[$(date '+%F %T')] failed ${task_name}" | tee -a "${log_path}"
  return 1
}

main() {
  local count=0

  if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
    echo "Another Codex task runner is already active."
    exit 0
  fi
  trap 'rmdir "${LOCK_DIR}" 2>/dev/null || true' EXIT

  while (( count < MAX_TASKS )); do
    local next_task
    next_task="$(find "${PENDING_DIR}" -maxdepth 1 -type f -name '*.md' | sort | head -n 1)"
    if [[ -z "${next_task}" ]]; then
      echo "No pending Codex tasks."
      break
    fi

    run_task "${next_task}"
    count=$((count + 1))
  done
}

main "$@"
