#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUEUE_DIR="${CODEX_TASK_QUEUE_DIR:-${ROOT_DIR}/.codex/task-queue}"
PENDING_DIR="${QUEUE_DIR}/pending"

mkdir -p "${PENDING_DIR}"

title="${1:-}"
if [[ -z "${title}" ]]; then
  echo "Usage: scripts/codex_task_add.sh <task-title> [task-body]" >&2
  exit 1
fi

body="${2:-${title}}"
slug="$(echo "${title}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9一-龥]+/-/g; s/^-+|-+$//g')"
timestamp="$(date '+%Y%m%d-%H%M%S')"
task_file="${PENDING_DIR}/${timestamp}-${slug:-task}.md"

cat >"${task_file}" <<EOF
# ${title}

## 任务

${body}

## 验收

- 遵守仓库提交与验证规则。
- 如果需要改代码，验证通过后提交。
- 如果无法安全完成，写清楚阻塞原因。
EOF

echo "${task_file}"
