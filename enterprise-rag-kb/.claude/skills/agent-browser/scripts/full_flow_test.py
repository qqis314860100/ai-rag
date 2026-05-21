#!/usr/bin/env python3
"""Full E2E flow test for Enterprise RAG Knowledge Base

Tests: API health, document ingest, search, chat (streaming + non-streaming),
session CRUD, frontend availability.

Usage:
    python3 scripts/full_flow_test.py [--base-url http://localhost:3002]
"""

import sys, json, time, urllib.request, urllib.error, argparse, os

BASE_URL = "http://localhost:3002"
RAG_URL = "http://localhost:8001"
WEB_URL = "http://localhost:5174"
PASSED = 0
FAILED = 0

def test(name):
    global PASSED, FAILED
    return TestCtx(name)

class TestCtx:
    def __init__(self, name):
        self.name = name
    def __enter__(self):
        print(f"\n{'='*60}")
        print(f"TEST: {self.name}")
        return self
    def __exit__(self, *a):
        pass

def ok(msg=""):
    global PASSED
    PASSED += 1
    print(f"  PASS {msg}")

def fail(msg):
    global FAILED
    FAILED += 1
    print(f"  FAIL {msg}")

def api_get(url, timeout=10):
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read().decode()
            return resp.status, json.loads(data) if data else {}
    except Exception as e:
        return None, str(e)

def api_post(url, body, timeout=30, raw=False, method="POST"):
    try:
        data = json.dumps(body).encode() if not raw else body
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return None, str(e)

def api_get_raw(url, timeout=10):
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, None
    except Exception as e:
        return None, str(e)


# ── Health Checks ──────────────────────────────────────────────

with test("RAG Service Health"):
    code, data = api_get(f"{RAG_URL}/rag/health")
    if code == 200 and data.get("status") == "ok":
        ok(f"status=ok, model={data.get('embedding_model')}, llm={data.get('llm_provider')}")
    else:
        fail(f"code={code}, data={str(data)[:100]}")

with test("API Gateway Health"):
    code, data = api_get(f"{BASE_URL}/api/admin/health")
    if code == 200:
        svc = data.get("data", {}).get("services", {})
        ok(f"api={svc.get('api')}, rag={svc.get('rag')}, db={svc.get('database')}")
    else:
        fail(f"code={code}")

with test("Web Frontend Available"):
    code, _ = api_get_raw(WEB_URL)
    if code == 200:
        ok("HTTP 200")
    else:
        fail(f"code={code}")


# ── Document Ingest ─────────────────────────────────────────────

with test("RAG Ingest Single Document"):
    doc_path = "/Users/tomtong/sigma/ai-rag/enterprise-rag-kb/knowledge/产线总览与工艺架构.md"
    code, data = api_post(f"{RAG_URL}/rag/documents/ingest", {
        "document_id": f"e2e-test-{int(time.time())}",
        "file_path": doc_path,
        "metadata": {"title": "E2E Test Doc", "category": "test", "security_level": "internal"}
    })
    if code == 200:
        d = json.loads(data)
        if d.get("chunk_count", 0) > 0:
            ok(f"chunks={d['chunk_count']}, status={d['index_status']}")
        else:
            fail(f"zero chunks: {d}")
    else:
        fail(f"code={code}, data={str(data)[:100]}")


# ── Search ──────────────────────────────────────────────────────

with test("Search via RAG"):
    code, data = api_post(f"{RAG_URL}/rag/search", {
        "query": "激光焊接参数", "top_k": 5,
        "allowed_security_levels": ["public", "internal"]
    })
    if code == 200:
        d = json.loads(data)
        n = len(d.get("results", []))
        if n > 0:
            ok(f"{n} results in {d['latency_ms']}ms, top_score={d['results'][0]['score']}")
        else:
            fail("no results returned")
    else:
        fail(f"code={code}")

with test("Search via API Gateway"):
    code, data = api_post(f"{BASE_URL}/api/search", {
        "query": "电芯分选标准", "top_k": 3
    })
    if code == 200:
        d = json.loads(data)
        n = len(d.get("data", {}).get("results", []))
        ok(f"{n} results via gateway") if n > 0 else fail("no results")
    else:
        fail(f"code={code}")


# ── Chat (Non-Streaming) ────────────────────────────────────────

with test("Chat Non-Streaming via RAG"):
    code, data = api_post(f"{RAG_URL}/rag/chat", {
        "query": "CTP技术优势", "top_k": 3,
        "allowed_security_levels": ["public", "internal"]
    }, timeout=60)
    if code == 200:
        d = json.loads(data)
        src = len(d.get("sources", []))
        if d.get("answer") and len(d["answer"]) > 20:
            ok(f"answer={len(d['answer'])}chars, sources={src}, confidence={d.get('confidence')}")
        else:
            fail(f"short answer: {d.get('answer','')[:50]}")
    else:
        fail(f"code={code}")


# ── Chat (Streaming) ────────────────────────────────────────────

with test("Chat Streaming via RAG"):
    code, data = api_post(f"{RAG_URL}/rag/chat/stream", {
        "query": "激光焊接安全", "top_k": 3,
        "allowed_security_levels": ["public", "internal"]
    }, timeout=60)
    if code == 200:
        tokens = data.count('"type": "token"')
        has_done = '"type": "done"' in data
        has_sources = '"sources"' in data
        if tokens > 5 and has_done and has_sources:
            ok(f"{tokens} tokens, done+ sources present")
        else:
            fail(f"tokens={tokens}, done={has_done}, sources={has_sources}")
    else:
        fail(f"code={code}")


# ── Session Management ───────────────────────────────────────────

with test("Session CRUD"):
    # Create
    code, data = api_post(f"{BASE_URL}/api/chat/sessions", {"title": "E2E Test Session"})
    if code != 200:
        fail(f"create failed: {code}")
    else:
        session_id = json.loads(data)["data"]["id"]
        ok(f"created session: {session_id[:8]}...")

        # List
        code2, data2 = api_get(f"{BASE_URL}/api/chat/sessions")
        if code2 == 200:
            items = (data2 if isinstance(data2, dict) else json.loads(data2))["data"]["items"]
            ok(f"listed {len(items)} sessions")
        else:
            fail("list failed")

        # Get with messages
        code3, data3 = api_get(f"{BASE_URL}/api/chat/sessions/{session_id}")
        if code3 == 200:
            msgs = (data3 if isinstance(data3, dict) else json.loads(data3))["data"]["messages"]
            ok(f"got session with {len(msgs)} messages")
        else:
            fail("get session failed")

        # Update (PATCH)
        req = urllib.request.Request(f"{BASE_URL}/api/chat/sessions/{session_id}",
                         data=json.dumps({"title": "Updated E2E Test"}).encode(),
                         headers={"Content-Type": "application/json"},
                         method="PATCH")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                ok("updated session title")
        except Exception as e:
            fail(f"update failed: {e}")

        # Delete
        req2 = urllib.request.Request(f"{BASE_URL}/api/chat/sessions/{session_id}", method="DELETE")
        try:
            with urllib.request.urlopen(req2, timeout=10) as resp:
                ok("deleted session")
        except Exception as e:
            fail(f"delete failed: {e}")


# ── Document Upload via API Gateway ──────────────────────────────

with test("Document Upload via Gateway"):
    import io
    boundary = "----TestBoundary"
    file_content = b"# Test Document\n\n## Section 1\n\nTest content for upload.\n"

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="test.md"\r\n'
        f"Content-Type: text/markdown\r\n\r\n"
        f"{file_content.decode()}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="title"\r\n\r\n'
        f"E2E Upload Test\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="category"\r\n\r\n'
        f"test\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="security_level"\r\n\r\n'
        f"internal\r\n"
        f"--{boundary}--\r\n"
    ).encode()

    req = urllib.request.Request(f"{BASE_URL}/api/documents/upload",
                     data=body,
                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            d = json.loads(resp.read().decode())
            if d.get("data", {}).get("document_id"):
                ok(f"uploaded: {d['data']['document_id'][:8]}...")
            else:
                fail(f"unexpected response: {d}")
    except urllib.error.HTTPError as e:
        fail(f"HTTP {e.code}: {e.read().decode()[:100]}")
    except Exception as e:
        fail(str(e))


# ── Debugger ────────────────────────────────────────────────────

with test("Debug Search"):
    code, data = api_post(f"{BASE_URL}/api/search/debug", {
        "query": "模组EOL测试", "top_k": 5, "mode": "vector",
        "include_prompt": True
    })
    if code == 200:
        d = json.loads(data)
        n = len(d.get("data", {}).get("retrieval", {}).get("results", []))
        ok(f"{n} debug results") if n > 0 else fail("no debug results")
    else:
        fail(f"code={code}")


# ── Summary ──────────────────────────────────────────────────────
print(f"\n{'='*60}")
print(f"RESULTS: {PASSED} passed, {FAILED} failed, {PASSED+FAILED} total")
if FAILED > 0:
    print("SOME TESTS FAILED")
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
