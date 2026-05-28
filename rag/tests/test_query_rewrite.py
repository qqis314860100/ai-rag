from app.core import pipeline as pipeline_module
from app.core.pipeline import RagPipeline, _rewrite_query, _rewrite_query_with_trace
from app.core.terminology import list_term_entries, terminology_contract


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


def test_rewrite_expands_battery_terms_with_trace() -> None:
    result = _rewrite_query_with_trace("OCV异常怎么处理？")

    assert result.changed is True
    assert result.strategy == "terminology_expansion"
    assert "开路电压" in result.rewritten_query
    assert "terminology_expansion" in result.signals
    assert "term:OCV" in result.signals
    assert result.term_expansion_hits[0].canonical_term == "OCV"
    assert result.term_expansion_hits[0].matched_kind == "abbreviation"
    assert "开路电压" in result.term_expansion_hits[0].expansions
    assert result.query_understanding.intent == "troubleshooting"
    assert result.query_understanding.candidate_terms[0].term == "OCV"
    assert result.query_understanding.needs_confirmation is False


def test_query_understanding_corrects_misspelled_abbreviation() -> None:
    result = _rewrite_query_with_trace("elo测试异常怎么处理？")

    understanding = result.query_understanding
    assert result.changed is True
    assert result.strategy == "compound"
    assert "EOL" in result.rewritten_query
    assert "spell_correction" in result.signals
    assert understanding.original_query == "elo测试异常怎么处理？"
    assert understanding.rewritten_query == result.rewritten_query
    assert understanding.intent == "troubleshooting"
    assert understanding.spell_corrections[0].original == "elo"
    assert understanding.spell_corrections[0].correction == "EOL"
    assert any(term.term == "EOL" for term in understanding.candidate_terms)
    assert understanding.needs_confirmation is False
    assert "elo -> EOL" in understanding.grey_answer_hint


def test_query_understanding_marks_low_information_confirmation() -> None:
    result = _rewrite_query_with_trace("这个呢？")

    understanding = result.query_understanding
    assert understanding.original_query == "这个呢？"
    assert understanding.intent == "general"
    assert understanding.ambiguity.is_ambiguous is True
    assert understanding.needs_confirmation is True
    assert understanding.confidence == 0.2


def test_terminology_contract_covers_initial_battery_line_terms() -> None:
    contract = terminology_contract()
    terms = {entry["canonical_term"]: entry for entry in list_term_entries()}

    assert contract["schema_version"] == "terminology.v1"
    assert {"OCV", "DCR", "EOL", "SOC", "SOP", "CCD", "Busbar"}.issubset(terms)
    for term in ("OCV", "DCR", "EOL", "SOC", "SOP", "CCD", "Busbar"):
        entry = terms[term]
        assert entry["definition"]
        assert entry["applicable_scenarios"]
        assert entry["source_refs"]
        assert entry["related_topics"]
        assert entry["retrieval_terms"]


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
    understanding = result["answer_ir"]["query_understanding"]
    assert captured["retrieval_query"] == "绝缘电阻测试标准的异常怎么处理？"
    assert captured["prompt_query"] == "它的异常怎么处理？"
    assert rewrite["strategy"] == "history_pronoun_resolution"
    assert rewrite["rewritten_query"] == captured["retrieval_query"]
    assert understanding["original_query"] == "它的异常怎么处理？"
    assert understanding["rewritten_query"] == captured["retrieval_query"]
    assert understanding["intent"] == "troubleshooting"
