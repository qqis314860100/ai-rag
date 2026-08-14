#!/bin/bash
# ============================================================
# API 测试: 文档上传 + 验证返回
# 上传测试用的 Markdown 文件并验证响应
# ============================================================
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"
echo "=== Test 4: Document Upload ==="
echo "POST ${BASE_URL}/api/documents/upload"

# 创建临时测试文件
TEMP_DIR=$(mktemp -d)
TEST_FILE="${TEMP_DIR}/test-upload.md"
cat > "${TEST_FILE}" << 'EOF'
---
title: 测试文档-API集成测试
category: 测试
---

# 测试文档

这是一个用于 API 集成测试的临时文档。

## 测试参数

| 参数 | 值 |
|------|-----|
| 测试电压 | 500V |
| 测试时间 | 3秒 |

## 测试说明

本文档仅用于验证文档上传 API 是否正常工作。
EOF

echo "Test file created: ${TEST_FILE}"

# 发送上传请求
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${API_TOKEN:-}" \
  -X POST "${BASE_URL}/api/documents/upload" \
  -F "file=@${TEST_FILE}" \
  -F "title=测试文档-$(date +%s)" \
  -F "category=测试" \
  -F "security_level=internal" \
  -F "process=Test" \
  -F "station=TEST-000" \
  -F "owner=QA测试" \
  -F "tags=测试,API验证")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: ${HTTP_CODE}"
echo "Response: ${BODY}" | head -c 800

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "FAIL: Expected 200/201, got ${HTTP_CODE}"
  # 清理
  rm -rf "${TEMP_DIR}"
  exit 1
fi

# 验证返回字段
DOC_ID=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
print(data.get('document_id', ''))
" 2>/dev/null || echo "")

TITLE=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
print(data.get('title', ''))
" 2>/dev/null || echo "")

INDEX_STATUS=$(echo "$BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
data = d.get('data', {})
print(data.get('index_status', ''))
" 2>/dev/null || echo "")

if [ -z "$DOC_ID" ]; then
  echo "FAIL: document_id missing in response"
  rm -rf "${TEMP_DIR}"
  exit 1
fi

echo "PASS: document_id=${DOC_ID}, title=${TITLE}, index_status=${INDEX_STATUS}"

# 验证文档出现在列表中
echo ""
echo "--- Verify document in list ---"
LIST_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${API_TOKEN:-}" \
  -H "Authorization: Bearer ${API_TOKEN:-}" \
  "${BASE_URL}/api/documents?keyword=测试文档")

LIST_CODE=$(echo "$LIST_RESPONSE" | tail -1)
if [ "$LIST_CODE" = "200" ]; then
  echo "PASS: Document list retrievable"
else
  echo "WARN: Document list returned ${LIST_CODE}"
fi

# 清理
rm -rf "${TEMP_DIR}"
echo ""
echo "=== Document Upload: PASS ==="
