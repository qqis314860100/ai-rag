#!/bin/bash
# ============================================================
# API 测试: 文档预览 MIME / 文件类型契约
# ============================================================
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local args=(-sS -w "\n%{http_code}" -X "${method}" -H "Content-Type: application/json")
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

assert_non_empty() {
  local value="$1"
  local label="$2"
  if [ -z "${value}" ]; then
    echo "FAIL: ${label} should not be empty"
    exit 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if [[ "${haystack}" != *"${needle}"* ]]; then
    echo "FAIL: ${label} does not contain ${needle}"
    exit 1
  fi
}

echo "=== Test: Document preview contract ==="
echo "Base URL: ${BASE_URL}"

echo "--- Preview utility mapping ---"
pnpm --dir api exec tsx --eval '
import { buildDocumentPreviewContract } from "./src/utils/documentPreview.ts";

const cases = [
  {
    label: "markdown",
    input: { documentId: "doc-markdown", fileName: "guide.md", fileType: "md" },
    expect: {
      file_type: "md",
      mime_type: "text/markdown",
      content_kind: "markdown",
      preferred_view: "markdown",
      supported_views: ["text", "markdown", "raw", "file", "download"],
    },
  },
  {
    label: "text",
    input: { documentId: "doc-text", fileName: "notes.txt", fileType: "txt" },
    expect: {
      file_type: "txt",
      mime_type: "text/plain",
      content_kind: "text",
      preferred_view: "text",
      supported_views: ["text", "raw", "file", "download"],
    },
  },
  {
    label: "pdf",
    input: { documentId: "doc-pdf", fileName: "manual.pdf", fileType: "pdf" },
    expect: {
      file_type: "pdf",
      mime_type: "application/pdf",
      content_kind: "pdf",
      preferred_view: "pdf",
      supported_views: ["file", "pdf", "download"],
    },
  },
  {
    label: "html",
    input: { documentId: "doc-html", fileName: "page.html", fileType: "html" },
    expect: {
      file_type: "html",
      mime_type: "text/html",
      content_kind: "html",
      preferred_view: "file",
      supported_views: ["file", "download"],
    },
  },
  {
    label: "code",
    input: { documentId: "doc-code", fileName: "snippet.js", fileType: "js" },
    expect: {
      file_type: "js",
      mime_type: "text/javascript",
      content_kind: "code",
      preferred_view: "code",
      supported_views: ["text", "raw", "file", "code", "download"],
    },
  },
];

for (const testCase of cases) {
  const preview = buildDocumentPreviewContract(testCase.input);
  for (const [key, value] of Object.entries(testCase.expect)) {
    if (Array.isArray(value)) {
      const missing = value.filter((item) => !preview.supported_views.includes(item));
      if (missing.length > 0) {
        throw new Error(`${testCase.label}: missing supported views ${missing.join(", ")}`);
      }
      continue;
    }
    if (preview[key] !== value) {
      throw new Error(`${testCase.label}: expected ${key}=${value}, got ${preview[key]}`);
    }
  }
}

console.log("PASS: utility contract maps markdown/text/pdf/html/code");
'

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

TEST_FILE="${TEMP_DIR}/preview-contract.md"
cat > "${TEST_FILE}" << 'EOF'
# 预览契约

这是一份用于验证文档预览契约的 Markdown 文件。
EOF

echo "--- Upload markdown fixture ---"
UPLOAD_RESPONSE="$(curl -sS -w "\n%{http_code}" \
  -X POST "${BASE_URL}/api/documents/upload" \
  -F "file=@${TEST_FILE}" \
  -F "title=预览契约-$(date +%s)" \
  -F "category=测试" \
  -F "security_level=internal")"
UPLOAD_HTTP_CODE="$(printf '%s' "${UPLOAD_RESPONSE}" | tail -1)"
UPLOAD_BODY="$(printf '%s' "${UPLOAD_RESPONSE}" | sed '$d')"
assert_status "${UPLOAD_HTTP_CODE}" "200" "document upload"

DOCUMENT_ID="$(printf '%s' "${UPLOAD_BODY}" | json_path data.document_id)"
assert_non_empty "${DOCUMENT_ID}" "document id"

DETAIL_RESPONSE="$(request GET "/api/documents/${DOCUMENT_ID}")"
DETAIL_HTTP_CODE="$(printf '%s' "${DETAIL_RESPONSE}" | tail -1)"
DETAIL_BODY="$(printf '%s' "${DETAIL_RESPONSE}" | sed '$d')"
assert_status "${DETAIL_HTTP_CODE}" "200" "document detail"

DETAIL_FILE_TYPE="$(printf '%s' "${DETAIL_BODY}" | json_path data.preview.file_type)"
DETAIL_MIME_TYPE="$(printf '%s' "${DETAIL_BODY}" | json_path data.preview.mime_type)"
DETAIL_CONTENT_KIND="$(printf '%s' "${DETAIL_BODY}" | json_path data.preview.content_kind)"
DETAIL_PREFERRED_VIEW="$(printf '%s' "${DETAIL_BODY}" | json_path data.preview.preferred_view)"
DETAIL_RAW_ENDPOINT="$(printf '%s' "${DETAIL_BODY}" | json_path data.preview.endpoints.raw)"
DETAIL_FILE_ENDPOINT="$(printf '%s' "${DETAIL_BODY}" | json_path data.preview.endpoints.file)"

assert_status "md" "${DETAIL_FILE_TYPE}" "document preview file type"
assert_status "text/markdown" "${DETAIL_MIME_TYPE}" "document preview mime type"
assert_status "markdown" "${DETAIL_CONTENT_KIND}" "document preview content kind"
assert_status "markdown" "${DETAIL_PREFERRED_VIEW}" "document preview preferred view"
assert_non_empty "${DETAIL_RAW_ENDPOINT}" "document preview raw endpoint"
assert_non_empty "${DETAIL_FILE_ENDPOINT}" "document preview file endpoint"

SUPPORTS_MARKDOWN="$(printf '%s' "${DETAIL_BODY}" | python3 -c '
import json
import sys
preview = json.load(sys.stdin)["data"]["preview"]
print("yes" if "markdown" in preview["supported_views"] else "")
')"
assert_status "yes" "${SUPPORTS_MARKDOWN}" "document preview supported views"

echo "PASS: document detail preview contract is exposed"

FILE_HEADERS_FILE="${TEMP_DIR}/file.headers"
curl -sS -D "${FILE_HEADERS_FILE}" -o /dev/null "${BASE_URL}/api/documents/${DOCUMENT_ID}/file"

FILE_STATUS="$(python3 -c '
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8", errors="ignore") as fh:
    first = fh.readline().strip()
    print(first.split()[1] if len(first.split()) >= 2 else "")
' "${FILE_HEADERS_FILE}")"
assert_status "${FILE_STATUS}" "200" "document file response"

HEADER_VALUE() {
  local header_name="$1"
  python3 -c '
import sys

needle = sys.argv[1].lower() + ":"
path = sys.argv[2]
with open(path, "r", encoding="utf-8", errors="ignore") as fh:
  for line in fh:
    if line.lower().startswith(needle):
      print(line.split(":", 1)[1].strip())
      break
' "$header_name" "${FILE_HEADERS_FILE}"
}

FILE_TYPE_HEADER="$(HEADER_VALUE "X-Document-File-Type")"
PREVIEW_KIND_HEADER="$(HEADER_VALUE "X-Document-Preview-Kind")"
CONTENT_TYPE_HEADER="$(HEADER_VALUE "Content-Type")"

assert_status "md" "${FILE_TYPE_HEADER}" "file type header"
assert_status "markdown" "${PREVIEW_KIND_HEADER}" "preview kind header"
assert_contains "${CONTENT_TYPE_HEADER}" "text/markdown" "content type header"

echo "PASS: document file headers expose preview contract"
echo "=== Document Preview Contract: PASS ==="
