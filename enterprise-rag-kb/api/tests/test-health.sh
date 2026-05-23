#!/bin/bash
# ============================================================
# API 测试: Health Check
# 验证 API 网关健康状态及 RAG 服务连通性
# ============================================================
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"
echo "=== Test 1: Health Check ==="
echo "GET ${BASE_URL}/api/admin/health"

RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/admin/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: ${HTTP_CODE}"
echo "Response: ${BODY}" | head -c 500

# 验证
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: Expected 200, got ${HTTP_CODE}"
  exit 1
fi

# 验证 JSON 结构
STATUS=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('status',''))" 2>/dev/null || echo "")
if [ "$STATUS" != "ok" ]; then
  echo "FAIL: status field not 'ok', got '${STATUS}'"
  exit 1
fi

echo "PASS: Health check returned ok"
echo ""
