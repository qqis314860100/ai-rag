from app.core import pipeline as pipeline_module
from app.core.pipeline import RagPipeline, _estimate_confidence, _extract_query_terms, _keyword_rerank
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


def test_keyword_rerank_records_explainable_hybrid_retrieval_signals() -> None:
    hits = [
        _hit(
            0.58,
            "OCV异常时需要复核静置时间、采样线和电压阈值。",
            document_id="doc-ocv",
            document_title="OCV异常处理SOP",
            section_path="终检 / OCV异常排查",
        ),
        _hit(
            0.64,
            "设备维护周期和日常点检要求。",
            document_id="doc-maintain",
            document_title="设备维护规范",
            section_path="点检",
        ),
    ]

    reranked = _keyword_rerank(
        "OCV异常怎么处理？",
        hits,
        filters={"document_id": "doc-ocv"},
        term_expansion_hits=[{
            "canonical_term": "OCV",
            "matched_text": "OCV",
            "matched_kind": "abbreviation",
            "expansions": ["开路电压", "OCV异常"],
            "source": "built_in_battery_line_glossary",
        }],
    )

    ranking = reranked[0]["metadata"]["ranking"]
    signals = reranked[0]["metadata"]["retrieval_signals"]
    signal_names = {signal["name"] for signal in signals}

    assert reranked[0]["document_id"] == "doc-ocv"
    assert reranked[0]["metadata"]["retrieval_mode"] == "hybrid"
    assert {"vector_recall", "keyword_bm25", "title_hit", "section_hit", "term_hit", "document_filter_hit"} == signal_names
    assert ranking["bm25_score"] > 0
    assert ranking["title_coverage"] > 0
    assert ranking["section_coverage"] > 0
    assert ranking["term_match"] > 0
    assert ranking["filter_match"] == 1.0


def test_search_expands_terminology_before_embedding_and_records_hits(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_embed_query(query: str) -> list[float]:
        captured["embedding_query"] = query
        return [0.1, 0.2, 0.3]

    def fake_search(query_embedding, allowed_security_levels, top_k, filters=None):
        return [
            _hit(0.61, "开路电压异常时需要复核静置时间、采样线和电压阈值。"),
            _hit(0.7, "设备维护周期和日常点检要求。", document_title="常见设备故障与维护"),
        ]

    monkeypatch.setattr(pipeline_module, "embed_query", fake_embed_query)
    monkeypatch.setattr(pipeline_module, "search", fake_search)

    result = RagPipeline().search(
        query="OCV异常怎么处理？",
        top_k=2,
        allowed_security_levels=["internal"],
    )

    assert "开路电压" in captured["embedding_query"]
    assert result["expanded_query"] == captured["embedding_query"]
    assert result["term_expansion_hits"][0]["canonical_term"] == "OCV"
    domain_hit = next(hit for hit in result["results"] if hit["content"].startswith("开路电压异常"))
    noisy_hit = next(hit for hit in result["results"] if hit["content"].startswith("设备维护周期"))
    assert domain_hit["metadata"]["ranking"]["keyword_coverage"] > noisy_hit["metadata"]["ranking"]["keyword_coverage"]
    assert domain_hit["metadata"]["ranking"]["term_match"] > noisy_hit["metadata"]["ranking"]["term_match"]
    assert domain_hit["metadata"]["retrieval_signals"]



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
