import math
import json
import logging
import re

from ..config import config
from ...llm.client import chat as llm_chat
from ..source_metadata import (
    infer_content_kind,
    infer_file_type,
    infer_mime_type,
    normalize_source_format,
)
from .retrieve_signals import (
    clamp_float as _clamp_float,
    context_availability_score as _context_availability_score,
    context_conflict_candidates as _context_conflict_candidates,
    dedupe_terms as _dedupe_terms,
    extract_query_terms as _extract_query_terms,
    filter_match_score as _filter_match_score,
    has_context_conflict as _has_context_conflict,
    hit_document_title_text as _hit_document_title_text,
    hit_section_text as _hit_section_text,
    hit_text as _hit_text,
    keyword_coverage as _keyword_coverage,
    meaningful_filters as _meaningful_filters,
    source_count_score as _source_count_score,
    term_coverage_score as _term_coverage_score,
    value_matches_filter as _value_matches_filter,
)

logger = logging.getLogger(__name__)


def _build_ingest_metadata(file_path: str, metadata: dict | None = None) -> dict:
    source = metadata or {}
    file_type = infer_file_type(
        source.get("file_type"),
        source.get("source_format"),
        source.get("mime_type"),
        file_path=file_path,
    )
    mime_type = source.get("mime_type") or infer_mime_type(file_type)
    content_kind = source.get("content_kind") or infer_content_kind(file_type, mime_type)
    source_format = normalize_source_format(file_type)
    return {
        **source,
        "file_type": file_type,
        "source_format": source_format,
        "mime_type": mime_type,
        "content_kind": content_kind,
        "preview_format": content_kind,
    }


_CONFIDENCE_SIGNAL_WEIGHTS = {
    "top1_score": 0.22,
    "topk_distribution": 0.15,
    "keyword_coverage": 0.15,
    "citation_count": 0.10,
    "citation_coverage": 0.12,
    "document_filter_match": 0.05,
    "section_filter_match": 0.05,
    "query_understanding": 0.07,
    "context_availability": 0.09,
}


def _estimate_confidence(
    query: str,
    hits: list[dict],
    filters: dict | None = None,
    knowledge_assets: list[dict] | None = None,
    query_understanding: object | None = None,
) -> float:
    return _build_confidence_profile(
        query,
        hits,
        filters=filters,
        knowledge_assets=knowledge_assets,
        query_understanding=query_understanding,
    )["confidence"]


def _build_confidence_profile(
    query: str,
    hits: list[dict],
    filters: dict | None = None,
    knowledge_assets: list[dict] | None = None,
    query_understanding: object | None = None,
) -> dict:
    if not hits:
        return {
            "confidence": 0.0,
            "components": {},
            "weights": _CONFIDENCE_SIGNAL_WEIGHTS,
            "caps": ["no_hits"],
        }

    top_hits = hits[:5]
    top1 = _clamp_float(top_hits[0].get("score", 0))
    components = {
        "top1_score": top1,
        "topk_distribution": _topk_distribution_score(top_hits),
        "keyword_coverage": _keyword_coverage(query, top_hits[:3]),
        "citation_count": _citation_count_score(top_hits),
        "citation_coverage": _citation_coverage_score(top_hits),
        "document_filter_match": _filter_group_match_score(
            filters,
            top_hits[:3],
            {"document_id", "document_title", "document_type", "category", "source_format"},
        ),
        "section_filter_match": _filter_group_match_score(
            filters,
            top_hits[:3],
            {"section_path", "section_title", "chapter_title", "section_level", "page_number"},
        ),
        "query_understanding": _query_understanding_confidence(query_understanding),
        "context_availability": _context_availability_score(top_hits[:3]),
    }
    asset_score = min(1.0, len(knowledge_assets or []) / 3)

    confidence = sum(
        components[name] * weight
        for name, weight in _CONFIDENCE_SIGNAL_WEIGHTS.items()
    )
    if asset_score:
        confidence += asset_score * 0.03

    caps: list[str] = []
    if top1 < 0.2:
        confidence = min(confidence, 0.55)
        caps.append("very_low_top1")
    if components["keyword_coverage"] < 0.2 and top1 < 0.45:
        confidence = min(confidence, 0.60)
        caps.append("weak_keyword_match")
    if components["citation_coverage"] < 0.55:
        confidence = min(confidence, 0.68)
        caps.append("weak_citation_coverage")
    if components["context_availability"] < 0.5:
        confidence = min(confidence, 0.75)
        caps.append("weak_context")
    if _meaningful_filters(filters) and (
        components["document_filter_match"] < 0.5
        or components["section_filter_match"] < 0.5
    ):
        confidence = min(confidence, 0.60)
        caps.append("filter_mismatch")
    if components["query_understanding"] < 0.35:
        confidence = min(confidence, 0.55)
        caps.append("low_query_understanding")

    return {
        "confidence": round(_clamp_float(confidence), 2),
        "components": {key: round(value, 4) for key, value in components.items()},
        "weights": _CONFIDENCE_SIGNAL_WEIGHTS,
        "knowledge_asset_match": round(asset_score, 4),
        "topk_distribution": _topk_distribution(top_hits),
        "caps": caps,
    }


def _topk_distribution_score(hits: list[dict]) -> float:
    if not hits:
        return 0.0

    scores = [_clamp_float(hit.get("score", 0)) for hit in hits]
    average = sum(scores) / len(scores)
    useful_ratio = sum(1 for score in scores if score >= 0.4) / len(scores)
    strong_ratio = sum(1 for score in scores if score >= 0.6) / len(scores)
    consistency = 1.0 - min(1.0, max(scores) - min(scores))
    return _clamp_float(
        average * 0.45
        + useful_ratio * 0.20
        + strong_ratio * 0.25
        + consistency * 0.10
    )


def _citation_count_score(hits: list[dict]) -> float:
    usable_count = sum(1 for hit in hits if _citation_quality_score(hit) >= 0.55)
    return _source_count_score(usable_count)


def _citation_coverage_score(hits: list[dict]) -> float:
    if not hits:
        return 0.0
    return round(sum(_citation_quality_score(hit) for hit in hits) / len(hits), 4)


def _citation_quality_score(hit: dict) -> float:
    source_context = (
        hit.get("source_context")
        if isinstance(hit.get("source_context"), dict)
        else {}
    )
    metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
    text = " ".join(
        str(value)
        for value in (
            hit.get("context_window"),
            source_context.get("window"),
            hit.get("content"),
            source_context.get("content"),
            hit.get("snippet"),
            source_context.get("snippet"),
        )
        if value
    )
    location = hit.get("section_path") or metadata.get("section_path") or hit.get("page_number")
    score = 0.0
    if hit.get("chunk_id") or hit.get("id"):
        score += 0.25
    if hit.get("document_id") or metadata.get("document_id"):
        score += 0.18
    if hit.get("document_title") or metadata.get("document_title"):
        score += 0.12
    if location:
        score += 0.20
    if text:
        score += 0.25
    return _clamp_float(score)


def _filter_group_match_score(
    filters: dict | None,
    hits: list[dict],
    allowed_keys: set[str],
) -> float:
    meaningful_filters = {
        key: value
        for key, value in _meaningful_filters(filters).items()
        if key in allowed_keys
    }
    if not meaningful_filters:
        return 0.7
    if not hits:
        return 0.0

    matched = 0
    total = 0
    for key, expected in meaningful_filters.items():
        for hit in hits:
            metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
            actual = hit.get(key, metadata.get(key))
            total += 1
            if _value_matches_filter(actual, expected):
                matched += 1
    return _clamp_float(matched / max(total, 1))


def _query_understanding_confidence(query_understanding: object | None) -> float:
    if query_understanding is None:
        return 0.7

    target = query_understanding
    if isinstance(query_understanding, dict):
        target = query_understanding.get("query_understanding", query_understanding)
    elif hasattr(query_understanding, "query_understanding"):
        target = getattr(query_understanding, "query_understanding")

    if isinstance(target, dict):
        confidence = _clamp_float(target.get("confidence", 0.7))
        needs_confirmation = bool(target.get("needs_confirmation"))
    else:
        confidence = _clamp_float(getattr(target, "confidence", 0.7))
        needs_confirmation = bool(getattr(target, "needs_confirmation", False))

    if needs_confirmation:
        return min(confidence, 0.45)
    return confidence


_HYBRID_SIGNAL_WEIGHTS = {
    "vector_recall": 0.38,
    "keyword_bm25": 0.22,
    "title_hit": 0.12,
    "section_hit": 0.10,
    "term_hit": 0.10,
    "document_filter_hit": 0.08,
}


def rerank_hits(
    query: str,
    hits: list[dict],
    filters: dict | None = None,
    term_expansion_hits: list[dict] | None = None,
    top_k: int | None = None,
    mode: str | None = None,
) -> dict:
    """Rerank vector candidates through a configurable adapter and return audit trace."""
    configured_mode = _normalize_rerank_mode(mode or config.rag_rerank_mode)
    candidate_count = len(hits)
    requested_top_k = top_k or candidate_count
    if not hits:
        trace = _build_rerank_trace(
            mode=configured_mode,
            configured_mode=configured_mode,
            candidate_count=0,
            requested_top_k=requested_top_k,
            selected_hits=[],
        )
        return {"results": hits, "trace": trace}

    working_hits = [_copy_hit_with_original_rank(hit, index) for index, hit in enumerate(hits)]
    fallback_reason = ""

    if configured_mode == "off":
        ranked_hits = sorted(working_hits, key=lambda hit: hit.get("score", 0), reverse=True)
        mode_used = "off"
    else:
        ranked_hits = _local_hybrid_rerank(
            query,
            working_hits,
            filters,
            term_expansion_hits=term_expansion_hits,
        )
        mode_used = "local"

        if configured_mode == "llm":
            try:
                ranked_hits, fallback_reason = _llm_rerank(
                    query,
                    ranked_hits,
                    filters=filters,
                    requested_top_k=requested_top_k,
                )
                mode_used = "llm" if not fallback_reason else "local"
            except Exception as exc:  # pragma: no cover - defensive fallback
                fallback_reason = f"llm_exception:{type(exc).__name__}"
                logger.warning("LLM rerank failed, falling back to local rerank: %s", exc)
                mode_used = "local"

    selected_hits = ranked_hits[:requested_top_k]
    trace = _build_rerank_trace(
        mode=mode_used,
        configured_mode=configured_mode,
        candidate_count=candidate_count,
        requested_top_k=requested_top_k,
        selected_hits=selected_hits,
        fallback_reason=fallback_reason,
    )
    _annotate_rerank_metadata(selected_hits, trace)
    return {"results": selected_hits, "trace": trace}


def _keyword_rerank(
    query: str,
    hits: list[dict],
    filters: dict | None = None,
    term_expansion_hits: list[dict] | None = None,
) -> list[dict]:
    return rerank_hits(
        query,
        hits,
        filters,
        term_expansion_hits=term_expansion_hits,
        top_k=len(hits),
        mode="local",
    )["results"]


def _local_hybrid_rerank(
    query: str,
    hits: list[dict],
    filters: dict | None = None,
    term_expansion_hits: list[dict] | None = None,
) -> list[dict]:
    """Hybrid retrieval scoring over vector candidates, with auditable signals."""
    keywords = _extract_query_terms(query)
    if not hits:
        return hits

    bm25_scores = _bm25_scores(keywords, hits)
    for index, h in enumerate(hits):
        metadata = h.get("metadata") if isinstance(h.get("metadata"), dict) else {}
        previous_ranking = metadata.get("ranking") if isinstance(metadata.get("ranking"), dict) else {}
        body_text = _hit_text(h, include_content=True)
        keyword_score = _signal_coverage_score(keywords, body_text)
        bm25_score = bm25_scores[index] if index < len(bm25_scores) else 0.0
        keyword_bm25_score = max(keyword_score, bm25_score)
        title_score = _signal_coverage_score(keywords, _hit_document_title_text(h))
        section_score = _signal_coverage_score(keywords, _hit_section_text(h))
        term_score = _term_hit_score(term_expansion_hits, h)
        if term_expansion_hits is None:
            term_score = _clamp_float(previous_ranking.get("term_match", 0))
        filter_score = _filter_match_score(filters, [h])
        vector_score = _clamp_float(previous_ranking.get("vector_score", h.get("score", 0)))

        hybrid_score = (
            vector_score * _HYBRID_SIGNAL_WEIGHTS["vector_recall"]
            + keyword_bm25_score * _HYBRID_SIGNAL_WEIGHTS["keyword_bm25"]
            + title_score * _HYBRID_SIGNAL_WEIGHTS["title_hit"]
            + section_score * _HYBRID_SIGNAL_WEIGHTS["section_hit"]
            + term_score * _HYBRID_SIGNAL_WEIGHTS["term_hit"]
            + filter_score * _HYBRID_SIGNAL_WEIGHTS["document_filter_hit"]
        )
        vector_floor = vector_score * (0.85 if not keywords else 0.35)
        fused_score = max(vector_floor, hybrid_score)
        fused_score = _clamp_float(fused_score)

        signals = _build_retrieval_signals(
            vector_score=vector_score,
            keyword_score=keyword_bm25_score,
            bm25_score=bm25_score,
            title_score=title_score,
            section_score=section_score,
            term_score=term_score,
            filter_score=filter_score,
            filters=filters,
        )
        h["score"] = round(_clamp_float(fused_score), 4)
        metadata["ranking"] = {
            "vector_score": round(vector_score, 4),
            "keyword_coverage": round(keyword_score, 4),
            "bm25_score": round(bm25_score, 4),
            "keyword_bm25": round(keyword_bm25_score, 4),
            "title_coverage": round(title_score, 4),
            "section_coverage": round(section_score, 4),
            "term_match": round(term_score, 4),
            "filter_match": round(filter_score, 4),
            "hybrid_score": round(fused_score, 4),
            "signal_weights": _HYBRID_SIGNAL_WEIGHTS,
            "scoring_version": "hybrid_v1",
        }
        metadata["retrieval_signals"] = signals
        metadata["retrieval_mode"] = "hybrid"
        h["metadata"] = metadata
    return sorted(hits, key=lambda h: h.get("score", 0), reverse=True)


def _llm_rerank(
    query: str,
    hits: list[dict],
    *,
    filters: dict | None,
    requested_top_k: int,
) -> tuple[list[dict], str]:
    candidate_limit = max(1, min(config.rag_rerank_llm_candidate_limit, len(hits)))
    candidates = hits[:candidate_limit]
    candidate_payload = [
        {
            "chunk_id": str(hit.get("chunk_id") or ""),
            "document_title": str(hit.get("document_title") or ""),
            "section_path": str(hit.get("section_path") or ""),
            "score": round(_clamp_float(hit.get("score", 0)), 4),
            "matched_features": _matched_feature_names(hit),
            "snippet": str(hit.get("snippet") or hit.get("content") or "")[:360],
        }
        for hit in candidates
    ]
    messages = [
        {
            "role": "system",
            "content": (
                "你是企业知识库检索精排器。只返回 JSON，不要解释。"
                "按问题相关性、证据完整性、标题/章节命中和过滤条件匹配度排序。"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "query": query,
                    "top_k": requested_top_k,
                    "filters": filters or {},
                    "candidates": candidate_payload,
                    "output_schema": {
                        "ranked_chunk_ids": ["chunk id in preferred order"],
                        "reasons": {"chunk_id": "short Chinese reason"},
                    },
                },
                ensure_ascii=False,
            ),
        },
    ]
    response = llm_chat(
        messages,
        temperature=0,
        response_format={"type": "json_object"},
    )
    payload = _parse_llm_rerank_response(response.get("content", ""))
    ranked_ids = payload.get("ranked_chunk_ids")
    if not isinstance(ranked_ids, list) or not ranked_ids:
        return hits, "llm_empty_ranking"

    id_to_rank = {str(chunk_id): rank for rank, chunk_id in enumerate(ranked_ids) if str(chunk_id)}
    if not id_to_rank:
        return hits, "llm_empty_ranking"

    reasons = payload.get("reasons") if isinstance(payload.get("reasons"), dict) else {}
    for hit in hits:
        chunk_id = str(hit.get("chunk_id") or "")
        if chunk_id not in id_to_rank:
            continue
        metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
        llm_reason = str(reasons.get(chunk_id) or "").strip()
        metadata["llm_rerank"] = {
            "rank": id_to_rank[chunk_id] + 1,
            "reason": llm_reason[:120],
        }
        hit["metadata"] = metadata

    ranked = sorted(
        hits,
        key=lambda hit: (
            id_to_rank.get(str(hit.get("chunk_id") or ""), len(id_to_rank) + int(hit.get("_original_rank", 0))),
            -_clamp_float(hit.get("score", 0)),
        ),
    )
    return ranked, ""


def _parse_llm_rerank_response(content: str) -> dict:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, flags=re.S)
        if not match:
            return {}
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}


def _build_rerank_trace(
    *,
    mode: str,
    configured_mode: str,
    candidate_count: int,
    requested_top_k: int,
    selected_hits: list[dict],
    fallback_reason: str = "",
) -> dict:
    return {
        "mode": mode,
        "configured_mode": configured_mode,
        "fallback_reason": fallback_reason,
        "candidate_count": candidate_count,
        "requested_top_k": requested_top_k,
        "topk_distribution": _topk_distribution(selected_hits),
        "hit_features": [
            {
                "chunk_id": str(hit.get("chunk_id") or ""),
                "document_id": str(hit.get("document_id") or ""),
                "rank": index + 1,
                "original_rank": int(hit.get("_original_rank", index)) + 1,
                "score": round(_clamp_float(hit.get("score", 0)), 4),
                "matched_features": _matched_feature_names(hit),
            }
            for index, hit in enumerate(selected_hits)
        ],
    }


def _annotate_rerank_metadata(hits: list[dict], trace: dict) -> None:
    distribution = trace["topk_distribution"]
    for index, hit in enumerate(hits):
        metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
        original_rank = int(hit.get("_original_rank", index)) + 1
        metadata["rerank"] = {
            "mode": trace["mode"],
            "configured_mode": trace["configured_mode"],
            "rank": index + 1,
            "original_rank": original_rank,
            "rank_delta": original_rank - (index + 1),
            "candidate_count": trace["candidate_count"],
            "topk_distribution": distribution,
            "matched_features": _matched_feature_names(hit),
        }
        if trace.get("fallback_reason"):
            metadata["rerank"]["fallback_reason"] = trace["fallback_reason"]
        hit["metadata"] = metadata
        hit.pop("_original_rank", None)


def _topk_distribution(hits: list[dict]) -> dict:
    scores = [_clamp_float(hit.get("score", 0)) for hit in hits]
    buckets = {
        "0.80-1.00": 0,
        "0.60-0.79": 0,
        "0.40-0.59": 0,
        "0.20-0.39": 0,
        "0.00-0.19": 0,
    }
    for score in scores:
        if score >= 0.8:
            buckets["0.80-1.00"] += 1
        elif score >= 0.6:
            buckets["0.60-0.79"] += 1
        elif score >= 0.4:
            buckets["0.40-0.59"] += 1
        elif score >= 0.2:
            buckets["0.20-0.39"] += 1
        else:
            buckets["0.00-0.19"] += 1

    document_distribution: dict[str, dict] = {}
    for hit in hits:
        document_id = str(hit.get("document_id") or "unknown")
        entry = document_distribution.setdefault(document_id, {"count": 0, "best_score": 0.0})
        entry["count"] += 1
        entry["best_score"] = max(entry["best_score"], round(_clamp_float(hit.get("score", 0)), 4))

    return {
        "count": len(hits),
        "score_min": round(min(scores), 4) if scores else 0.0,
        "score_max": round(max(scores), 4) if scores else 0.0,
        "score_avg": round(sum(scores) / len(scores), 4) if scores else 0.0,
        "score_buckets": buckets,
        "documents": document_distribution,
    }


def _matched_feature_names(hit: dict) -> list[str]:
    metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
    signals = metadata.get("retrieval_signals") if isinstance(metadata.get("retrieval_signals"), list) else []
    feature_names = [
        str(signal.get("name"))
        for signal in signals
        if isinstance(signal, dict) and _clamp_float(signal.get("score", 0)) > 0
    ]
    if _clamp_float(hit.get("score", 0)) > 0 and "rerank_score" not in feature_names:
        feature_names.append("rerank_score")
    return feature_names


def _copy_hit_with_original_rank(hit: dict, index: int) -> dict:
    copied = {**hit}
    metadata = copied.get("metadata") if isinstance(copied.get("metadata"), dict) else {}
    copied["metadata"] = {**metadata}
    copied["_original_rank"] = index
    return copied


def _normalize_rerank_mode(mode: str | None) -> str:
    normalized = (mode or "local").strip().lower()
    if normalized in {"local", "llm", "off"}:
        return normalized
    return "local"


def _bm25_scores(terms: list[str], hits: list[dict]) -> list[float]:
    if not terms or not hits:
        return [0.0 for _ in hits]

    documents = [_hit_text(hit, include_content=True).lower() for hit in hits]
    tokenized = [_document_term_frequencies(terms, document) for document in documents]
    lengths = [sum(freqs.values()) or 1 for freqs in tokenized]
    avgdl = sum(lengths) / max(len(lengths), 1)
    raw_scores: list[float] = []
    k1 = 1.4
    b = 0.72
    total_docs = len(hits)

    for freqs, length in zip(tokenized, lengths):
        score = 0.0
        for term in terms:
            term_key = term.lower()
            tf = freqs.get(term_key, 0)
            if tf <= 0:
                continue
            document_frequency = sum(1 for item in tokenized if item.get(term_key, 0) > 0)
            idf = math.log(1 + (total_docs - document_frequency + 0.5) / (document_frequency + 0.5))
            denominator = tf + k1 * (1 - b + b * length / max(avgdl, 1))
            score += idf * (tf * (k1 + 1)) / max(denominator, 0.0001)
        raw_scores.append(score)

    max_score = max(raw_scores) if raw_scores else 0.0
    if max_score <= 0:
        return [0.0 for _ in hits]
    return [round(_clamp_float(score / max_score), 4) for score in raw_scores]


def _document_term_frequencies(terms: list[str], document: str) -> dict[str, int]:
    frequencies: dict[str, int] = {}
    for term in terms:
        term_key = term.lower()
        count = document.count(term_key)
        if count > 0:
            frequencies[term_key] = count
    return frequencies


def _signal_coverage_score(terms: list[str], text: str) -> float:
    if not terms:
        return 0.0
    return _term_coverage_score(terms, text)


def _term_hit_score(term_expansion_hits: list[dict] | None, hit: dict) -> float:
    if not term_expansion_hits:
        return 0.0

    terms: list[str] = []
    for item in term_expansion_hits:
        if not isinstance(item, dict):
            continue
        terms.extend(
            str(value).strip()
            for value in (
                item.get("canonical_term"),
                item.get("matched_text"),
                *(item.get("expansions") if isinstance(item.get("expansions"), list) else []),
            )
            if str(value).strip()
        )
    return _signal_coverage_score(_dedupe_terms(terms), _hit_text(hit, include_content=True))


def _build_retrieval_signals(
    *,
    vector_score: float,
    keyword_score: float,
    bm25_score: float,
    title_score: float,
    section_score: float,
    term_score: float,
    filter_score: float,
    filters: dict | None,
) -> list[dict]:
    meaningful_filters = _meaningful_filters(filters)
    return [
        {
            "name": "vector_recall",
            "score": round(vector_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["vector_recall"],
        },
        {
            "name": "keyword_bm25",
            "score": round(keyword_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["keyword_bm25"],
            "details": {"bm25_score": round(bm25_score, 4)},
        },
        {
            "name": "title_hit",
            "score": round(title_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["title_hit"],
        },
        {
            "name": "section_hit",
            "score": round(section_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["section_hit"],
        },
        {
            "name": "term_hit",
            "score": round(term_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["term_hit"],
        },
        {
            "name": "document_filter_hit",
            "score": round(filter_score if meaningful_filters else 0.0, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["document_filter_hit"],
            "details": {"active_filters": sorted(meaningful_filters)},
        },
    ]
