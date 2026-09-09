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
    def fake_search(self, query, top_k, allowed_security_levels, filters=None, namespace=None, scopes=None):
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
    def fake_search(self, query, top_k, allowed_security_levels, filters=None, namespace=None, scopes=None):
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


def test_chat_warns_context_conflict_without_hard_refusal(monkeypatch) -> None:
    def fake_search(self, query, top_k, allowed_security_levels, filters=None, namespace=None, scopes=None):
        return {
            "latency_ms": 3,
            "results": [
                _hit(0.86, "绝缘测试夹具接地前必须检查接地线连续性。", "chunk-a"),
                _hit(0.83, "绝缘测试夹具接地前不需要检查接地线连续性。", "chunk-b"),
            ],
        }

    captured_messages: list[dict] = []

    def fake_llm_chat(messages, temperature=0.2):
        captured_messages.extend(messages)
        return {
            "content": "资料存在差异：部分来源要求接地前检查接地线连续性，另有来源表述为不需要检查；请以受控版本为准。",
            "latency_ms": 5,
        }

    monkeypatch.setattr(RagPipeline, "search", fake_search)
    monkeypatch.setattr(pipeline_module, "llm_chat", fake_llm_chat)

    result = RagPipeline().chat(
        query="绝缘测试夹具接地前是否需要检查接地线连续性？",
        top_k=2,
        allowed_security_levels=["internal"],
    )

    warning_codes = [warning["code"] for warning in result["answer_ir"]["warnings"]]
    assert result["answer"] != REFUSAL_ANSWER
    assert result["answer_ir"]["status"] in ("answered", "partial")
    assert result["confidence"] > 0
    assert "context_conflict" in warning_codes
    conflict_warning = next(warning for warning in result["answer_ir"]["warnings"] if warning["code"] == "context_conflict")
    assert conflict_warning["citation_ids"] == ["chunk-a", "chunk-b"]
    assert "精确核验" in conflict_warning["message"]
    assert result["answer_ir"]["metadata"]["refusal_reasons"] == []
    assert result["answer_ir"]["metadata"]["conflict_assessment"]["status"] == "candidate"
    assert result["answer_ir"]["metadata"]["conflict_assessment"]["verification"] == "precise"
    assert result["answer_ir"]["metadata"]["conflict_assessment"]["decision"] == "warn_only"
    risk_prompt = next(message["content"] for message in captured_messages if "检索风险提示" in message["content"])
    assert "chunk-a" in risk_prompt
    assert "chunk-b" in risk_prompt


def test_chat_allows_safety_context_with_required_and_forbidden_actions(monkeypatch) -> None:
    def fake_search(self, query, top_k, allowed_security_levels, filters=None, namespace=None, scopes=None):
        return {
            "latency_ms": 3,
            "results": [
                _hit(
                    0.86,
                    "EOL测试柜涉及高压操作，操作人员必须经过高压安全培训。测试过程中严禁人员进入测试区域。",
                    "chunk-a",
                ),
                _hit(
                    0.83,
                    "Pack EOL下线前需要确认绝缘防护，禁止在高压指示灯亮起时打开防护门。",
                    "chunk-b",
                ),
            ],
        }

    def fake_llm_chat(messages, temperature=0.2):
        return {
            "content": "EOL测试安全注意事项包括高压安全培训、确认绝缘防护、禁止人员进入测试区域，并避免高压指示灯亮起时打开防护门。",
            "latency_ms": 5,
        }

    monkeypatch.setattr(RagPipeline, "search", fake_search)
    monkeypatch.setattr(pipeline_module, "llm_chat", fake_llm_chat)

    result = RagPipeline().chat(
        query="EOL测试安全注意事项有哪些？",
        top_k=2,
        allowed_security_levels=["internal"],
    )

    assert result["answer"] != REFUSAL_ANSWER
    assert result["answer_ir"]["status"] in ("answered", "partial")
    assert result["confidence"] > 0
    warning_codes = [warning["code"] for warning in result["answer_ir"]["warnings"]]
    assert "context_conflict" not in warning_codes


def test_chat_allows_negative_status_terms_without_self_conflict(monkeypatch) -> None:
    def fake_search(self, query, top_k, allowed_security_levels, filters=None, namespace=None, scopes=None):
        return {
            "latency_ms": 3,
            "results": [
                _hit(0.82, "模组EOL测试不合格的模组进入待处理区，需记录条码和测试项目。", "chunk-a"),
                _hit(0.78, "气密终检不合格时，Pack需要复检并隔离等待处理。", "chunk-b"),
            ],
        }

    def fake_llm_chat(messages, temperature=0.2):
        return {
            "content": "模组EOL测试包括测试执行、结果判定和不合格品处理；不合格模组需进入待处理区并记录条码和项目。",
            "latency_ms": 5,
        }

    monkeypatch.setattr(RagPipeline, "search", fake_search)
    monkeypatch.setattr(pipeline_module, "llm_chat", fake_llm_chat)

    result = RagPipeline().chat(
        query="模组 EOL 测试",
        top_k=2,
        allowed_security_levels=["internal"],
    )

    assert result["answer"] != REFUSAL_ANSWER
    assert result["answer_ir"]["status"] in ("answered", "partial")
    warning_codes = [warning["code"] for warning in result["answer_ir"]["warnings"]]
    assert "context_conflict" not in warning_codes


def test_stream_chat_emits_structured_refusal_without_llm(monkeypatch) -> None:
    def fake_search(query, top_k, allowed_security_levels, filters=None, namespace=None, scopes=None):
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
    refusal_token = next(event for event in events if event.get("type") == "token")
    done_event = next(event for event in events if event.get("type") == "done")
    assert refusal_token == {"type": "token", "content": REFUSAL_ANSWER}
    assert done_event["answer_ir"]["status"] == "insufficient_context"
    assert "low_information" in done_event["answer_ir"]["metadata"]["refusal_reasons"]
