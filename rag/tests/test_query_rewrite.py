from app.core import pipeline as pipeline_module
from app.core.pipeline import RagPipeline, _rewrite_query, _rewrite_query_with_trace


def test_rewrite_resolves_reference_pronoun_from_recent_user_turn() -> None:
    result = _rewrite_query_with_trace(
        "它的异常怎么处理？",
        history=[
            {"role": "user", "content": "绝缘电阻测试标准是什么？"},
            {"role": "assistant", "content": "绝缘电阻测试需要满足测试电压和合格阈值。"},
        ],
    )

    assert result.changed is True
    assert result.strategy == "history_pronoun_resolution"
    assert result.rewritten_query == "绝缘电阻测试标准的异常怎么处理？"
    assert "pronoun" in result.signals
    assert result.history_turns == 2


def test_rewrite_completes_elliptical_followup_from_recent_topic() -> None:
    result = _rewrite_query_with_trace(
        "合格阈值呢？",
        history=[{"role": "user", "content": "绝缘电阻测试标准是什么？"}],
    )

    assert result.changed is True
    assert result.strategy == "history_ellipsis_completion"
    assert result.rewritten_query == "绝缘电阻测试标准 合格阈值呢？"
    assert "ellipsis" in result.signals


def test_rewrite_keeps_clear_standalone_question_unchanged() -> None:
    result = _rewrite_query_with_trace(
        "涂布烘箱温度异常的排查步骤是什么？",
        history=[{"role": "user", "content": "绝缘电阻测试标准是什么？"}],
    )

    assert result.changed is False
    assert result.strategy == "none"
    assert result.rewritten_query == "涂布烘箱温度异常的排查步骤是什么？"
    assert "history_topic" in result.signals


def test_rewrite_marks_low_information_without_history() -> None:
    result = _rewrite_query_with_trace("这个呢？")

    assert result.changed is False
    assert result.strategy == "low_information"
    assert result.reason == "问题信息量过低，且没有可用于补全的历史上下文"
    assert result.signals == ["low_information"]


def test_rewrite_preserves_chapter_number_compatibility() -> None:
    result = _rewrite_query_with_trace("第五章安全注意事项是什么？")

    assert result.changed is True
    assert result.strategy == "chapter_number_expansion"
    assert result.rewritten_query == "第五章安全注意事项是什么？ 第5章"
    assert _rewrite_query("第五章安全注意事项是什么？") == result.rewritten_query


def test_chat_uses_rewrite_trace_for_retrieval_and_answer_ir(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_search(self, query, top_k, allowed_security_levels, filters=None):
        captured["retrieval_query"] = query
        return {
            "latency_ms": 3,
            "results": [
                {
                    "chunk_id": "chunk-1",
                    "document_id": "doc-1",
                    "document_title": "绝缘电阻测试规范",
                    "section_path": "异常处理",
                    "page_number": 5,
                    "score": 0.9,
                    "content": "绝缘电阻测试异常时需要先检查夹具、线缆和测试电压。",
                    "snippet": "绝缘电阻测试异常时需要先检查夹具、线缆和测试电压。",
                }
            ],
        }

    def fake_llm_chat(messages, temperature=0.2):
        captured["prompt_query"] = messages[-1]["content"]
        return {
            "content": "结论：先检查夹具、线缆和测试电压。[来源 1]",
            "latency_ms": 4,
        }

    monkeypatch.setattr(RagPipeline, "search", fake_search)
    monkeypatch.setattr(pipeline_module, "llm_chat", fake_llm_chat)

    result = RagPipeline().chat(
        query="它的异常怎么处理？",
        top_k=1,
        allowed_security_levels=["internal"],
        history=[{"role": "user", "content": "绝缘电阻测试标准是什么？"}],
    )

    rewrite = result["answer_ir"]["query_rewrite"]
    assert captured["retrieval_query"] == "绝缘电阻测试标准的异常怎么处理？"
    assert captured["prompt_query"] == "它的异常怎么处理？"
    assert rewrite["strategy"] == "history_pronoun_resolution"
    assert rewrite["rewritten_query"] == captured["retrieval_query"]
