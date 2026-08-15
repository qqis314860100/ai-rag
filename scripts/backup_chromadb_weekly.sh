#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROMA_DIR="${CHROMA_DIR:-${ROOT_DIR}/rag/data/chroma}"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/data/backups/chromadb}"
KEEP_WEEKS="${KEEP_WEEKS:-8}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT="${BACKUP_DIR}/chroma-${STAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"

if [ ! -d "${CHROMA_DIR}" ]; then
  echo "ChromaDB directory not found: ${CHROMA_DIR}" >&2
  exit 1
fi

tar -C "$(dirname "${CHROMA_DIR}")" -czf "${OUT}" "$(basename "${CHROMA_DIR}")"

find "${BACKUP_DIR}" -name 'chroma-*.tar.gz' -type f -mtime "+$((KEEP_WEEKS * 7))" -delete

echo "${OUT}"
