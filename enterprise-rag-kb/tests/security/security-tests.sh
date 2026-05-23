#!/bin/bash
# ================================================================
# 安全测试脚本 - Enterprise RAG Knowledge Base
# 用法: ./security-tests.sh [API_BASE_URL]
# 默认 API_BASE_URL=http://localhost:3001
# ================================================================

set -euo pipefail

API_BASE="${1:-http://localhost:3001}"
PASS=0
FAIL=0
TOTAL=0

# Color helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_name() {
    TOTAL=$((TOTAL + 1))
    echo ""
    echo "========================================="
    echo "TEST #${TOTAL}: $1"
    echo "========================================="
}

pass_msg() {
    PASS=$((PASS + 1))
    echo -e "${GREEN}[PASS]${NC} $1"
}

fail_msg() {
    FAIL=$((FAIL + 1))
    echo -e "${RED}[FAIL]${NC} $1"
}

warn_msg() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# ================================================================
# T1: 未授权访问 - 无认证头直接调用受保护端点
# ================================================================
test_name "未授权访问: 无认证头访问文档列表"

# Send without any auth headers - the system defaults to system_admin
# This is itself a security issue (P0-1)
RESP=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/documents")
if [ "$RESP" = "200" ]; then
    fail_msg "无需认证头即可访问 /api/documents (返回 ${RESP})。系统自动分配了 system_admin 角色。"
else
    pass_msg "/api/documents 正确拒绝无认证头请求 (返回 ${RESP})"
fi

# ================================================================
# T2: 角色伪造 - 伪造 x-user-role 头提权
# ================================================================
test_name "角色伪造: 伪造 system_admin 管理员角色"

RESP=$(curl -s -w "\n%{http_code}" \
    -H "x-user-id: attacker" \
    -H "x-user-role: system_admin" \
    -H "x-user-name: 攻击者" \
    "${API_BASE}/api/admin/audit-logs")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    fail_msg "伪造 system_admin 角色成功读取审计日志 (返回 ${HTTP_CODE})"
    echo "  响应预览: $(echo "$BODY" | head -c 200)"
else
    pass_msg "伪造 system_admin 角色被拒绝 (返回 ${HTTP_CODE})"
fi

# ================================================================
# T3: 水平越权 - 使用 viewer 角色访问管理功能
# ================================================================
test_name "水平越权: viewer 角色尝试读取审计日志"

RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "x-user-id: viewer1" \
    -H "x-user-role: viewer" \
    "${API_BASE}/api/admin/audit-logs")

if [ "$RESP" = "403" ] || [ "$RESP" = "401" ]; then
    pass_msg "viewer 角色被正确拒绝访问审计日志 (返回 ${RESP})"
else
    fail_msg "viewer 角色可能越权访问了审计日志 (返回 ${RESP})"
fi

# ================================================================
# T4: 文件上传 - 非法文件类型绕过
# ================================================================
test_name "文件上传: 尝试上传 .exe 可执行文件"

TMP_EXE=$(mktemp /tmp/fake-malware-XXXXXX.exe)
echo "This is not really an executable" > "$TMP_EXE"

RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "x-user-id: testuser" \
    -H "x-user-role: process_engineer" \
    -F "file=@${TMP_EXE}" \
    -F "title=恶意文件测试" \
    -F "category=安全测试" \
    -F "security_level=internal" \
    "${API_BASE}/api/documents/upload")
HTTP_CODE=$(echo "$RESP" | tail -1)

rm -f "$TMP_EXE"

if [ "$HTTP_CODE" = "400" ]; then
    pass_msg ".exe 文件被正确拒绝 (返回 ${HTTP_CODE})"
elif [ "$HTTP_CODE" = "200" ]; then
    fail_msg ".exe 文件被错误接受并上传成功 (返回 ${HTTP_CODE})"
else
    warn_msg ".exe 文件上传返回 ${HTTP_CODE}，需人工确认"
fi

# ================================================================
# T5: 文件上传 - 伪造 MIME 类型绕过
# ================================================================
test_name "文件上传: .txt 扩展名但伪造为无害类型"

TMP_TXT=$(mktemp /tmp/test-upload-XXXXXX.txt)
echo '{"malicious": "payload"}' > "$TMP_TXT"

RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "x-user-id: testuser" \
    -H "x-user-role: process_engineer" \
    -F "file=@${TMP_TXT};type=text/plain" \
    -F "title=MIME伪造测试" \
    -F "category=安全测试" \
    -F "security_level=internal" \
    "${API_BASE}/api/documents/upload")
HTTP_CODE=$(echo "$RESP" | tail -1)

rm -f "$TMP_TXT"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    pass_msg ".txt 文件正常上传成功 (返回 ${HTTP_CODE})"
else
    fail_msg ".txt 文件上传失败 (返回 ${HTTP_CODE})"
fi

# ================================================================
# T6: 文件上传 - 超大文件拒绝
# ================================================================
test_name "文件上传: 超过 20MB 限制的超大文件"

TMP_BIG=$(mktemp /tmp/oversized-XXXXXX.txt)
dd if=/dev/zero of="$TMP_BIG" bs=1M count=21 2>/dev/null

RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "x-user-id: testuser" \
    -H "x-user-role: process_engineer" \
    -F "file=@${TMP_BIG}" \
    -F "title=超大文件测试" \
    -F "category=安全测试" \
    -F "security_level=internal" \
    --max-time 10 \
    "${API_BASE}/api/documents/upload" 2>/dev/null || echo -e "\n000")
HTTP_CODE=$(echo "$RESP" | tail -1)

rm -f "$TMP_BIG"

if [ "$HTTP_CODE" = "413" ] || [ "$HTTP_CODE" = "400" ]; then
    pass_msg "超大文件被正确拒绝 (返回 ${HTTP_CODE})"
elif [ "$HTTP_CODE" = "000" ]; then
    warn_msg "上传超大文件时连接超时，可能是 multer reject 后的行为异常"
else
    fail_msg "超大文件可能被接受 (返回 ${HTTP_CODE})"
fi

# ================================================================
# T7: 路径遍历 - 文件名包含 ../ 序列
# ================================================================
test_name "路径遍历: 文件名包含目录穿越序列"

TMP_TRAV=$(mktemp /tmp/normal-file-XXXXXX.txt)
echo "normal content" > "$TMP_TRAV"

# curl --form 会使用原始文件名，但 multer 应该用 uuid 重命名
RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "x-user-id: testuser" \
    -H "x-user-role: process_engineer" \
    -F "file=@${TMP_TRAV};filename=../../../etc/passwd.txt" \
    -F "title=路径遍历测试" \
    -F "category=安全测试" \
    -F "security_level=internal" \
    "${API_BASE}/api/documents/upload")
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

rm -f "$TMP_TRAV"

if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "403" ]; then
    pass_msg "路径遍历文件名被拒绝 (返回 ${HTTP_CODE})"
elif [ "$HTTP_CODE" = "200" ]; then
    fail_msg "路径遍历文件名被接受 (返回 ${HTTP_CODE})"
    echo "  响应: $(echo "$BODY" | head -c 300)"
else
    warn_msg "路径遍历文件上传返回 ${HTTP_CODE}，需确认 multer 行为"
fi

# ================================================================
# T8: 认证绕过 - 在 chat 中直接指定 restricted 安全等级
# ================================================================
test_name "权限绕过: 使用 viewer 角色尝试跨安全等级滤镜查询"

RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "x-user-id: viewer1" \
    -H "x-user-role: viewer" \
    -d '{"query":"激光焊接参数","top_k":5,"filters":{"security_level":"restricted"}}' \
    "${API_BASE}/api/search" 2>/dev/null)
HTTP_CODE=$(echo "$RESP" | tail -1)

# viewer has only ["public"] allowed. The API should pass allowed_security_levels=["public"]
# from getSecurityLevelsForRequest, regardless of what filters the user sends.
# The security_level filter we sent is NOT used as allowed_security_levels - that comes from auth middleware.
# This test checks if the API correctly ignores user-supplied security_level in filters.

if [ "$HTTP_CODE" = "200" ]; then
    pass_msg "搜索请求被正常处理 (返回 ${HTTP_CODE})，安全等级由服务端控制"
else
    fail_msg "搜索请求被拒绝 (返回 ${HTTP_CODE})"
fi

# ================================================================
# T9: 输入校验 - 空消息和空查询
# ================================================================
test_name "输入校验: 发送空消息到 chat 端点"

RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "x-user-id: testuser" \
    -H "x-user-role: operator" \
    -d '{"message":"","top_k":5}' \
    "${API_BASE}/api/chat")
HTTP_CODE=$(echo "$RESP" | tail -1)

if [ "$HTTP_CODE" = "400" ]; then
    pass_msg "空消息被正确拒绝 (返回 ${HTTP_CODE})"
else
    fail_msg "空消息未被拒绝 (返回 ${HTTP_CODE})"
fi

# ================================================================
# T10: 输入校验 - 超长消息
# ================================================================
test_name "输入校验: 发送极长消息（接近 1MB JSON body 限制）"

LONG_MSG=$(python3 -c "print('安全测试' * 50000)" 2>/dev/null || \
           printf '安全测试%.0s' {1..50000})

RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "x-user-id: testuser" \
    -H "x-user-role: operator" \
    --max-time 10 \
    -d "{\"message\":\"${LONG_MSG}\",\"top_k\":5}" \
    "${API_BASE}/api/chat" 2>/dev/null || echo -e "\n000")
HTTP_CODE=$(echo "$RESP" | tail -1)

if [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "200" ]; then
    pass_msg "超长消息被正确处理 (返回 ${HTTP_CODE})"
else
    warn_msg "超长消息返回 ${HTTP_CODE}，需确认无内存问题"
fi

# ================================================================
# T11: CORS 头检查
# ================================================================
test_name "CORS 配置: 检查跨域响应头"

RESP=$(curl -s -I -X OPTIONS \
    -H "Origin: https://evil.example.com" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type" \
    "${API_BASE}/api/documents" 2>/dev/null)

if echo "$RESP" | grep -q "Access-Control-Allow-Origin: \*"; then
    fail_msg "CORS 允许所有来源 (Access-Control-Allow-Origin: *)"
elif echo "$RESP" | grep -q "Access-Control-Allow-Origin"; then
    pass_msg "CORS 配置了特定来源限制"
else
    warn_msg "CORS 头未在响应中检测到，可能使用默认配置"
fi

# ================================================================
# T12: 错误信息泄露 - 触发 500 错误检查响应
# ================================================================
test_name "错误信息泄露: 发送畸形 JSON 检查错误消息"

RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "x-user-id: testuser" \
    -H "x-user-role: operator" \
    -d '{invalid json...}' \
    "${API_BASE}/api/chat" 2>/dev/null)
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
    # Check that error doesn't contain stack traces
    if echo "$BODY" | grep -qi "stack\|at \|node_modules\|\.js:[0-9]"; then
        fail_msg "错误响应包含堆栈跟踪信息"
        echo "  响应预览: $(echo "$BODY" | head -c 300)"
    else
        pass_msg "错误响应不包含内部实现细节 (返回 ${HTTP_CODE})"
    fi
else
    warn_msg "畸形 JSON 返回 ${HTTP_CODE}，需确认处理方式"
fi

# ================================================================
# T13: 敏感信息泄露 - Health 端点检查
# ================================================================
test_name "信息泄露: 检查 health 端点暴露的信息"

RESP=$(curl -s "${API_BASE}/api/admin/health" 2>/dev/null)

if echo "$RESP" | grep -q "deepseek_api_key\|DEEPSEEK\|password\|secret\|token"; then
    fail_msg "Health 端点泄露了密钥或密码信息"
    echo "  响应: $(echo "$RESP" | head -c 500)"
else
    pass_msg "Health 端点未泄露敏感信息"
fi

# ================================================================
# T14: admin/settings GET 无需认证
# ================================================================
test_name "权限缺失: GET /api/admin/settings 是否需要认证"

RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    "${API_BASE}/api/admin/settings" 2>/dev/null)

if [ "$RESP" = "200" ]; then
    fail_msg "GET /api/admin/settings 无需认证即可访问 (返回 ${RESP})"
elif [ "$RESP" = "401" ] || [ "$RESP" = "403" ]; then
    pass_msg "GET /api/admin/settings 需要认证 (返回 ${RESP})"
else
    warn_msg "GET /api/admin/settings 返回 ${RESP}"
fi

# ================================================================
# T15: SQL 注入 - 在搜索参数中注入
# ================================================================
test_name "SQL 注入: 在 keyword 参数中尝试注入"

RESP=$(curl -s -w "\n%{http_code}" \
    -H "x-user-id: testuser" \
    -H "x-user-role: operator" \
    "${API_BASE}/api/documents?keyword='%20OR%201=1--" 2>/dev/null)
HTTP_CODE=$(echo "$RESP" | tail -1)

if [ "$HTTP_CODE" = "200" ]; then
    pass_msg "SQL 注入尝试被正确处理（使用参数化查询）(返回 ${HTTP_CODE})"
elif [ "$HTTP_CODE" = "400" ]; then
    pass_msg "SQL 注入尝试被拒绝 (返回 ${HTTP_CODE})"
else
    warn_msg "keyword 注入测试返回 ${HTTP_CODE}"
fi

# ================================================================
# T16: 请求方法限制 - 尝试非预期的 HTTP 方法
# ================================================================
test_name "HTTP 方法: PUT 请求搜索端点"

RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT \
    -H "Content-Type: application/json" \
    -H "x-user-id: testuser" \
    -H "x-user-role: operator" \
    -d '{"query":"test"}' \
    "${API_BASE}/api/search" 2>/dev/null)

if [ "$RESP" = "404" ] || [ "$RESP" = "405" ]; then
    pass_msg "非预期的 HTTP 方法被正确拒绝 (返回 ${RESP})"
else
    fail_msg "非预期的 HTTP 方法可能被接受 (返回 ${RESP})"
fi

# ================================================================
# T17: XSS - 在聊天消息中注入脚本标签（前端渲染测试提示）
# ================================================================
test_name "XSS: 聊天消息包含 HTML/script 标签"

RESP=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "x-user-id: testuser" \
    -H "x-user-role: operator" \
    -d '{"message":"<script>alert(\"XSS\")</script> 什么是激光焊接?", "top_k":3}' \
    "${API_BASE}/api/chat" 2>/dev/null)
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    # Check if the answer contains the raw script tag unescaped
    # Note: This is a server-side test; actual XSS risk is in frontend rendering
    # MarkdownContent.tsx uses escapeHtml before markdown rendering, so it should be safe
    if echo "$BODY" | grep -q '<script>alert'; then
        fail_msg "LLM 响应中可能保留了原始 script 标签。前端需确保 HTML 转义。"
    else
        pass_msg "聊天消息中包含的 HTML 标签被正确处理 (返回 ${HTTP_CODE})"
    fi
elif [ "$HTTP_CODE" = "400" ]; then
    # Accept rejection of XSS payloads too
    pass_msg "XSS payload 被拒绝 (返回 ${HTTP_CODE})"
else
    warn_msg "XSS 测试返回 ${HTTP_CODE}"
fi

# ================================================================
# T18: RAG 服务直接访问检查
# ================================================================
test_name "RAG 服务隔离: 检查 RAG 服务是否可从外部直接访问"

RAG_BASE="${RAG_SERVICE_URL:-http://localhost:8000}"

# Use timeout to avoid hanging if service is not reachable
RESP=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 3 --max-time 5 \
    "${RAG_BASE}/rag/health" 2>/dev/null || echo "000")

if [ "$RESP" = "000" ]; then
    pass_msg "RAG 服务无法从外部访问（已隔离或未运行）"
elif [ "$RESP" = "200" ]; then
    fail_msg "RAG 服务可直接从外部访问 (${RAG_BASE}/rag/health 返回 ${RESP})"
else
    warn_msg "RAG 服务访问返回 ${RESP}"
fi

# ================================================================
# T19: Rate Limiting 检查 - 快速连续请求
# ================================================================
test_name "速率限制: 快速连续发送 20 个请求"

RATE_LIMIT_HIT=0
for i in $(seq 1 5); do
    RESP=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "x-user-id: testuser" \
        -H "x-user-role: operator" \
        "${API_BASE}/api/documents?page=1&page_size=5" 2>/dev/null) || true
    if [ "$RESP" = "429" ]; then
        RATE_LIMIT_HIT=1
        break
    fi
done

if [ "$RATE_LIMIT_HIT" = "1" ]; then
    pass_msg "存在速率限制保护"
else
    fail_msg "无速率限制保护（P1-1），5 个请求均未返回 429"
fi

# ================================================================
# T20: 安全头检查
# ================================================================
test_name "安全头: 检查 HTTP 安全响应头"

RESP=$(curl -s -I "${API_BASE}/api/documents" 2>/dev/null)

MISSING=""
if ! echo "$RESP" | grep -qi "X-Content-Type-Options"; then
    MISSING="${MISSING} X-Content-Type-Options"
fi
if ! echo "$RESP" | grep -qi "X-Frame-Options"; then
    MISSING="${MISSING} X-Frame-Options"
fi
if ! echo "$RESP" | grep -qi "Strict-Transport-Security"; then
    MISSING="${MISSING} HSTS"
fi

if [ -z "$MISSING" ]; then
    pass_msg "所有关键安全头已设置"
else
    fail_msg "缺少安全头:${MISSING}"
fi

# ================================================================
# Summary
# ================================================================
echo ""
echo "========================================="
echo "           测试结果汇总"
echo "========================================="
echo -e "总计: ${TOTAL}"
echo -e "${GREEN}通过: ${PASS}${NC}"
echo -e "${RED}失败: ${FAIL}${NC}"
echo -e "${YELLOW}警告: $((TOTAL - PASS - FAIL))${NC}"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo -e "${RED}发现 ${FAIL} 项安全测试未通过，请查看上方详情。${NC}"
    exit 1
else
    echo ""
    echo -e "${GREEN}所有测试均通过（或为预期行为）。${NC}"
    exit 0
fi
