#!/bin/bash
# ============================================================
# API 测试: 搜索请求验证有结果
# 使用知识库中明确存在的专业术语进行语义搜索
# ============================================================
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"
echo "=== Test 2: Search Request ==="
echo "POST ${BASE_URL}/api/search"

# 使用 Batch 5 个典型查询测试检索
QUERIES=(
  "Busbar激光焊接关键参数"
  "电芯分选OCV测试标准"
  "模组绝缘电阻测试"
  "激光安全防护要求"
  "MES产品追溯"
)

PASS_COUNT=0
FAIL_COUNT=0

for QUERY in "${QUERIES[@]}"; do
  echo ""
  echo "--- Query: ${QUERY} ---"

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "${BASE_URL}/api/search" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"${QUERY}\", \"top_k\": 3}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  echo "HTTP Status: ${HTTP_CODE}"

  if [ "$HTTP_CODE" != "200" ]; then
    echo "FAIL: HTTP ${HTTP_CODE}"
    ((FAIL_COUNT++))
    continue
  fi

  # 验证有 results 数组且不为空
  RESULT_COUNT=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
results = d.get('data', {}).get('results', [])
print(len(results))
" 2>/dev/null || echo "0")

  if [ "$RESULT_COUNT" -eq 0 ]; then
    echo "FAIL: No results returned for '${QUERY}'"
    ((FAIL_COUNT++))
  else
    # 打印 top result 信息
    TOP_SCORE=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
results = d.get('data', {}).get('results', [])
if results:
    r = results[0]
    print(f\"  doc: {r.get('document_title','?')[:40]}  score: {r.get('score',0):.4f}\")
" 2>/dev/null || echo "")
    echo "PASS: ${RESULT_COUNT} results found. ${TOP_SCORE}"
    ((PASS_COUNT++))
  fi
done

echo ""
echo "=== Search Summary: ${PASS_COUNT} passed, ${FAIL_COUNT} failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
