import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import routes
from app.core import pipeline as pipeline_module
from app.core.pipeline import RagPipeline, REFUSAL_ANSWER


def _hit(score: float, content: str, chunk_id: str = "chunk-1") -> dict:
    return {
        "chunk_id": chunk_id,
        "document_id": "doc-1",
        "document_title": "绝缘测试规范",
        "section_path": "安全要求",
        "page_number": 1,
        "score": score,
        "snippet": content[:80],
        "content": content,
        "context_window": content,
        "source_context": {
            "content": content,
            "snippet": content[:80],
            "window": content,
            "available": bool(content),
        },
    }


def test_chat_refuses_low_information_query_without_llm(monkeypatch) -> None:
    def fake_search(self, query, top_k, allowed_security_levels, filters=None):
        return {"latency_ms": 2, "results": []}

    def fail_llm_chat(messages, temperature=0.2):
        raise AssertionError("低信息问题不应调用 LLM")

    monkeypatch.setattr(RagPipeline, "search", fake_search)
    monkeypatch.setattr(pipeline_module, "llm_chat", fail_llm_chat)

    result = RagPipeline().chat(
        query="这个呢？",
        top_k=3,
        allowed_security_levels=["internal"],
    )

    assert result["answer"] == REFUSAL_ANSWER
    assert result["sources"] == []
    assert result["confidence"] == 0
    assert result["trace"]["llm_ms"] == 0
    assert result["answer_ir"]["status"] == "insufficient_context"
    assert "low_information" in result["answer_ir"]["metadata"]["refusal_reasons"]


def test_chat_refuses_weak_evidence_with_structured_reason(monkeypatch) -> None:
    def fake_search(self, query, top_k, allowed_security_levels, filters=None):
        return {
            "latency_ms": 3,
            "results": [_hit(0.16, "设备维护周期和日常点检要求。")],
        }

    def fail_llm_chat(messages, temperature=0.2):
        raise AssertionError("低证据问题不应调用 LLM")

    monkeypatch.setattr(RagPipeline, "search", fake_search)
    monkeypatch.setattr(pipeline_module, "llm_chat", fail_llm_chat)

    result = RagPipeline().chat(
        query="绝缘电阻测试标准是什么？",
        top_k=1,
        allowed_security_levels=["internal"],
    )

    warning_codes = [warning["code"] for warning in result["answer_ir"]["warnings"]]
    assert result["answer_ir"]["status"] == "insufficient_context"
    assert result["confidence"] == 0
    assert result["answer_ir"]["confidence"] == 0
    assert "insufficient_evidence" in warning_codes
    assert result["answer_ir"]["metadata"]["refusal_reason"] == "insufficient_evidence"
    assert result["sources"][0]["chunk_id"] == "chunk-1"


def test_chat_refuses_context_conflict(monkeypatch) -> None:
    def fake_search(self, query, top_k, allowed_security_levels, filters=None):
        return {
            "latency_ms": 3,
            "results": [
                _hit(0.86, "绝缘测试夹具接地前必须检查接地线连续性。", "chunk-a"),
                _hit(0.83, "绝缘测试夹具接地前不需要检查接地线连续性。", "chunk-b"),
            ],
        }

    def fail_llm_chat(messages, temperature=0.2):
        raise AssertionError("上下文冲突时不应调用 LLM")

    monkeypatch.setattr(RagPipeline, "search", fake_search)
    monkeypatch.setattr(pipeline_module, "llm_chat", fail_llm_chat)

    result = RagPipeline().chat(
        query="绝缘测试夹具接地前是否需要检查接地线连续性？",
        top_k=2,
        allowed_security_levels=["internal"],
    )

    assert result["answer_ir"]["status"] == "insufficient_context"
    assert result["confidence"] == 0
    assert result["answer_ir"]["confidence"] == 0
    assert "context_conflict" in result["answer_ir"]["metadata"]["refusal_reasons"]
    assert result["followups"]


def test_stream_chat_emits_structured_refusal_without_llm(monkeypatch) -> None:
    def fake_search(query, top_k, allowed_security_levels, filters=None):
        return {"latency_ms": 2, "results": []}

    def fail_llm_stream(messages, temperature=0.2):
        raise AssertionError("拒答流式路径不应调用 LLM")

    monkeypatch.setattr(routes.pipeline, "search", fake_search)
    monkeypatch.setattr("app.llm.client.chat_stream", fail_llm_stream)

    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app)

    response = client.post("/rag/chat/stream", json={"query": "这个呢？", "top_k": 3})

    assert response.status_code == 200
    events = [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]
    assert events[1] == {"type": "token", "content": REFUSAL_ANSWER}
    assert events[2]["type"] == "done"
    assert events[2]["answer_ir"]["status"] == "insufficient_context"
    assert "low_information" in events[2]["answer_ir"]["metadata"]["refusal_reasons"]
