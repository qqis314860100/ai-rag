#!/bin/bash
# ============================================================
# API 测试: 知识缺口状态机与审计记录
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
DB_PATH="${TMP_DIR}/knowledge-gap-status.db"
PORT="${API_PORT:-33011}"
BASE_URL="http://localhost:${PORT}"
SERVER_PID=""
ADMIN_ID=""
AUDIT_ID=""

cleanup() {
  if [ -n "${SERVER_PID}" ] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local role="${4:-knowledge_admin}"
  local user_id="${ADMIN_ID}"
  local user_name="Gap Admin"
  if [ "${role}" = "system_admin" ]; then
    user_id="${AUDIT_ID}"
    user_name="System Admin"
  fi
  local args=(-sS -w "\n%{http_code}" -X "${method}" -H "Content-Type: application/json")
  args+=(-H "x-user-id: ${user_id}" -H "x-user-role: ${role}" -H "x-user-name: ${user_name}")
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

echo "=== Test: Knowledge gap status machine ==="
cd "${ROOT_DIR}"

read -r GAP_ID TARGET_GAP_ID ADMIN_ID AUDIT_ID <<< "$(DATABASE_URL="file:${DB_PATH}" pnpm --dir api exec tsx -e '
import { initDb } from "./src/db/index";
import { getDb } from "./src/db/index";
import { createKnowledgeGap } from "./src/db/knowledgeGaps";

initDb(process.env.DATABASE_URL!);
const primary = createKnowledgeGap({
  title: "涂布缺陷拒答",
  representativeQuestion: "涂布出现竖纹如何处理？",
  gapType: "refusal",
});
const target = createKnowledgeGap({
  title: "涂布缺陷知识缺口",
  representativeQuestion: "涂布缺陷如何排查？",
  gapType: "mixed",
});
const db = getDb();
const editor = db.prepare("SELECT id FROM users WHERE name = ? LIMIT 1").get("editor") as { id: string };
const system = db.prepare("SELECT id FROM users WHERE name = ? LIMIT 1").get("system") as { id: string };
console.log(`${primary.id} ${target.id} ${editor.id} ${system.id}`);
')"

DATABASE_URL="file:${DB_PATH}" API_PORT="${PORT}" NODE_ENV="development" pnpm --dir api exec tsx src/server.ts > "${TMP_DIR}/api.log" 2>&1 &
SERVER_PID="$!"

for _ in $(seq 1 30); do
  if curl -sS "${BASE_URL}/api/admin/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

echo "--- status contract ---"
CONTRACT_RESPONSE="$(request GET /api/knowledge/gaps/status-flow "" viewer)"
CONTRACT_CODE="$(printf '%s' "${CONTRACT_RESPONSE}" | tail -1)"
CONTRACT_BODY="$(printf '%s' "${CONTRACT_RESPONSE}" | sed '$d')"
assert_status "${CONTRACT_CODE}" "200" "status contract"
PENDING_LABEL="$(printf '%s' "${CONTRACT_BODY}" | json_path data.statuses.0.label)"
assert_eq "${PENDING_LABEL}" "待处理" "pending label"
echo "PASS: status contract exposes Chinese labels and transitions"

echo "--- invalid transition ---"
INVALID_RESPONSE="$(request PATCH "/api/knowledge/gaps/${GAP_ID}/status" '{"status":"published","reason":"不能跳过草稿"}')"
INVALID_CODE="$(printf '%s' "${INVALID_RESPONSE}" | tail -1)"
assert_status "${INVALID_CODE}" "400" "pending to published should fail"
echo "PASS: invalid transition rejected"

echo "--- merge requires target ---"
MISSING_TARGET_RESPONSE="$(request PATCH "/api/knowledge/gaps/${GAP_ID}/status" '{"status":"merged","reason":"缺少目标"}')"
MISSING_TARGET_CODE="$(printf '%s' "${MISSING_TARGET_RESPONSE}" | tail -1)"
assert_status "${MISSING_TARGET_CODE}" "400" "merged requires target"
echo "PASS: merge target is enforced"

echo "--- valid transition and audit ---"
DRAFT_RESPONSE="$(request PATCH "/api/knowledge/gaps/${GAP_ID}/status" '{"status":"draft_generated","reason":"已生成 FAQ 草稿","draft_asset_ids":["faq-1"]}')"
DRAFT_CODE="$(printf '%s' "${DRAFT_RESPONSE}" | tail -1)"
DRAFT_BODY="$(printf '%s' "${DRAFT_RESPONSE}" | sed '$d')"
assert_status "${DRAFT_CODE}" "200" "pending to draft_generated"
DRAFT_STATUS="$(printf '%s' "${DRAFT_BODY}" | json_path data.gap.status)"
assert_eq "${DRAFT_STATUS}" "draft_generated" "draft status"

PUBLISH_RESPONSE="$(request PATCH "/api/knowledge/gaps/${GAP_ID}/status" '{"status":"published","reason":"FAQ 已发布","published_asset_ids":["faq-1"]}')"
PUBLISH_CODE="$(printf '%s' "${PUBLISH_RESPONSE}" | tail -1)"
PUBLISH_BODY="$(printf '%s' "${PUBLISH_RESPONSE}" | sed '$d')"
assert_status "${PUBLISH_CODE}" "200" "draft_generated to published"
PUBLISH_STATUS="$(printf '%s' "${PUBLISH_BODY}" | json_path data.gap.status)"
assert_eq "${PUBLISH_STATUS}" "published" "published status"
echo "PASS: valid transitions update the gap"

AUDIT_RESPONSE="$(request GET "/api/admin/audit-logs?action=knowledge_gap.status.update&resource_id=${GAP_ID}" "" system_admin)"
AUDIT_CODE="$(printf '%s' "${AUDIT_RESPONSE}" | tail -1)"
AUDIT_BODY="$(printf '%s' "${AUDIT_RESPONSE}" | sed '$d')"
assert_status "${AUDIT_CODE}" "200" "audit logs"
AUDIT_TOTAL="$(printf '%s' "${AUDIT_BODY}" | json_path data.pagination.total)"
assert_eq "${AUDIT_TOTAL}" "2" "audit count"
echo "PASS: status changes are preserved in audit logs"

MERGE_RESPONSE="$(request PATCH "/api/knowledge/gaps/${TARGET_GAP_ID}/status" "{\"status\":\"merged\",\"reason\":\"归并重复缺口\",\"merged_to_gap_id\":\"${GAP_ID}\"}")"
MERGE_CODE="$(printf '%s' "${MERGE_RESPONSE}" | tail -1)"
MERGE_BODY="$(printf '%s' "${MERGE_RESPONSE}" | sed '$d')"
assert_status "${MERGE_CODE}" "200" "pending to merged"
MERGE_TARGET="$(printf '%s' "${MERGE_BODY}" | json_path data.gap.metadata.status_flow.merged_to_gap_id)"
assert_eq "${MERGE_TARGET}" "${GAP_ID}" "merge target metadata"
echo "PASS: merged status records target gap"

echo "=== Knowledge gap status machine: PASS ==="
