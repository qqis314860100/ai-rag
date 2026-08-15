#!/bin/bash
# ============================================================
# API 测试: 聊天消息编辑/删除分支截断与权限校验
# ============================================================
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"
OWNER_ID="qa-owner-$(date +%s)"
INTRUDER_ID="qa-intruder-$(date +%s)"
OWNER_ROLE="viewer"
OWNER_NAME="QA Owner"
INTRUDER_ROLE="viewer"
INTRUDER_NAME="QA Intruder"

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local user_id="${4:-}"
  local user_role="${5:-}"
  local user_name="${6:-}"

  local args=(-sS -w "\n%{http_code}" -X "${method}" -H "Content-Type: application/json")
  if [ -n "${user_id}" ]; then
    args+=(-H "x-user-id: ${user_id}" -H "x-user-role: ${user_role}" -H "x-user-name: ${user_name:-${user_id}}")
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

json_payload() {
  python3 -c '
import json
import sys

kind = sys.argv[1]
text = sys.argv[2]
session_id = sys.argv[3] if len(sys.argv) > 3 else ""
if kind == "chat":
  payload = {"message": text, "stream": False}
  if session_id:
    payload["session_id"] = session_id
  print(json.dumps(payload))
elif kind == "patch":
  print(json.dumps({"content": text}))
else:
  raise SystemExit(1)
' "$1" "$2" "${3:-}"
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

assert_eq() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [ "${actual}" != "${expected}" ]; then
    echo "FAIL: ${label} (expected ${expected}, got ${actual})"
    exit 1
  fi
}

echo "=== Test: Chat branch guards ==="
echo "Base URL: ${BASE_URL}"

OWNER_QUESTION="Ralph API branch smoke: 请用一句话说明 EOL 测试是否正常。"
CREATE_RESPONSE="$(request POST /api/chat "$(json_payload chat "${OWNER_QUESTION}")" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
CREATE_HTTP_CODE="$(printf '%s' "${CREATE_RESPONSE}" | tail -1)"
CREATE_BODY="$(printf '%s' "${CREATE_RESPONSE}" | sed '$d')"
assert_status "${CREATE_HTTP_CODE}" "200" "owner chat creation"

SESSION_ID="$(printf '%s' "${CREATE_BODY}" | json_path data.session_id)"
if [ -z "${SESSION_ID}" ]; then
  echo "FAIL: session_id missing from chat response"
  exit 1
fi
echo "PASS: created session ${SESSION_ID}"

SESSION_RESPONSE="$(request GET /api/chat/sessions/${SESSION_ID} "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
SESSION_HTTP_CODE="$(printf '%s' "${SESSION_RESPONSE}" | tail -1)"
SESSION_BODY="$(printf '%s' "${SESSION_RESPONSE}" | sed '$d')"
assert_status "${SESSION_HTTP_CODE}" "200" "load session detail"

MESSAGE_COUNT="$(printf '%s' "${SESSION_BODY}" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["messages"]))')"
assert_eq "${MESSAGE_COUNT}" "2" "owner session should have user + assistant messages"

USER_MESSAGE_ID="$(printf '%s' "${SESSION_BODY}" | json_path data.messages.0.id)"
USER_MESSAGE_ROLE="$(printf '%s' "${SESSION_BODY}" | json_path data.messages.0.role)"
ASSISTANT_MESSAGE_ID="$(printf '%s' "${SESSION_BODY}" | json_path data.messages.1.id)"
ASSISTANT_MESSAGE_ROLE="$(printf '%s' "${SESSION_BODY}" | json_path data.messages.1.role)"
assert_eq "${USER_MESSAGE_ROLE}" "user" "first message role"
assert_eq "${ASSISTANT_MESSAGE_ROLE}" "assistant" "second message role"

echo "PASS: session contains user ${USER_MESSAGE_ID} and assistant ${ASSISTANT_MESSAGE_ID}"

echo "--- assistant message guards ---"
ASSISTANT_PATCH_RESPONSE="$(request PATCH /api/chat/messages/${ASSISTANT_MESSAGE_ID} "$(json_payload patch '不应允许编辑回答消息')" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
ASSISTANT_PATCH_CODE="$(printf '%s' "${ASSISTANT_PATCH_RESPONSE}" | tail -1)"
assert_status "${ASSISTANT_PATCH_CODE}" "400" "assistant PATCH should be rejected"

ASSISTANT_DELETE_RESPONSE="$(request DELETE /api/chat/messages/${ASSISTANT_MESSAGE_ID} "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
ASSISTANT_DELETE_CODE="$(printf '%s' "${ASSISTANT_DELETE_RESPONSE}" | tail -1)"
assert_status "${ASSISTANT_DELETE_CODE}" "400" "assistant DELETE should be rejected"
echo "PASS: assistant message cannot be edited or deleted directly"

echo "--- missing message guards ---"
MISSING_ID="missing-${OWNER_ID}"
MISSING_PATCH_RESPONSE="$(request PATCH /api/chat/messages/${MISSING_ID} "$(json_payload patch '不存在的消息')" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
MISSING_PATCH_CODE="$(printf '%s' "${MISSING_PATCH_RESPONSE}" | tail -1)"
assert_status "${MISSING_PATCH_CODE}" "404" "missing PATCH should be rejected"

MISSING_DELETE_RESPONSE="$(request DELETE /api/chat/messages/${MISSING_ID} "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
MISSING_DELETE_CODE="$(printf '%s' "${MISSING_DELETE_RESPONSE}" | tail -1)"
assert_status "${MISSING_DELETE_CODE}" "404" "missing DELETE should be rejected"
echo "PASS: missing message edit/delete returns 404"

echo "--- non-owner guards ---"
INTRUDER_PATCH_RESPONSE="$(request PATCH /api/chat/messages/${USER_MESSAGE_ID} "$(json_payload patch '不应允许非本人编辑')" "${INTRUDER_ID}" "${INTRUDER_ROLE}" "${INTRUDER_NAME}")"
INTRUDER_PATCH_CODE="$(printf '%s' "${INTRUDER_PATCH_RESPONSE}" | tail -1)"
assert_status "${INTRUDER_PATCH_CODE}" "403" "non-owner PATCH should be rejected"

INTRUDER_DELETE_RESPONSE="$(request DELETE /api/chat/messages/${USER_MESSAGE_ID} "" "${INTRUDER_ID}" "${INTRUDER_ROLE}" "${INTRUDER_NAME}")"
INTRUDER_DELETE_CODE="$(printf '%s' "${INTRUDER_DELETE_RESPONSE}" | tail -1)"
assert_status "${INTRUDER_DELETE_CODE}" "403" "non-owner DELETE should be rejected"
echo "PASS: non-owner edit/delete returns 403"

echo "--- owner edit truncates branch ---"
FOLLOW_UP_QUESTION="Ralph API branch smoke: 再补一轮追问，用来验证编辑会截断后续分支。"
FOLLOW_UP_RESPONSE="$(request POST /api/chat "$(json_payload chat "${FOLLOW_UP_QUESTION}" "${SESSION_ID}")" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
FOLLOW_UP_HTTP_CODE="$(printf '%s' "${FOLLOW_UP_RESPONSE}" | tail -1)"
FOLLOW_UP_BODY="$(printf '%s' "${FOLLOW_UP_RESPONSE}" | sed '$d')"
assert_status "${FOLLOW_UP_HTTP_CODE}" "200" "owner follow-up chat"

FOLLOW_UP_MESSAGE_ID="$(printf '%s' "${FOLLOW_UP_BODY}" | json_path data.message_id)"
if [ -z "${FOLLOW_UP_MESSAGE_ID}" ]; then
  echo "FAIL: follow-up message_id missing from chat response"
  exit 1
fi

BRANCH_BEFORE_PATCH_RESPONSE="$(request GET /api/chat/sessions/${SESSION_ID} "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
BRANCH_BEFORE_PATCH_CODE="$(printf '%s' "${BRANCH_BEFORE_PATCH_RESPONSE}" | tail -1)"
BRANCH_BEFORE_PATCH_BODY="$(printf '%s' "${BRANCH_BEFORE_PATCH_RESPONSE}" | sed '$d')"
assert_status "${BRANCH_BEFORE_PATCH_CODE}" "200" "load branched session before patch"

BRANCH_BEFORE_PATCH_COUNT="$(printf '%s' "${BRANCH_BEFORE_PATCH_BODY}" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["messages"]))')"
assert_eq "${BRANCH_BEFORE_PATCH_COUNT}" "4" "branch should contain two rounds before edit"

EDITED_CONTENT="Ralph API branch smoke: 已编辑的问题内容。"
OWNER_PATCH_RESPONSE="$(request PATCH /api/chat/messages/${USER_MESSAGE_ID} "$(json_payload patch "${EDITED_CONTENT}")" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
OWNER_PATCH_CODE="$(printf '%s' "${OWNER_PATCH_RESPONSE}" | tail -1)"
OWNER_PATCH_BODY="$(printf '%s' "${OWNER_PATCH_RESPONSE}" | sed '$d')"
assert_status "${OWNER_PATCH_CODE}" "200" "owner PATCH"

PATCHED_MESSAGE_CONTENT="$(printf '%s' "${OWNER_PATCH_BODY}" | json_path data.message.content)"
assert_eq "${PATCHED_MESSAGE_CONTENT}" "${EDITED_CONTENT}" "patched message content"

AFTER_PATCH_RESPONSE="$(request GET /api/chat/sessions/${SESSION_ID} "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
AFTER_PATCH_CODE="$(printf '%s' "${AFTER_PATCH_RESPONSE}" | tail -1)"
AFTER_PATCH_BODY="$(printf '%s' "${AFTER_PATCH_RESPONSE}" | sed '$d')"
assert_status "${AFTER_PATCH_CODE}" "200" "load session after patch"

AFTER_PATCH_COUNT="$(printf '%s' "${AFTER_PATCH_BODY}" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["messages"]))')"
assert_eq "${AFTER_PATCH_COUNT}" "1" "edit should truncate assistant branch"

AFTER_PATCH_ROLE="$(printf '%s' "${AFTER_PATCH_BODY}" | json_path data.messages.0.role)"
AFTER_PATCH_CONTENT="$(printf '%s' "${AFTER_PATCH_BODY}" | json_path data.messages.0.content)"
assert_eq "${AFTER_PATCH_ROLE}" "user" "edited session should keep only user message"
assert_eq "${AFTER_PATCH_CONTENT}" "${EDITED_CONTENT}" "edited user content should persist"
echo "PASS: owner edit truncates assistant branch"

echo "--- owner delete truncates branch ---"
DELETE_QUESTION="Ralph API branch smoke: 删除场景根问题。"
DELETE_CREATE_RESPONSE="$(request POST /api/chat "$(json_payload chat "${DELETE_QUESTION}")" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
DELETE_CREATE_HTTP_CODE="$(printf '%s' "${DELETE_CREATE_RESPONSE}" | tail -1)"
DELETE_CREATE_BODY="$(printf '%s' "${DELETE_CREATE_RESPONSE}" | sed '$d')"
assert_status "${DELETE_CREATE_HTTP_CODE}" "200" "owner delete session creation"

DELETE_SESSION_ID="$(printf '%s' "${DELETE_CREATE_BODY}" | json_path data.session_id)"
if [ -z "${DELETE_SESSION_ID}" ]; then
  echo "FAIL: delete session_id missing from chat response"
  exit 1
fi

DELETE_FOLLOW_UP="Ralph API branch smoke: 删除场景的第二轮追问。"
DELETE_FOLLOW_UP_RESPONSE="$(request POST /api/chat "$(json_payload chat "${DELETE_FOLLOW_UP}" "${DELETE_SESSION_ID}")" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
DELETE_FOLLOW_UP_HTTP_CODE="$(printf '%s' "${DELETE_FOLLOW_UP_RESPONSE}" | tail -1)"
DELETE_FOLLOW_UP_BODY="$(printf '%s' "${DELETE_FOLLOW_UP_RESPONSE}" | sed '$d')"
assert_status "${DELETE_FOLLOW_UP_HTTP_CODE}" "200" "owner delete follow-up chat"

DELETE_BRANCH_RESPONSE="$(request GET /api/chat/sessions/${DELETE_SESSION_ID} "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
DELETE_BRANCH_CODE="$(printf '%s' "${DELETE_BRANCH_RESPONSE}" | tail -1)"
DELETE_BRANCH_BODY="$(printf '%s' "${DELETE_BRANCH_RESPONSE}" | sed '$d')"
assert_status "${DELETE_BRANCH_CODE}" "200" "load session before delete"

DELETE_BRANCH_COUNT="$(printf '%s' "${DELETE_BRANCH_BODY}" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["messages"]))')"
assert_eq "${DELETE_BRANCH_COUNT}" "4" "delete branch should contain two rounds before delete"

DELETE_USER_MESSAGE_ID="$(printf '%s' "${DELETE_BRANCH_BODY}" | json_path data.messages.0.id)"
OWNER_DELETE_RESPONSE="$(request DELETE /api/chat/messages/${DELETE_USER_MESSAGE_ID} "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
OWNER_DELETE_CODE="$(printf '%s' "${OWNER_DELETE_RESPONSE}" | tail -1)"
OWNER_DELETE_BODY="$(printf '%s' "${OWNER_DELETE_RESPONSE}" | sed '$d')"
assert_status "${OWNER_DELETE_CODE}" "200" "owner DELETE"

DELETE_RESULT="$(printf '%s' "${OWNER_DELETE_BODY}" | json_path data.deleted)"
assert_eq "${DELETE_RESULT}" "True" "delete result"

AFTER_DELETE_RESPONSE="$(request GET /api/chat/sessions/${DELETE_SESSION_ID} "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
AFTER_DELETE_CODE="$(printf '%s' "${AFTER_DELETE_RESPONSE}" | tail -1)"
AFTER_DELETE_BODY="$(printf '%s' "${AFTER_DELETE_RESPONSE}" | sed '$d')"
assert_status "${AFTER_DELETE_CODE}" "200" "load session after delete"

AFTER_DELETE_COUNT="$(printf '%s' "${AFTER_DELETE_BODY}" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["messages"]))')"
assert_eq "${AFTER_DELETE_COUNT}" "0" "delete should clear session branch"
echo "PASS: owner delete clears the branch"

echo "=== Chat branch guards: PASS ==="
