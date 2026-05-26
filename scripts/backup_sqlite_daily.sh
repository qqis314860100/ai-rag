#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${DB_PATH:-${ROOT_DIR}/api/data/app.db}"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/data/backups/sqlite}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT="${BACKUP_DIR}/ai-rag-${STAMP}.db"

mkdir -p "${BACKUP_DIR}"

if [ ! -f "${DB_PATH}" ]; then
  echo "SQLite database not found: ${DB_PATH}" >&2
  exit 1
fi

# 优先使用 sqlite3 在线备份；本地环境缺 sqlite3 时退回文件复制。
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB_PATH}" ".backup '${OUT}'"
else
  cp "${DB_PATH}" "${OUT}"
fi

find "${BACKUP_DIR}" -name 'ai-rag-*.db' -type f -mtime "+${KEEP_DAYS}" -delete

echo "${OUT}"
