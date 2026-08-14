#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[1/3] Build web and api"
pnpm build

echo "[2/3] Lint rag"
# Prefer the rag venv's ruff (repo-local), fall back to a global install
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

echo "[3/3] Compile rag"
PYTHON="${PYTHON:-python3}"
if [ -x "$ROOT/rag/.venv/bin/python" ]; then
  PYTHON="$ROOT/rag/.venv/bin/python"
fi
"$PYTHON" -m compileall rag/app

echo "Harness check passed"
