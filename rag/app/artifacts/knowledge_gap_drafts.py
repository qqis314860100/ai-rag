from __future__ import annotations

import hashlib
import re
from collections import Counter, defaultdict
from collections.abc import Iterable
from typing import Any

from pydantic import BaseModel, Field

_STOP_TERMS = {
    "怎么",
    "如何",
    "什么",
    "为什么",
    "是否",
    "需要",
    "处理",
    "排查",
    "异常",
    "标准",
    "流程",
    "问题",
    "当前",
    "知识库",
    "无法",
    "回答",
    "确认",
}

_EVENT_SEVERITY_WEIGHT = {
    "negative_feedback": 3,
    "follow_up_correction": 3,
    "refusal": 2,
    "low_confidence": 2,
    "user_retry": 1,
}


class FailedQuestionSignal(BaseModel):
    id: str = ""
    question: str
    event_type: str = "refusal"
    confidence: float | None = None
    feedback_reason: str = ""
    feedback_comment: str = ""
    answer_snapshot: str = ""
    query_understanding: list[dict[str, Any]] = Field(default_factory=list)
    retrieval_evidence: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str = ""


class KnowledgeGapClusterRequest(BaseModel):
    failed_questions: list[FailedQuestionSignal] = Field(default_factory=list)
    manual_notes: list[dict[str, Any]] = Field(default_factory=list)
    high_confidence_answers: list[dict[str, Any]] = Field(default_factory=list)
    min_frequency: int = Field(default=2, ge=1, le=20)
    max_clusters: int = Field(default=20, ge=1, le=100)


class DraftCandidate(BaseModel):
    title: str
    summary: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    source_failed_question_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TermCandidate(DraftCandidate):
    canonical_term: str
    aliases: list[str] = Field(default_factory=list)
    retrieval_terms: list[str] = Field(default_factory=list)


class AliasCandidate(DraftCandidate):
    canonical_term: str
    alias: str
    reason: str = ""


class FaqDraftCandidate(DraftCandidate):
    question: str
    answer_outline: str = ""
    tags: list[str] = Field(default_factory=list)


class KnowledgeCardDraftCandidate(DraftCandidate):
    topic: str
    related_terms: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)


class DocumentSupplementSuggestion(DraftCandidate):
    target_topic: str
    suggested_sections: list[str] = Field(default_factory=list)
    evidence_gaps: list[str] = Field(default_factory=list)


class KnowledgeGapClusterDraft(BaseModel):
    cluster_id: str
    title: str
    representative_question: str
    normalized_key: str
    gap_type: str
    severity: str
    frequency_count: int
    sample_failed_question_ids: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    event_types: list[str] = Field(default_factory=list)
    related_terms: list[str] = Field(default_factory=list)
    retrieval_evidence: list[dict[str, Any]] = Field(default_factory=list)
    term_candidates: list[TermCandidate] = Field(default_factory=list)
    alias_candidates: list[AliasCandidate] = Field(default_factory=list)
    faq_drafts: list[FaqDraftCandidate] = Field(default_factory=list)
    knowledge_card_drafts: list[KnowledgeCardDraftCandidate] = Field(default_factory=list)
    document_supplement_suggestions: list[DocumentSupplementSuggestion] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class KnowledgeGapClusterResult(BaseModel):
    schema_version: str = "knowledge-gap-cluster/v1"
    clusters: list[KnowledgeGapClusterDraft] = Field(default_factory=list)
    ignored_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


def build_knowledge_gap_cluster_drafts(request: KnowledgeGapClusterRequest) -> KnowledgeGapClusterResult:
    buckets: dict[str, list[FailedQuestionSignal]] = defaultdict(list)
    ignored = 0
    context_signals = [
        *_signals_from_context(request.manual_notes, "manual_note"),
        *_signals_from_context(request.high_confidence_answers, "high_confidence_answer"),
    ]
    for signal in request.failed_questions:
        if not signal.question.strip():
            ignored += 1
            continue
        buckets[_cluster_key(signal)].append(signal)
    for signal in context_signals:
        if not signal.question.strip():
            ignored += 1
            continue
        matched_key = _matching_bucket_key(signal, buckets)
        buckets[matched_key or _cluster_key(signal)].append(signal)

    clusters: list[KnowledgeGapClusterDraft] = []
    for key, signals in buckets.items():
        if len(signals) < request.min_frequency:
            ignored += len(signals)
            continue
        clusters.append(_build_cluster(key, signals))

    clusters.sort(key=lambda item: (-item.frequency_count, _severity_rank(item.severity), item.title))
    limited = clusters[: request.max_clusters]
    ignored += max(0, len(clusters) - len(limited))
    return KnowledgeGapClusterResult(
        clusters=limited,
        ignored_count=ignored,
        metadata={
            "input_count": len(request.failed_questions) + len(context_signals),
            "failed_question_count": len(request.failed_questions),
            "manual_note_count": len(request.manual_notes),
            "high_confidence_answer_count": len(request.high_confidence_answers),
            "min_frequency": request.min_frequency,
            "max_clusters": request.max_clusters,
            "algorithm": "term-intent-bucket/v1",
        },
    )


def _signals_from_context(items: list[dict[str, Any]], event_type: str) -> list[FailedQuestionSignal]:
    signals: list[FailedQuestionSignal] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or item.get("content") or item.get("answer") or "").strip()
        if not question:
            continue
        signals.append(FailedQuestionSignal(
            id=str(item.get("id") or f"{event_type}-{index}"),
            question=question,
            event_type=event_type,
            confidence=_float_or_none(item.get("confidence")),
            feedback_comment=str(item.get("comment") or item.get("summary") or ""),
            answer_snapshot=str(item.get("answer") or ""),
            query_understanding=_as_dict_list(item.get("query_understanding")),
            retrieval_evidence=_as_dict_list(item.get("retrieval_evidence")),
            metadata={"source": event_type, **{k: v for k, v in item.items() if k not in {"question", "content", "answer"}}},
        ))
    return signals


def _matching_bucket_key(signal: FailedQuestionSignal, buckets: dict[str, list[FailedQuestionSignal]]) -> str:
    signal_terms = {term.lower() for term in _terms_from_signal(signal)}
    if not signal_terms:
        return ""
    for key, bucket_signals in buckets.items():
        bucket_terms = {term.lower() for item in bucket_signals for term in _terms_from_signal(item)}
        if signal_terms.intersection(bucket_terms):
            return key
    return ""


def _build_cluster(key: str, signals: list[FailedQuestionSignal]) -> KnowledgeGapClusterDraft:
    question_counter = Counter(_clean_question(signal.question) for signal in signals)
    representative = question_counter.most_common(1)[0][0]
    ids = [signal.id for signal in signals if signal.id]
    event_types = sorted({signal.event_type for signal in signals if signal.event_type})
    terms = _top_terms(signals)
    evidence = _merge_retrieval_evidence(signals)
    severity = _severity(signals)
    gap_type = event_types[0] if len(event_types) == 1 else "mixed"
    title = _cluster_title(representative, terms)
    confidence = min(0.95, 0.45 + len(signals) * 0.08 + min(len(evidence), 3) * 0.05)

    return KnowledgeGapClusterDraft(
        cluster_id=_stable_id(key, ids),
        title=title,
        representative_question=representative,
        normalized_key=key,
        gap_type=gap_type,
        severity=severity,
        frequency_count=len(signals),
        sample_failed_question_ids=ids[:20],
        questions=list(question_counter.keys())[:12],
        event_types=event_types,
        related_terms=terms,
        retrieval_evidence=evidence,
        term_candidates=_term_candidates(terms, signals, confidence),
        alias_candidates=_alias_candidates(signals, terms, confidence),
        faq_drafts=[_faq_draft(title, representative, terms, ids, confidence)],
        knowledge_card_drafts=[_knowledge_card_draft(title, terms, ids, evidence, confidence)],
        document_supplement_suggestions=[_document_suggestion(title, terms, ids, evidence, confidence)],
        metadata={
            "event_type_counts": dict(Counter(signal.event_type for signal in signals)),
            "source": "failed_question_cluster",
            "requires_human_review": True,
        },
    )


def _cluster_key(signal: FailedQuestionSignal) -> str:
    terms = _candidate_terms_from_understanding(signal) or _terms_from_signal(signal)
    intent = _intent_from_question(signal.question)
    if terms:
        return terms[0].lower()
    return "|".join([intent, _normalize_question(signal.question)[:32]]).lower()


def _candidate_terms_from_understanding(signal: FailedQuestionSignal) -> list[str]:
    values: list[str] = []
    for understanding in signal.query_understanding:
        for candidate in _as_list(understanding.get("candidate_terms")):
            if isinstance(candidate, dict):
                values.append(str(candidate.get("term") or candidate.get("matched_text") or ""))
        values.extend(_as_string_list(understanding.get("terms")))
    return _dedupe([value for value in values if value])[:6]


def _terms_from_signal(signal: FailedQuestionSignal) -> list[str]:
    values: list[str] = []
    for understanding in signal.query_understanding:
        for candidate in _as_list(understanding.get("candidate_terms")):
            if isinstance(candidate, dict):
                values.append(str(candidate.get("term") or candidate.get("matched_text") or ""))
        values.extend(_as_string_list(understanding.get("terms")))
        for key in ("rewritten_query", "raw_query", "intent"):
            values.append(str(understanding.get(key) or ""))
    values.append(signal.question)
    values.append(signal.feedback_reason)
    values.append(signal.feedback_comment)
    return _extract_terms(" ".join(values), limit=10)


def _top_terms(signals: Iterable[FailedQuestionSignal]) -> list[str]:
    weighted: Counter[str] = Counter()
    original: dict[str, str] = {}
    for signal in signals:
        for term in _terms_from_signal(signal):
            normalized = term.lower()
            original.setdefault(normalized, term)
            acronym_boost = 12 if re.fullmatch(r"[A-Z][A-Z0-9_-]{1,}", term) else 0
            weighted[normalized] += max(len(term), 2) + acronym_boost
    return [original[key] for key, _ in weighted.most_common(8)]


def _term_candidates(terms: list[str], signals: list[FailedQuestionSignal], confidence: float) -> list[TermCandidate]:
    ids = [signal.id for signal in signals if signal.id]
    result: list[TermCandidate] = []
    for term in terms[:4]:
        aliases = _aliases_for_term(term, signals)
        result.append(TermCandidate(
            title=f"{term} 术语候选",
            canonical_term=term,
            aliases=aliases,
            retrieval_terms=_dedupe([term, *aliases, *_question_fragments(signals)]),
            summary="失败问题中重复出现但未稳定命中的产线术语候选，需要审核定义、适用范围和证据来源。",
            confidence=confidence,
            source_failed_question_ids=ids[:12],
            metadata={"source": "failed_question_cluster"},
        ))
    return result


def _alias_candidates(signals: list[FailedQuestionSignal], terms: list[str], confidence: float) -> list[AliasCandidate]:
    ids = [signal.id for signal in signals if signal.id]
    candidates: list[AliasCandidate] = []
    for term in terms[:4]:
        for alias in _aliases_for_term(term, signals)[:3]:
            if alias.lower() == term.lower():
                continue
            candidates.append(AliasCandidate(
                title=f"{alias} -> {term}",
                canonical_term=term,
                alias=alias,
                reason="同一失败问题簇中与主术语共同出现，可作为别名候选进入人工审核。",
                confidence=max(0.35, confidence - 0.1),
                source_failed_question_ids=ids[:12],
            ))
    return candidates[:8]


def _faq_draft(title: str, question: str, terms: list[str], ids: list[str], confidence: float) -> FaqDraftCandidate:
    return FaqDraftCandidate(
        title=f"{title} FAQ 草稿",
        question=question,
        answer_outline="待知识管理员补充标准答案、适用范围、例外条件和引用证据。",
        tags=terms[:6],
        summary="由高频失败问题聚类生成，发布前必须补齐可追溯答案和引用。",
        confidence=confidence,
        source_failed_question_ids=ids[:12],
        metadata={"status": "draft_suggestion", "requires_evidence": True},
    )


def _knowledge_card_draft(
    title: str,
    terms: list[str],
    ids: list[str],
    evidence: list[dict[str, Any]],
    confidence: float,
) -> KnowledgeCardDraftCandidate:
    missing = ["标准答案", "适用场景", "异常处置步骤"]
    if not evidence:
        missing.append("引用证据")
    return KnowledgeCardDraftCandidate(
        title=f"{title} 知识卡草稿",
        topic=title,
        related_terms=terms[:8],
        missing_evidence=missing,
        summary="由失败问题闭环生成的知识卡草稿，只能作为待审核知识补齐入口。",
        confidence=confidence,
        source_failed_question_ids=ids[:12],
        metadata={"status": "draft_suggestion", "source_evidence_count": len(evidence)},
    )


def _document_suggestion(
    title: str,
    terms: list[str],
    ids: list[str],
    evidence: list[dict[str, Any]],
    confidence: float,
) -> DocumentSupplementSuggestion:
    sections = _dedupe([
        f"{title} 标准说明",
        f"{title} 异常判定",
        f"{title} 处理流程",
        f"{title} 适用范围",
    ])
    gaps = ["补充可引用 SOP/工艺规范原文", "补充异常案例和边界条件"]
    if not evidence:
        gaps.insert(0, "当前失败问题缺少可复用检索证据")
    return DocumentSupplementSuggestion(
        title=f"{title} 文档补充建议",
        target_topic=title,
        suggested_sections=sections,
        evidence_gaps=gaps,
        summary="面向文档治理的补充建议，优先补齐被频繁拒答或低置信的问题。",
        confidence=confidence,
        source_failed_question_ids=ids[:12],
        metadata={"related_terms": terms[:8], "retrieval_evidence_count": len(evidence)},
    )


def _aliases_for_term(term: str, signals: Iterable[FailedQuestionSignal]) -> list[str]:
    aliases: list[str] = []
    normalized = term.lower()
    for signal in signals:
        for candidate in _terms_from_signal(signal):
            if candidate.lower() != normalized:
                aliases.append(candidate)
    return _dedupe(aliases)[:6]


def _merge_retrieval_evidence(signals: Iterable[FailedQuestionSignal]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for signal in signals:
        for item in signal.retrieval_evidence:
            if not isinstance(item, dict):
                continue
            key = str(item.get("chunk_id") or item.get("source_id") or item.get("document_id") or item.get("title") or "")
            if not key:
                continue
            by_key.setdefault(key, {
                "document_id": item.get("document_id", ""),
                "chunk_id": item.get("chunk_id", item.get("source_id", "")),
                "title": item.get("title", item.get("document_title", "")),
                "section_path": item.get("section_path", ""),
                "snippet": str(item.get("snippet") or "")[:240],
                "score": item.get("score", 0),
                "retrieval_type": item.get("retrieval_type", "semantic_candidate"),
            })
    return list(by_key.values())[:12]


def _severity(signals: Iterable[FailedQuestionSignal]) -> str:
    signal_list = list(signals)
    frequency = len(signal_list)
    event_weight = sum(_EVENT_SEVERITY_WEIGHT.get(signal.event_type, 1) for signal in signal_list)
    low_confidence_count = sum(1 for signal in signal_list if signal.confidence is not None and signal.confidence < 0.45)
    score = frequency + event_weight + low_confidence_count
    if score >= 18:
        return "critical"
    if score >= 10:
        return "high"
    if score >= 5:
        return "medium"
    return "low"


def _severity_rank(severity: str) -> int:
    return {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(severity, 4)


def _intent_from_question(question: str) -> str:
    if any(marker in question for marker in ("怎么", "如何", "处理", "排查")):
        return "how_to"
    if any(marker in question for marker in ("标准", "阈值", "多少", "范围")):
        return "standard"
    if any(marker in question for marker in ("为什么", "原因")):
        return "reason"
    return "general"


def _cluster_title(question: str, terms: list[str]) -> str:
    if terms:
        return f"{terms[0]}相关失败问题"
    return _clean_question(question)[:36] or "未归类失败问题"


def _question_fragments(signals: Iterable[FailedQuestionSignal]) -> list[str]:
    fragments: list[str] = []
    for signal in signals:
        fragments.extend(_extract_terms(signal.question, limit=4))
    return fragments[:12]


def _extract_terms(text: str, limit: int = 12) -> list[str]:
    candidates = re.findall(r"[A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fff]{2,}", text)
    terms: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        cleaned = candidate.strip()
        normalized = cleaned.lower()
        if not cleaned or normalized in seen or cleaned in _STOP_TERMS:
            continue
        if len(cleaned) > 6 and any(marker in cleaned for marker in _STOP_TERMS):
            continue
        if len(cleaned) > 18 and re.fullmatch(r"[\u4e00-\u9fff]+", cleaned):
            cleaned = cleaned[:18]
            normalized = cleaned.lower()
        seen.add(normalized)
        terms.append(cleaned)
        if len(terms) >= limit:
            break
    return terms


def _clean_question(question: str) -> str:
    return re.sub(r"\s+", " ", question).strip(" ？?。.!！")


def _normalize_question(question: str) -> str:
    return re.sub(r"[\s？?。.!！,，;；:：]+", "", question).lower()


def _stable_id(key: str, ids: list[str]) -> str:
    source = "|".join([key, *sorted(ids)])
    return "kgc_" + hashlib.sha1(source.encode("utf-8")).hexdigest()[:16]


def _dedupe(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = str(value).strip()
        normalized = cleaned.lower()
        if not cleaned or normalized in seen:
            continue
        seen.add(normalized)
        result.append(cleaned)
    return result


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _as_dict_list(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _as_string_list(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _float_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
