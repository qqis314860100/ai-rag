#!/bin/bash
# ============================================================
# API 测试: 调试搜索 + 验证有 trace/latency/prompt 信息
# ============================================================
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"
echo "=== Test 5: Debug Search ==="
echo "POST ${BASE_URL}/api/search/debug"

QUERY="Busbar焊接熔深标准"
echo "Query: ${QUERY}"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${BASE_URL}/api/search/debug" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"${QUERY}\", \"top_k\": 5, \"mode\": \"vector\", \"include_prompt\": true}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: ${HTTP_CODE}"
echo ""

if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: HTTP ${HTTP_CODE}"
  echo "Body: $(echo "$BODY" | head -c 300)"
  exit 1
fi

PASS=true

# 验证 retrieval 信息
RETRIEVAL_MODE=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
ret = data.get('retrieval', {})
print(ret.get('mode', ''))
" 2>/dev/null || echo "")

RETRIEVAL_LATENCY=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
ret = data.get('retrieval', {})
print(ret.get('latency_ms', -1))
" 2>/dev/null || echo "-1")

# 验证 context 统计
CONTEXT_CHARS=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
print(data.get('context_chars', -1))
" 2>/dev/null || echo "-1")

ESTIMATED_TOKENS=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
print(data.get('estimated_tokens', -1))
" 2>/dev/null || echo "-1")

# 验证 results
RESULT_COUNT=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
ret = data.get('retrieval', {})
results = ret.get('results', [])
print(len(results))
" 2>/dev/null || echo "0")

echo "Retrieval Mode: ${RETRIEVAL_MODE}"
echo "Retrieval Latency: ${RETRIEVAL_LATENCY}ms"
echo "Context Chars: ${CONTEXT_CHARS}"
echo "Estimated Tokens: ${ESTIMATED_TOKENS}"
echo "Result Count: ${RESULT_COUNT}"

# 各字段验证
if [ -z "$RETRIEVAL_MODE" ]; then
  echo "FAIL: retrieval.mode missing"
  PASS=false
fi

if [ "$RETRIEVAL_LATENCY" = "-1" ] || [ -z "$RETRIEVAL_LATENCY" ]; then
  echo "FAIL: retrieval.latency_ms missing"
  PASS=false
fi

if [ "$CONTEXT_CHARS" = "-1" ] || [ "$CONTEXT_CHARS" = "0" ]; then
  echo "FAIL: context_chars missing or zero"
  PASS=false
fi

if [ "$RESULT_COUNT" = "0" ]; then
  echo "FAIL: No results found"
  PASS=false
fi

# 检查 include_prompt 是否生效
HAS_PROMPT=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
pp = data.get('prompt_preview', '')
print('yes' if pp else 'no')
" 2>/dev/null || echo "no")

echo "Prompt Preview Available: ${HAS_PROMPT}"

if [ "$PASS" = true ]; then
  echo ""
  echo "=== Debug Search: PASS ==="
else
  echo ""
  echo "=== Debug Search: FAIL ==="
  exit 1
fi
