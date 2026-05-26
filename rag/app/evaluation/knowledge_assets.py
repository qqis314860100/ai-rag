from __future__ import annotations

import re
from typing import Any, Literal, Mapping

from pydantic import BaseModel, Field

from ..schemas.models import AnswerIR, AnswerWarning


AssetDraftStatus = Literal["ready", "blocked"]
KnowledgeAssetType = Literal["knowledge_card", "faq", "relation"]


class KnowledgeAssetDraft(BaseModel):
    schema_version: str = "knowledge-asset-draft/v1"
    asset_type: KnowledgeAssetType
    status: AssetDraftStatus = "blocked"
    title: str = ""
    summary: str = ""
    source_ids: list[str] = Field(default_factory=list)
    related_terms: list[str] = Field(default_factory=list)
    warnings: list[AnswerWarning] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RelatedTopicRecommendation(BaseModel):
    topic: str
    reason: str = ""
    source_ids: list[str] = Field(default_factory=list)
    matched_asset_ids: list[str] = Field(default_factory=list)


def evaluate_knowledge_card_candidate(answer_ir: AnswerIR) -> KnowledgeAssetDraft:
    source_ids = _citation_ids(answer_ir)
    warnings = _blocking_warnings(answer_ir)
    terms = _extract_terms(" ".join([answer_ir.query_rewrite.rewritten_query, answer_ir.answer]))
    status: AssetDraftStatus = "blocked" if warnings else "ready"

    return KnowledgeAssetDraft(
        asset_type="knowledge_card",
        status=status,
        title=_compact_title(answer_ir.query_rewrite.rewritten_query or answer_ir.query_rewrite.original_query),
        summary=_compact_summary(answer_ir.answer),
        source_ids=source_ids,
        related_terms=terms,
        warnings=warnings,
        metadata={
            "confidence": answer_ir.confidence,
            "citation_count": len(source_ids),
            "claim_count": len(answer_ir.claims),
        },
    )


def evaluate_faq_candidate(question: str, answer_ir: AnswerIR, *, similar_question_count: int = 1) -> KnowledgeAssetDraft:
    warnings = _blocking_warnings(answer_ir)
    if similar_question_count < 2:
        warnings.append(AnswerWarning(
            code="faq_frequency_too_low",
            message="问题出现次数不足，先不要沉淀为可复用 FAQ。",
            severity="info",
        ))

    return KnowledgeAssetDraft(
        asset_type="faq",
        status="blocked" if warnings else "ready",
        title=_compact_title(question),
        summary=_compact_summary(answer_ir.answer),
        source_ids=_citation_ids(answer_ir),
        related_terms=_extract_terms(" ".join([question, answer_ir.answer])),
        warnings=warnings,
        metadata={
            "similar_question_count": similar_question_count,
            "confidence": answer_ir.confidence,
        },
    )


def recommend_related_topics(answer_ir: AnswerIR, published_assets: list[Mapping[str, Any]]) -> list[RelatedTopicRecommendation]:
    if _blocking_warnings(answer_ir):
        return []

    query_terms = set(_extract_terms(" ".join([answer_ir.query_rewrite.rewritten_query, answer_ir.answer])))
    recommendations: dict[str, RelatedTopicRecommendation] = {}
    source_ids = _citation_ids(answer_ir)

    for asset in published_assets:
        if str(asset.get("status") or "") != "published":
            continue

        searchable = _asset_search_terms(asset)
        if not query_terms.intersection(searchable):
            continue

        for topic in _as_list(asset.get("related_topics")):
            item = recommendations.setdefault(
                topic,
                RelatedTopicRecommendation(
                    topic=topic,
                    reason="命中已发布知识资产的术语或主题",
                    source_ids=source_ids,
                    matched_asset_ids=[],
                ),
            )
            asset_id = str(asset.get("id") or "")
            if asset_id and asset_id not in item.matched_asset_ids:
                item.matched_asset_ids.append(asset_id)

    return sorted(recommendations.values(), key=lambda item: (item.topic, item.matched_asset_ids))


def build_published_asset_retrieval_terms(asset: Mapping[str, Any]) -> list[str]:
    if str(asset.get("status") or "") != "published":
        return []
    if not _as_list(asset.get("source_ids")) and not _as_list(asset.get("source_refs")):
        return []
    return sorted(_asset_search_terms(asset))


def should_block_knowledge_asset_persistence(answer_ir: AnswerIR) -> bool:
    return bool(_blocking_warnings(answer_ir))


def _blocking_warnings(answer_ir: AnswerIR) -> list[AnswerWarning]:
    warnings: list[AnswerWarning] = []
    if answer_ir.status != "answered":
        warnings.append(AnswerWarning(
            code="answer_not_ready",
            message="回答未达到 answered 状态，不能沉淀为知识资产。",
        ))
    if answer_ir.confidence < 0.65:
        warnings.append(AnswerWarning(
            code="confidence_too_low",
            message="回答置信度低于知识资产沉淀阈值。",
            severity="info",
        ))
    if not answer_ir.citations:
        warnings.append(AnswerWarning(
            code="missing_citations",
            message="缺少引用证据，不能沉淀为可复用知识。",
        ))
    if not answer_ir.claims:
        warnings.append(AnswerWarning(
            code="missing_claims",
            message="缺少可追踪结论，不能生成知识资产草稿。",
        ))

    existing_codes = {warning.code for warning in answer_ir.warnings}
    if {"no_citations", "low_confidence"}.intersection(existing_codes):
        warnings.append(AnswerWarning(
            code="answer_ir_warning_blocked",
            message="AnswerIR 已包含阻断级风险提示。",
        ))

    if _looks_like_uncertain_answer(answer_ir.answer):
        warnings.append(AnswerWarning(
            code="uncertain_answer",
            message="回答包含不确定或无法确认表达，不能沉淀为知识资产。",
        ))

    return _dedupe_warnings(warnings)


def _citation_ids(answer_ir: AnswerIR) -> list[str]:
    return [citation.id for citation in answer_ir.citations if citation.id]


def _asset_search_terms(asset: Mapping[str, Any]) -> set[str]:
    values = [
        str(asset.get("title") or ""),
        str(asset.get("summary") or ""),
        *_as_list(asset.get("aliases")),
        *_as_list(asset.get("related_terms")),
        *_as_list(asset.get("related_topics")),
    ]
    return set(_extract_terms(" ".join(values)))


def _as_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _extract_terms(text: str) -> list[str]:
    candidates = re.findall(r"[A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fff]{2,}", text)
    seen: set[str] = set()
    terms: list[str] = []
    for candidate in candidates:
        normalized = candidate.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        terms.append(candidate)
    return terms[:12]


def _compact_title(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip(" ？?。.")
    return cleaned[:48] or "待审核知识资产"


def _compact_summary(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    return cleaned[:160]


def _looks_like_uncertain_answer(answer: str) -> bool:
    return any(marker in answer for marker in ("无法确认", "不知道", "没有足够信息", "仅供参考", "可能是"))


def _dedupe_warnings(warnings: list[AnswerWarning]) -> list[AnswerWarning]:
    seen: set[str] = set()
    result: list[AnswerWarning] = []
    for warning in warnings:
        if warning.code in seen:
            continue
        seen.add(warning.code)
        result.append(warning)
    return result
