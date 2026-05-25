from app.core.pipeline import _estimate_confidence, _extract_query_terms, _keyword_rerank
from app.llm.prompt_builder import SYSTEM_PROMPT


def _hit(
    score: float,
    content: str,
    document_id: str = "doc_1",
    document_title: str = "模组EOL测试",
    section_path: str = "5. 安全注意事项",
    context_window: str | None = None,
) -> dict:
    return {
        "chunk_id": f"chunk_{abs(hash(content))}",
        "document_id": document_id,
        "document_title": document_title,
        "section_path": section_path,
        "score": score,
        "snippet": content[:80],
        "content": content,
        "context_window": context_window if context_window is not None else content,
        "source_context": {
            "content": content,
            "snippet": content[:80],
            "window": context_window if context_window is not None else content,
            "available": bool(content),
        },
        "metadata": {
            "document_id": document_id,
            "section_path": section_path,
        },
    }


def test_extract_query_terms_handles_compact_chinese_domain_terms() -> None:
    terms = _extract_query_terms("绝缘电阻测试标准是什么？")

    assert "绝缘电阻测试标准" in terms
    assert "绝缘电阻" in terms
    assert "测试标准" in terms


def test_keyword_rerank_promotes_exact_domain_match_over_noisy_vector_score() -> None:
    hits = [
        _hit(0.72, "设备维护周期和日常点检要求。", document_title="常见设备故障与维护"),
        _hit(0.58, "绝缘电阻测试标准为测试电压、保持时间和合格阈值均满足工艺要求。"),
    ]

    reranked = _keyword_rerank("绝缘电阻测试标准是什么？", hits)

    assert reranked[0]["content"].startswith("绝缘电阻测试标准")
    assert reranked[0]["score"] > reranked[1]["score"]
    assert reranked[0]["metadata"]["ranking"]["keyword_coverage"] > reranked[1]["metadata"]["ranking"]["keyword_coverage"]


def test_estimate_confidence_uses_keywords_filters_sources_and_context() -> None:
    hits = [
        _hit(0.68, "绝缘电阻测试标准为电压、时间和阈值满足工艺要求。"),
        _hit(0.61, "绝缘电阻测试前需要确认夹具、线缆和安全防护。"),
        _hit(0.55, "异常时记录报警并复核测试模块。"),
    ]

    confidence = _estimate_confidence(
        "绝缘电阻测试标准是什么？",
        hits,
        {"document_id": "doc_1"},
    )

    assert confidence >= 0.75


def test_estimate_confidence_caps_weak_evidence() -> None:
    hits = [
        _hit(0.18, "设备维护周期和日常点检要求。", context_window=""),
    ]

    confidence = _estimate_confidence("绝缘电阻测试标准是什么？", hits)

    assert confidence <= 0.55


def test_system_prompt_prefers_short_direct_answers_for_specific_questions() -> None:
    assert "先用 1 句话给结论" in SYSTEM_PROMPT
    assert "不要写长篇综述" in SYSTEM_PROMPT
