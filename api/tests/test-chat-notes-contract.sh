#!/bin/bash
# ============================================================
# API 测试: 会话 / 回答 / 引用笔记归属契约与最小读写路径
# ============================================================
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"
OWNER_ID="notes-owner-$(date +%s)"
OWNER_ROLE="viewer"
OWNER_NAME="Notes Owner"
INTRUDER_ID="notes-intruder-$(date +%s)"
INTRUDER_ROLE="viewer"
INTRUDER_NAME="Notes Intruder"

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
if kind == "session":
  print(json.dumps({"title": sys.argv[2]}))
elif kind == "note":
  print(json.dumps({"scope": "session", "session_id": sys.argv[2], "content": sys.argv[3]}))
elif kind == "patch":
  print(json.dumps({"content": sys.argv[2]}))
elif kind == "message-note-missing":
  print(json.dumps({"scope": "message", "session_id": sys.argv[2], "content": sys.argv[3]}))
else:
  raise SystemExit(1)
' "$@"
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

assert_non_empty() {
  local value="$1"
  local label="$2"
  if [ -z "${value}" ]; then
    echo "FAIL: ${label} should not be empty"
    exit 1
  fi
}

echo "=== Test: Chat notes ownership contract ==="
echo "Base URL: ${BASE_URL}"

echo "--- ownership contract ---"
CONTRACT_RESPONSE="$(request GET /api/chat/notes/contract "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
CONTRACT_CODE="$(printf '%s' "${CONTRACT_RESPONSE}" | tail -1)"
CONTRACT_BODY="$(printf '%s' "${CONTRACT_RESPONSE}" | sed '$d')"
assert_status "${CONTRACT_CODE}" "200" "notes contract"

OWNER_SERVICE="$(printf '%s' "${CONTRACT_BODY}" | json_path data.owner_service)"
STORAGE_MODEL="$(printf '%s' "${CONTRACT_BODY}" | json_path data.storage_model)"
INDEPENDENT_TABLES="$(printf '%s' "${CONTRACT_BODY}" | json_path data.independent_tables_required)"
SOURCE_REQUIRED="$(printf '%s' "${CONTRACT_BODY}" | json_path data.scopes.source.required_fields.2)"
assert_eq "${OWNER_SERVICE}" "api" "notes owner service"
assert_eq "${STORAGE_MODEL}" "single_polymorphic_table" "notes storage model"
assert_eq "${INDEPENDENT_TABLES}" "False" "notes independent table decision"
assert_eq "${SOURCE_REQUIRED}" "source_id" "source note required field"
echo "PASS: contract declares API ownership and one polymorphic table"

echo "--- create session ---"
SESSION_RESPONSE="$(request POST /api/chat/sessions "$(json_payload session "笔记契约测试")" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
SESSION_CODE="$(printf '%s' "${SESSION_RESPONSE}" | tail -1)"
SESSION_BODY="$(printf '%s' "${SESSION_RESPONSE}" | sed '$d')"
assert_status "${SESSION_CODE}" "200" "create session"

SESSION_ID="$(printf '%s' "${SESSION_BODY}" | json_path data.id)"
assert_non_empty "${SESSION_ID}" "session id"
echo "PASS: created session ${SESSION_ID}"

echo "--- session note CRUD ---"
NOTE_CONTENT="这是一条会话笔记。"
CREATE_RESPONSE="$(request POST /api/chat/notes "$(json_payload note "${SESSION_ID}" "${NOTE_CONTENT}")" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
CREATE_CODE="$(printf '%s' "${CREATE_RESPONSE}" | tail -1)"
CREATE_BODY="$(printf '%s' "${CREATE_RESPONSE}" | sed '$d')"
assert_status "${CREATE_CODE}" "200" "create note"

NOTE_ID="$(printf '%s' "${CREATE_BODY}" | json_path data.id)"
NOTE_SCOPE="$(printf '%s' "${CREATE_BODY}" | json_path data.scope)"
NOTE_SESSION_ID="$(printf '%s' "${CREATE_BODY}" | json_path data.session_id)"
NOTE_CREATED_CONTENT="$(printf '%s' "${CREATE_BODY}" | json_path data.content)"
assert_non_empty "${NOTE_ID}" "note id"
assert_eq "${NOTE_SCOPE}" "session" "note scope"
assert_eq "${NOTE_SESSION_ID}" "${SESSION_ID}" "note session id"
assert_eq "${NOTE_CREATED_CONTENT}" "${NOTE_CONTENT}" "created note content"
echo "PASS: created session note ${NOTE_ID}"

LIST_RESPONSE="$(request GET "/api/chat/notes?scope=session&session_id=${SESSION_ID}" "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
LIST_CODE="$(printf '%s' "${LIST_RESPONSE}" | tail -1)"
LIST_BODY="$(printf '%s' "${LIST_RESPONSE}" | sed '$d')"
assert_status "${LIST_CODE}" "200" "list notes"

LIST_COUNT="$(printf '%s' "${LIST_BODY}" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["items"]))')"
LIST_NOTE_ID="$(printf '%s' "${LIST_BODY}" | json_path data.items.0.id)"
assert_eq "${LIST_COUNT}" "1" "owner note list count"
assert_eq "${LIST_NOTE_ID}" "${NOTE_ID}" "owner note list id"
echo "PASS: owner can list personal session notes"

UPDATED_CONTENT="更新后的会话笔记。"
PATCH_RESPONSE="$(request PATCH /api/chat/notes/${NOTE_ID} "$(json_payload patch "${UPDATED_CONTENT}")" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
PATCH_CODE="$(printf '%s' "${PATCH_RESPONSE}" | tail -1)"
PATCH_BODY="$(printf '%s' "${PATCH_RESPONSE}" | sed '$d')"
assert_status "${PATCH_CODE}" "200" "update note"

PATCHED_CONTENT="$(printf '%s' "${PATCH_BODY}" | json_path data.content)"
assert_eq "${PATCHED_CONTENT}" "${UPDATED_CONTENT}" "patched note content"
echo "PASS: owner can update note"

INTRUDER_PATCH_RESPONSE="$(request PATCH /api/chat/notes/${NOTE_ID} "$(json_payload patch "非本人不应可改")" "${INTRUDER_ID}" "${INTRUDER_ROLE}" "${INTRUDER_NAME}")"
INTRUDER_PATCH_CODE="$(printf '%s' "${INTRUDER_PATCH_RESPONSE}" | tail -1)"
assert_status "${INTRUDER_PATCH_CODE}" "404" "intruder update note"
echo "PASS: non-owner cannot update personal note"

MESSAGE_NOTE_RESPONSE="$(request POST /api/chat/notes "$(json_payload message-note-missing "${SESSION_ID}" "缺少 message_id")" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
MESSAGE_NOTE_CODE="$(printf '%s' "${MESSAGE_NOTE_RESPONSE}" | tail -1)"
assert_status "${MESSAGE_NOTE_CODE}" "400" "message note requires message_id"
echo "PASS: answer note scope enforces message target"

DELETE_RESPONSE="$(request DELETE /api/chat/notes/${NOTE_ID} "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
DELETE_CODE="$(printf '%s' "${DELETE_RESPONSE}" | tail -1)"
DELETE_BODY="$(printf '%s' "${DELETE_RESPONSE}" | sed '$d')"
assert_status "${DELETE_CODE}" "200" "delete note"

DELETE_RESULT="$(printf '%s' "${DELETE_BODY}" | json_path data.deleted)"
assert_eq "${DELETE_RESULT}" "True" "delete result"

AFTER_DELETE_RESPONSE="$(request GET "/api/chat/notes?scope=session&session_id=${SESSION_ID}" "" "${OWNER_ID}" "${OWNER_ROLE}" "${OWNER_NAME}")"
AFTER_DELETE_CODE="$(printf '%s' "${AFTER_DELETE_RESPONSE}" | tail -1)"
AFTER_DELETE_BODY="$(printf '%s' "${AFTER_DELETE_RESPONSE}" | sed '$d')"
assert_status "${AFTER_DELETE_CODE}" "200" "list after delete"

AFTER_DELETE_COUNT="$(printf '%s' "${AFTER_DELETE_BODY}" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["data"]["items"]))')"
assert_eq "${AFTER_DELETE_COUNT}" "0" "deleted note should not be listed"
echo "PASS: delete hides note from active list"

echo "=== Chat notes ownership contract: PASS ==="
