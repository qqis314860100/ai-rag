#!/usr/bin/env bash
# 全仓 lint：RAG ruff（优先 venv）+ API/Web TypeScript 类型检查
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[1/2] RAG ruff"
RUFF=""
if [ -x "$ROOT/rag/.venv/bin/ruff" ]; then
  RUFF="$ROOT/rag/.venv/bin/ruff"
elif command -v ruff >/dev/null 2>&1; then
  RUFF="$(command -v ruff)"
else
  echo "ruff is not installed. Install rag dev deps first: pip install -e ./rag[dev]" >&2
  exit 1
fi
"$RUFF" check rag/app

echo "[2/2] TS typecheck (api + web)"
pnpm --filter api exec tsc
pnpm --filter web exec tsc

echo "Lint passed"
