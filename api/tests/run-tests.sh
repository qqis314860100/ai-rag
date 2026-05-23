#!/bin/bash
# ============================================================
# RAG 知识库 API 集成测试执行脚本
#
# 用法:
#   ./tests/run-tests.sh                    # 使用默认 localhost:3001
#   API_BASE_URL=http://host:3001 ./tests/run-tests.sh  # 指定 API 地址
#
# 前置条件:
#   1. API 服务已启动 (api)
#   2. RAG 服务已启动 (rag)
#   3. 知识库已索引 (至少有种子文档)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="${SCRIPT_DIR}/api"
BASE_URL="${API_BASE_URL:-http://localhost:3001}"
export API_BASE_URL="${BASE_URL}"

echo "============================================"
echo "  RAG Knowledge Base API Integration Tests"
echo "============================================"
echo "  API Base URL: ${BASE_URL}"
echo "  Date: $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================"
echo ""

# 检查 API 是否可达
echo "[0/6] Checking API availability..."
if ! curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${BASE_URL}/api/admin/health" > /dev/null 2>&1; then
  echo ""
  echo "ERROR: API at ${BASE_URL} is not reachable."
  echo "Please start the API server before running tests:"
  echo "  cd api && pnpm dev"
  echo ""
  exit 1
fi
echo "  API is reachable."
echo ""

# 测试结果统计
TOTAL=0
PASSED=0
FAILED=0
FAILED_TESTS=()

run_test() {
  local name="$1"
  local script="$2"
  TOTAL=$((TOTAL + 1))

  echo "----------------------------------------"
  echo "[${TOTAL}/6] Running: ${name}"
  echo "----------------------------------------"

  if bash "${script}" 2>&1; then
    PASSED=$((PASSED + 1))
    echo ""
    return 0
  else
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("${name}")
    echo ""
    return 1
  fi
}

# 依次执行测试（顺序执行以保持输出清晰）
run_test "Health Check"           "${API_DIR}/test-health.sh"        || true
run_test "Search Request"         "${API_DIR}/test-search.sh"        || true
run_test "Chat / Q&A Request"     "${API_DIR}/test-chat.sh"          || true
run_test "Document Upload"        "${API_DIR}/test-upload.sh"        || true
run_test "Debug Search"           "${API_DIR}/test-debug-search.sh"  || true
run_test "Out-of-Scope Refusal"   "${API_DIR}/test-refusal.sh"       || true

echo ""
echo "============================================"
echo "  Test Results Summary"
echo "============================================"
echo "  Total:   ${TOTAL}"
echo "  Passed:  ${PASSED}"
echo "  Failed:  ${FAILED}"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo "  Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do
    echo "    - ${t}"
  done
  echo ""
  echo "============================================"
  exit 1
else
  echo "  All tests passed!"
  echo ""
  echo "  Next steps:"
  echo "    1. Run manual evals using evals/questions.json"
  echo "    2. Review RAG correctness with evals/rag-eval-checklist.md"
  echo "    3. Verify UI with docs/qa/ui-checklist.md"
  echo ""
  echo "============================================"
  exit 0
fi
