#!/bin/bash
# ============================================================
# API 测试: 回答引用只读详情契约
# ============================================================
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"
OWNER_ID="qa-source-owner-$(date +%s)"
INTRUDER_ID="qa-source-intruder-$(date +%s)"
OWNER_ROLE="process_engineer"
INTRUDER_ROLE="process_engineer"

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local user_id="${4:-}"
  local user_role="${5:-}"

  local args=(-sS -w "\n%{http_code}" -X "${method}" -H "Content-Type: application/json")
  if [ -n "${user_id}" ]; then
    args+=(-H "x-user-id: ${user_id}" -H "x-user-role: ${user_role}" -H "x-user-name: ${user_id}")
  fi
  if [ -n "${body}" ]; then
    args+=(-d "${body}")
  fi

  curl "${args[@]}" "${BASE_URL}${path}"
}

json_path() {
  python3 -c '
import json
import sys

path = sys.argv[1].split(".")
data = json.load(sys.stdin)
for part in path:
  if isinstance(data, list):
    data = data[int(part)]
  elif isinstance(data, dict):
    data = data[part]
  else:
    raise SystemExit(1)
print("" if data is None else data)
' "$1"
}

url_encode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

assert_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [ "${actual}" != "${expected}" ]; then
    echo "FAIL: ${label} (expected ${expected}, got ${actual})"
    exit 1
  fi
}

assert_non_empty() {
  local value="$1"
  local label="$2"
  if [ -z "${value}" ]; then
    echo "FAIL: ${label} should not be empty"
    exit 1
  fi
}

echo "=== Test: Source detail contract ==="
echo "Base URL: ${BASE_URL}"

QUESTION="Ralph source detail smoke: 请说明 Busbar 激光焊接的一个关键控制点。"
CHAT_BODY="$(python3 -c 'import json,sys; print(json.dumps({"message": sys.argv[1], "stream": False, "top_k": 3}))' "${QUESTION}")"
CREATE_RESPONSE="$(request POST /api/chat "${CHAT_BODY}" "${OWNER_ID}" "${OWNER_ROLE}")"
CREATE_HTTP_CODE="$(printf '%s' "${CREATE_RESPONSE}" | tail -1)"
CREATE_BODY="$(printf '%s' "${CREATE_RESPONSE}" | sed '$d')"
assert_status "${CREATE_HTTP_CODE}" "200" "owner chat creation"

SESSION_ID="$(printf '%s' "${CREATE_BODY}" | json_path data.session_id)"
MESSAGE_ID="$(printf '%s' "${CREATE_BODY}" | json_path data.message_id)"
SOURCE_COUNT="$(printf '%s' "${CREATE_BODY}" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("data", {}).get("sources", [])))')"
assert_non_empty "${SESSION_ID}" "session_id"
assert_non_empty "${MESSAGE_ID}" "assistant message_id"
if [ "${SOURCE_COUNT}" -le 0 ]; then
  echo "FAIL: chat response did not include sources"
  exit 1
fi
echo "PASS: created answer ${MESSAGE_ID} with ${SOURCE_COUNT} source(s)"

SESSION_RESPONSE="$(request GET "/api/chat/sessions/${SESSION_ID}" "" "${OWNER_ID}" "${OWNER_ROLE}")"
SESSION_HTTP_CODE="$(printf '%s' "${SESSION_RESPONSE}" | tail -1)"
SESSION_BODY="$(printf '%s' "${SESSION_RESPONSE}" | sed '$d')"
assert_status "${SESSION_HTTP_CODE}" "200" "load owner session"
USER_MESSAGE_ID="$(printf '%s' "${SESSION_BODY}" | json_path data.messages.0.id)"

LIST_RESPONSE="$(request GET "/api/chat/messages/${MESSAGE_ID}/sources" "" "${OWNER_ID}" "${OWNER_ROLE}")"
LIST_HTTP_CODE="$(printf '%s' "${LIST_RESPONSE}" | tail -1)"
LIST_BODY="$(printf '%s' "${LIST_RESPONSE}" | sed '$d')"
assert_status "${LIST_HTTP_CODE}" "200" "list source details"

DETAIL_COUNT="$(printf '%s' "${LIST_BODY}" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("data", {}).get("items", [])))')"
if [ "${DETAIL_COUNT}" -le 0 ]; then
  echo "FAIL: source detail list is empty"
  exit 1
fi

SOURCE_ID="$(printf '%s' "${LIST_BODY}" | json_path data.items.0.id)"
CHUNK_ID="$(printf '%s' "${LIST_BODY}" | json_path data.items.0.chunk_id)"
DOCUMENT_TITLE="$(printf '%s' "${LIST_BODY}" | json_path data.items.0.document_title)"
CHUNK_ENDPOINT="$(printf '%s' "${LIST_BODY}" | json_path data.items.0.preview.chunk_endpoint)"
assert_non_empty "${SOURCE_ID}" "source id"
assert_non_empty "${CHUNK_ID}" "chunk id"
assert_non_empty "${DOCUMENT_TITLE}" "document title"
assert_non_empty "${CHUNK_ENDPOINT}" "chunk preview endpoint"
echo "PASS: source list returns contract fields"

ENCODED_SOURCE_ID="$(url_encode "${SOURCE_ID}")"
DETAIL_RESPONSE="$(request GET "/api/chat/messages/${MESSAGE_ID}/sources/${ENCODED_SOURCE_ID}" "" "${OWNER_ID}" "${OWNER_ROLE}")"
DETAIL_HTTP_CODE="$(printf '%s' "${DETAIL_RESPONSE}" | tail -1)"
DETAIL_BODY="$(printf '%s' "${DETAIL_RESPONSE}" | sed '$d')"
assert_status "${DETAIL_HTTP_CODE}" "200" "source detail by id"
DETAIL_CHUNK_ID="$(printf '%s' "${DETAIL_BODY}" | json_path data.chunk_id)"
if [ "${DETAIL_CHUNK_ID}" != "${CHUNK_ID}" ]; then
  echo "FAIL: detail chunk_id mismatch"
  exit 1
fi
echo "PASS: source detail can be loaded by source id"

INTRUDER_RESPONSE="$(request GET "/api/chat/messages/${MESSAGE_ID}/sources/${ENCODED_SOURCE_ID}" "" "${INTRUDER_ID}" "${INTRUDER_ROLE}")"
INTRUDER_HTTP_CODE="$(printf '%s' "${INTRUDER_RESPONSE}" | tail -1)"
assert_status "${INTRUDER_HTTP_CODE}" "403" "non-owner source detail"
echo "PASS: non-owner cannot read source detail"

MISSING_RESPONSE="$(request GET "/api/chat/messages/${MESSAGE_ID}/sources/missing-source" "" "${OWNER_ID}" "${OWNER_ROLE}")"
MISSING_HTTP_CODE="$(printf '%s' "${MISSING_RESPONSE}" | tail -1)"
assert_status "${MISSING_HTTP_CODE}" "404" "missing source detail"
echo "PASS: missing source returns 404"

USER_SOURCES_RESPONSE="$(request GET "/api/chat/messages/${USER_MESSAGE_ID}/sources" "" "${OWNER_ID}" "${OWNER_ROLE}")"
USER_SOURCES_HTTP_CODE="$(printf '%s' "${USER_SOURCES_RESPONSE}" | tail -1)"
assert_status "${USER_SOURCES_HTTP_CODE}" "400" "user message source list"
echo "PASS: user messages reject source detail"

echo "=== Source detail contract: PASS ==="
