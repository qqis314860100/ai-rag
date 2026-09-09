import json

from app.core import pipeline as pipeline_module
from app.core.pipeline import RagPipeline, _estimate_confidence, _extract_query_terms, _keyword_rerank, rerank_hits
from app.core.pipeline import retrieve as retrieve_module
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


def test_rerank_adapter_records_topk_distribution_and_hit_features() -> None:
    hits = [
        _hit(0.58, "绝缘电阻测试标准为电压、时间和阈值满足工艺要求。", document_id="doc-standard"),
        _hit(0.64, "设备维护周期和日常点检要求。", document_id="doc-maintain"),
    ]

    result = rerank_hits("绝缘电阻测试标准是什么？", hits, top_k=2, mode="local")
    trace = result["trace"]
    top_hit = result["results"][0]

    assert trace["mode"] == "local"
    assert trace["topk_distribution"]["count"] == 2
    assert trace["topk_distribution"]["score_buckets"]
    assert trace["hit_features"][0]["matched_features"]
    assert top_hit["metadata"]["rerank"]["topk_distribution"]["count"] == 2
    assert "keyword_bm25" in top_hit["metadata"]["rerank"]["matched_features"]


def test_rerank_adapter_llm_mode_reorders_candidates_and_records_reason(monkeypatch) -> None:
    hits = [
        _hit(0.62, "设备维护周期和日常点检要求。", document_id="doc-maintain"),
        _hit(0.55, "OCV异常时需要复核静置时间、采样线和电压阈值。", document_id="doc-ocv"),
    ]
    preferred_chunk_id = hits[1]["chunk_id"]

    def fake_llm_chat(messages, temperature=None, stream=False, response_format=None):
        assert response_format == {"type": "json_object"}
        return {
            "content": json.dumps({
                "ranked_chunk_ids": [preferred_chunk_id, hits[0]["chunk_id"]],
                "reasons": {preferred_chunk_id: "命中 OCV 异常处理证据"},
            }, ensure_ascii=False),
            "model": "fake",
            "latency_ms": 1,
        }

    monkeypatch.setattr(retrieve_module.config, "rag_rerank_mode", "llm")
    monkeypatch.setattr(retrieve_module, "llm_chat", fake_llm_chat)

    result = rerank_hits("OCV异常怎么处理？", hits, top_k=2)

    assert result["trace"]["mode"] == "llm"
    assert result["results"][0]["chunk_id"] == preferred_chunk_id
    assert result["results"][0]["metadata"]["llm_rerank"]["reason"] == "命中 OCV 异常处理证据"
    assert result["results"][0]["metadata"]["rerank"]["mode"] == "llm"


def test_search_expands_terminology_before_embedding_and_records_hits(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_embed_query(query: str) -> list[float]:
        captured["embedding_query"] = query
        return [0.1, 0.2, 0.3]

    def fake_search(query_embedding, allowed_security_levels, top_k, filters=None, namespace=None, scopes=None):
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
    assert result["rerank_trace"]["topk_distribution"]["count"] == 2
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


def test_confidence_profile_uses_distribution_citations_filters_and_query_understanding() -> None:
    hits = [
        _hit(
            0.82,
            "OCV异常时需要复核静置时间、采样线和电压阈值。",
            document_id="doc-ocv",
            section_path="终检 / OCV异常排查",
        ),
        _hit(
            0.76,
            "OCV异常处理需要记录报警代码，并复测电压一致性。",
            document_id="doc-ocv",
            section_path="终检 / OCV异常排查",
        ),
        _hit(
            0.63,
            "复核通过后上传测试结果和处理记录。",
            document_id="doc-ocv",
            section_path="终检 / OCV异常排查",
        ),
    ]

    profile = retrieve_module._build_confidence_profile(
        "OCV异常怎么处理？",
        hits,
        filters={"document_id": "doc-ocv", "section_path": "OCV异常排查"},
        query_understanding={"confidence": 0.91, "needs_confirmation": False},
    )

    assert profile["confidence"] >= 0.8
    assert profile["components"]["topk_distribution"] > 0.75
    assert profile["components"]["citation_count"] == 1.0
    assert profile["components"]["citation_coverage"] >= 0.9
    assert profile["components"]["document_filter_match"] == 1.0
    assert profile["components"]["section_filter_match"] == 1.0
    assert profile["components"]["query_understanding"] == 0.91


def test_confidence_profile_caps_low_query_understanding() -> None:
    hits = [
        _hit(0.86, "这个流程需要先确认测试对象，再执行复测。"),
        _hit(0.79, "复测结果通过后才允许放行。"),
    ]

    profile = retrieve_module._build_confidence_profile(
        "这个呢？",
        hits,
        query_understanding={"confidence": 0.2, "needs_confirmation": True},
    )

    assert profile["confidence"] <= 0.55
    assert "low_query_understanding" in profile["caps"]


def test_estimate_confidence_caps_weak_evidence() -> None:
    hits = [
        _hit(0.18, "设备维护周期和日常点检要求。", context_window=""),
    ]

    confidence = _estimate_confidence("绝缘电阻测试标准是什么？", hits)

    assert confidence <= 0.55


def test_system_prompt_prefers_short_direct_answers_for_specific_questions() -> None:
    assert "先用 1 句话给结论" in SYSTEM_PROMPT
    assert "不要写长篇综述" in SYSTEM_PROMPT
