#!/bin/bash
# ============================================================
# API 测试: 问答请求验证有 answer + sources
# ============================================================
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"
echo "=== Test 3: Chat / Q&A Request ==="
echo "POST ${BASE_URL}/api/chat"

QUESTIONS=(
  "电芯分选的OCV开路电压测试合格范围是多少？"
  "模组EOL测试包括哪些项目？"
  "激光焊接区需要佩戴哪些个人防护装备？"
)

PASS_COUNT=0
FAIL_COUNT=0

for QUESTION in "${QUESTIONS[@]}"; do
  echo ""
  echo "--- Question: ${QUESTION} ---"

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "${BASE_URL}/api/chat" \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"${QUESTION}\", \"top_k\": 5}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  echo "HTTP Status: ${HTTP_CODE}"

  if [ "$HTTP_CODE" != "200" ]; then
    echo "FAIL: HTTP ${HTTP_CODE}"
    echo "Body: $(echo "$BODY" | head -c 200)"
    ((FAIL_COUNT++))
    continue
  fi

  # 验证有 answer
  ANSWER_LEN=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ans = d.get('data', {}).get('answer', '')
print(len(ans))
" 2>/dev/null || echo "0")

  # 验证有 sources
  SOURCE_COUNT=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
srcs = d.get('data', {}).get('sources', [])
print(len(srcs))
" 2>/dev/null || echo "0")

  if [ "$ANSWER_LEN" -eq 0 ]; then
    echo "FAIL: Answer is empty"
    ((FAIL_COUNT++))
  elif [ "$SOURCE_COUNT" -eq 0 ]; then
    echo "FAIL: No sources returned"
    ((FAIL_COUNT++))
  else
    echo "PASS: answer=${ANSWER_LEN} chars, sources=${SOURCE_COUNT}"
    echo "  answer preview: $(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('data',{}).get('answer','')[:100])
" 2>/dev/null)"
    ((PASS_COUNT++))
  fi
done

echo ""
echo "=== Chat Summary: ${PASS_COUNT} passed, ${FAIL_COUNT} failed ==="
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
