from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from collections.abc import Mapping
from typing import Any

from ...schemas.models import AnswerIR, AnswerWarning
from .retrieve_signals import context_conflict_candidates as _context_conflict_candidates

ANSWER_VERIFICATION_SCHEMA = "answer-verification/v1"
SUPPORT_SCORE_THRESHOLD = 0.18
PARTIAL_VERIFICATION_CONFIDENCE_CAP = 0.59
DEPRECATED_SOURCE_STATUSES = {
    "deprecated",
    "expired",
    "inactive",
    "archived",
    "deleted",
    "superseded",
    "obsolete",
    "过期",
    "废弃",
    "归档",
    "停用",
    "已删除",
}
MISSING_EVIDENCE_PATTERN = re.compile(r"(知识库|资料|上下文|引用).{0,12}(未提供|没有提供|无法确认|不能确认|不足)")
TOKEN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_-]*|\d+(?:\.\d+)?%?|[\u4e00-\u9fff]{2,}")
NUMBER_PATTERN = re.compile(r"\d+(?:\.\d+)?\s*(?:V|A|Ω|MΩ|kΩ|mΩ|℃|°C|%|mm|cm|m|s|min|h|次|pcs|kg)?", re.IGNORECASE)
SOURCE_STOPWORDS = {
    "来源",
    "引用",
    "文档",
    "章节",
    "结论",
    "参数",
    "步骤",
    "流程",
    "风险",
    "限制",
    "注意",
    "需要",
    "必须",
    "可以",
    "应当",
    "应该",
    "进行",
    "确认",
    "知识库",
    "提供",
    "未提供",
}


def verify_answer_ir(
    answer_ir: AnswerIR,
    *,
    sources: list[Mapping[str, Any]],
    hits: list[dict] | None = None,
) -> AnswerIR:
    """核验回答 claim 与引用证据的一致性，并把结果附加到 AnswerIR。

    核验失败不能只停留在 warning：全量 claim 不受支撑时降级为 insufficient_context，
    局部失败、来源过期/废弃、版本冲突或候选矛盾时降级为 partial。
    """

    citation_evidence = _citation_evidence_by_id(answer_ir, sources)
    claim_results = [
        _verify_claim_support(claim.model_dump(), citation_evidence)
        for claim in answer_ir.claims
    ]
    unsupported_claims = [
        result for result in claim_results
        if not result["supported"] and not result["skipped"]
    ]
    deprecated_sources = _deprecated_sources(answer_ir, sources)
    expired_sources = _expired_sources(answer_ir, sources)
    version_conflicts = _version_conflicts(answer_ir, sources)
    conflict_candidates = _context_conflict_candidates(
        answer_ir.query_rewrite.original_query or answer_ir.query_rewrite.rewritten_query,
        hits or [dict(source) for source in sources],
    )

    supported_count = sum(1 for result in claim_results if result["supported"] or result["skipped"])
    claim_count = len(claim_results)
    claim_coverage_ratio = round(supported_count / claim_count, 4) if claim_count else 1.0
    verification = {
        "schema_version": ANSWER_VERIFICATION_SCHEMA,
        "claim_count": claim_count,
        "supported_claim_count": supported_count,
        "claim_coverage_ratio": claim_coverage_ratio,
        "unsupported_claims": unsupported_claims,
        "deprecated_sources": deprecated_sources,
        "expired_sources": expired_sources,
        "version_conflicts": version_conflicts,
        "contradictory_evidence": _compact_conflict_candidates(conflict_candidates),
    }

    warnings = _merge_warnings(
        answer_ir.warnings,
        _verification_warnings(
            unsupported_claims=unsupported_claims,
            deprecated_sources=deprecated_sources,
            expired_sources=expired_sources,
            version_conflicts=version_conflicts,
            conflict_candidates=conflict_candidates,
        ),
    )
    downgrade = _verification_downgrade(
        answer_ir=answer_ir,
        unsupported_claims=unsupported_claims,
        deprecated_sources=deprecated_sources,
        expired_sources=expired_sources,
        version_conflicts=version_conflicts,
        conflict_candidates=conflict_candidates,
        claim_count=claim_count,
        claim_coverage_ratio=claim_coverage_ratio,
    )
    verification["decision"] = downgrade
    if downgrade["downgraded"]:
        warnings = _merge_warnings(warnings, [_downgrade_warning(downgrade, warnings)])

    metadata = {
        **answer_ir.metadata,
        "answer_verification": verification,
        "claim_coverage_ratio": claim_coverage_ratio,
        "verification_decision": downgrade,
    }
    return answer_ir.model_copy(update={
        "status": downgrade["status"],
        "confidence": downgrade["confidence"],
        "warnings": warnings,
        "metadata": metadata,
    })


def _verification_downgrade(
    *,
    answer_ir: AnswerIR,
    unsupported_claims: list[dict[str, Any]],
    deprecated_sources: list[dict[str, str]],
    expired_sources: list[dict[str, str]],
    version_conflicts: list[dict[str, Any]],
    conflict_candidates: list[dict],
    claim_count: int,
    claim_coverage_ratio: float,
) -> dict[str, Any]:
    if answer_ir.status in ("insufficient_context", "error"):
        return {
            "downgraded": False,
            "previous_status": answer_ir.status,
            "status": answer_ir.status,
            "reason": "",
            "confidence": answer_ir.confidence,
            "confidence_cap": None,
        }

    reason = ""
    status = answer_ir.status
    confidence_cap: float | None = None
    if claim_count and unsupported_claims and claim_coverage_ratio <= 0:
        status = "insufficient_context"
        reason = "unsupported_claims"
        confidence_cap = 0.0
    elif unsupported_claims:
        status = "partial"
        reason = "partial_unsupported_claims"
        confidence_cap = PARTIAL_VERIFICATION_CONFIDENCE_CAP
    elif expired_sources or deprecated_sources:
        status = "partial"
        reason = "stale_sources"
        confidence_cap = PARTIAL_VERIFICATION_CONFIDENCE_CAP
    elif version_conflicts:
        status = "partial"
        reason = "version_conflict"
        confidence_cap = PARTIAL_VERIFICATION_CONFIDENCE_CAP
    elif conflict_candidates:
        status = "partial"
        reason = "contradictory_evidence"
        confidence_cap = PARTIAL_VERIFICATION_CONFIDENCE_CAP

    if not reason:
        return {
            "downgraded": False,
            "previous_status": answer_ir.status,
            "status": answer_ir.status,
            "reason": "",
            "confidence": answer_ir.confidence,
            "confidence_cap": None,
        }

    confidence = answer_ir.confidence if confidence_cap is None else min(answer_ir.confidence, confidence_cap)
    return {
        "downgraded": status != answer_ir.status or confidence != answer_ir.confidence,
        "previous_status": answer_ir.status,
        "status": status,
        "reason": reason,
        "confidence": round(confidence, 4),
        "confidence_cap": confidence_cap,
    }


def _downgrade_warning(downgrade: dict[str, Any], warnings: list[AnswerWarning]) -> AnswerWarning:
    citation_ids = _unique_ids(citation_id for warning in warnings for citation_id in warning.citation_ids)
    if downgrade["status"] == "insufficient_context":
        return AnswerWarning(
            code="verification_downgraded",
            message="回答核验未通过，已降级为证据不足状态，不能作为可追溯结论。",
            citation_ids=citation_ids,
        )
    return AnswerWarning(
        code="verification_downgraded",
        message="回答核验存在风险，已降级为部分回答，需要结合引用人工复核。",
        severity="info",
        citation_ids=citation_ids,
    )


def _verify_claim_support(claim: dict[str, Any], citation_evidence: dict[str, str]) -> dict[str, Any]:
    citation_ids = [str(item) for item in claim.get("citation_ids", []) if str(item)]
    text = str(claim.get("text") or "")
    if _is_missing_evidence_claim(text):
        return {
            "claim_id": str(claim.get("id") or ""),
            "kind": str(claim.get("kind") or ""),
            "citation_ids": citation_ids,
            "supported": True,
            "skipped": True,
            "support_score": 1.0,
            "reason": "missing_evidence_statement",
        }
    if not citation_ids:
        return {
            "claim_id": str(claim.get("id") or ""),
            "kind": str(claim.get("kind") or ""),
            "text": text[:160],
            "citation_ids": [],
            "supported": False,
            "skipped": False,
            "support_score": 0.0,
            "reason": "no_claim_citations",
        }

    scored = [
        (citation_id, _support_score(text, citation_evidence.get(citation_id, "")))
        for citation_id in citation_ids
    ]
    best_citation_id, best_score = max(scored, key=lambda item: item[1], default=("", 0.0))
    supported = best_score >= SUPPORT_SCORE_THRESHOLD
    return {
        "claim_id": str(claim.get("id") or ""),
        "kind": str(claim.get("kind") or ""),
        "text": text[:160],
        "citation_ids": citation_ids,
        "best_citation_id": best_citation_id,
        "supported": supported,
        "skipped": False,
        "support_score": round(best_score, 4),
        "reason": "supported_by_citation" if supported else "weak_token_overlap",
    }


def _support_score(claim_text: str, evidence_text: str) -> float:
    claim_tokens = _semantic_tokens(claim_text)
    evidence_tokens = _semantic_tokens(evidence_text)
    if not claim_tokens or not evidence_tokens:
        return 0.0

    shared_tokens = claim_tokens & evidence_tokens
    token_score = len(shared_tokens) / max(len(claim_tokens), 1)
    claim_numbers = _numbers(claim_text)
    evidence_numbers = _numbers(evidence_text)
    if claim_numbers and not claim_numbers <= evidence_numbers:
        token_score = min(token_score * 0.35, SUPPORT_SCORE_THRESHOLD - 0.01)
    elif claim_numbers:
        token_score += 0.12
    return min(token_score, 1.0)


def _citation_evidence_by_id(answer_ir: AnswerIR, sources: list[Mapping[str, Any]]) -> dict[str, str]:
    evidence: dict[str, str] = {}
    for citation in answer_ir.citations:
        evidence[citation.id] = " ".join([
            citation.snippet,
            citation.document_title,
            citation.section_path,
        ])

    for index, source in enumerate(sources, 1):
        source_id = _source_id(source, index)
        source_context = source.get("source_context") if isinstance(source.get("source_context"), Mapping) else {}
        metadata = source.get("metadata") if isinstance(source.get("metadata"), Mapping) else {}
        parts = [
            source.get("content"),
            source.get("context_window"),
            source_context.get("window"),
            source_context.get("content"),
            source.get("snippet"),
            source_context.get("snippet"),
            source.get("document_title"),
            source.get("section_path"),
            metadata.get("document_title"),
            metadata.get("section_path"),
        ]
        text = " ".join(str(part) for part in parts if part)
        if text:
            evidence[source_id] = text
    return evidence


def _deprecated_sources(answer_ir: AnswerIR, sources: list[Mapping[str, Any]]) -> list[dict[str, str]]:
    deprecated: list[dict[str, str]] = []
    for index, source in enumerate(sources, 1):
        status = _source_status(source).lower()
        if status and status in DEPRECATED_SOURCE_STATUSES:
            deprecated.append({
                "citation_id": _source_id(source, index),
                "document_id": _source_document_id(source),
                "document_title": _source_document_title(source),
                "status": status,
            })

    citation_ids = {citation.id for citation in answer_ir.citations}
    return [item for item in deprecated if item["citation_id"] in citation_ids]


def _expired_sources(answer_ir: AnswerIR, sources: list[Mapping[str, Any]]) -> list[dict[str, str]]:
    expired: list[dict[str, str]] = []
    today = dt.date.today()
    for index, source in enumerate(sources, 1):
        expiry = _source_expiry(source)
        if expiry and expiry < today:
            expired.append({
                "citation_id": _source_id(source, index),
                "document_id": _source_document_id(source),
                "document_title": _source_document_title(source),
                "expired_at": expiry.isoformat(),
            })

    citation_ids = {citation.id for citation in answer_ir.citations}
    return [item for item in expired if item["citation_id"] in citation_ids]


def _version_conflicts(answer_ir: AnswerIR, sources: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {"versions": defaultdict(list), "document_title": ""})
    for index, source in enumerate(sources, 1):
        version = _source_version(source)
        if not version:
            continue
        document_key = _source_document_id(source) or _source_document_title(source)
        if not document_key:
            continue
        group = grouped[document_key]
        group["document_title"] = group["document_title"] or _source_document_title(source)
        group["versions"][version].append(_source_id(source, index))

    citation_ids = {citation.id for citation in answer_ir.citations}
    conflicts: list[dict[str, Any]] = []
    for document_key, group in grouped.items():
        versions = {
            version: [citation_id for citation_id in citation_ids_for_version if citation_id in citation_ids]
            for version, citation_ids_for_version in group["versions"].items()
        }
        versions = {version: ids for version, ids in versions.items() if ids}
        if len(versions) > 1:
            conflicts.append({
                "document_key": document_key,
                "document_title": group["document_title"],
                "versions": versions,
            })
    return conflicts


def _verification_warnings(
    *,
    unsupported_claims: list[dict[str, Any]],
    deprecated_sources: list[dict[str, str]],
    expired_sources: list[dict[str, str]],
    version_conflicts: list[dict[str, Any]],
    conflict_candidates: list[dict],
) -> list[AnswerWarning]:
    warnings: list[AnswerWarning] = []
    if unsupported_claims:
        warnings.append(AnswerWarning(
            code="unsupported_claims",
            message=f"核验发现 {len(unsupported_claims)} 条 claim 与绑定引用支撑不足，需要人工复核。",
            citation_ids=_unique_ids(cid for claim in unsupported_claims for cid in claim.get("citation_ids", [])),
        ))
    if deprecated_sources:
        warnings.append(AnswerWarning(
            code="deprecated_sources",
            message="回答引用包含已废弃、归档或停用来源。",
            citation_ids=_unique_ids(item["citation_id"] for item in deprecated_sources),
        ))
    if expired_sources:
        warnings.append(AnswerWarning(
            code="expired_sources",
            message="回答引用包含已过期来源。",
            citation_ids=_unique_ids(item["citation_id"] for item in expired_sources),
        ))
    if version_conflicts:
        warnings.append(AnswerWarning(
            code="version_conflict",
            message="回答引用包含同一文档的多个版本，需要确认当前受控版本。",
            citation_ids=_unique_ids(cid for conflict in version_conflicts for ids in conflict["versions"].values() for cid in ids),
        ))
    if conflict_candidates:
        warnings.append(AnswerWarning(
            code="contradictory_evidence",
            message="核验发现引用证据之间存在互相矛盾的候选表述。",
            citation_ids=_unique_ids(
                claim.get("chunk_id", "")
                for candidate in conflict_candidates
                for claim in (candidate.get("positive", {}), candidate.get("negative", {}))
            ),
        ))
    return warnings


def _merge_warnings(existing: list[AnswerWarning], additions: list[AnswerWarning]) -> list[AnswerWarning]:
    result = list(existing)
    existing_codes = {warning.code for warning in existing}
    for warning in additions:
        if warning.code == "contradictory_evidence" and {"context_conflict", "contradictory_evidence"} & existing_codes:
            continue
        if warning.code in existing_codes:
            continue
        result.append(warning)
        existing_codes.add(warning.code)
    return result


def _compact_conflict_candidates(candidates: list[dict]) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    for candidate in candidates:
        positive = candidate.get("positive") if isinstance(candidate.get("positive"), Mapping) else {}
        negative = candidate.get("negative") if isinstance(candidate.get("negative"), Mapping) else {}
        compacted.append({
            "positive": {
                "text": str(positive.get("text") or "")[:160],
                "citation_id": str(positive.get("chunk_id") or ""),
            },
            "negative": {
                "text": str(negative.get("text") or "")[:160],
                "citation_id": str(negative.get("chunk_id") or ""),
            },
            "confidence": str(candidate.get("confidence") or "candidate"),
        })
    return compacted


def _semantic_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for token in TOKEN_PATTERN.findall(text.lower()):
        normalized = token.strip()
        if not normalized or normalized in SOURCE_STOPWORDS:
            continue
        if re.fullmatch(r"[\u4e00-\u9fff]+", normalized):
            for size in (4, 3, 2):
                if len(normalized) >= size:
                    tokens.update(
                        normalized[index:index + size]
                        for index in range(len(normalized) - size + 1)
                        if normalized[index:index + size] not in SOURCE_STOPWORDS
                    )
        else:
            tokens.add(normalized)
    return tokens


def _numbers(text: str) -> set[str]:
    return {re.sub(r"\s+", "", item.lower()) for item in NUMBER_PATTERN.findall(text)}


def _is_missing_evidence_claim(text: str) -> bool:
    return bool(MISSING_EVIDENCE_PATTERN.search(text))


def _source_id(source: Mapping[str, Any], index: int) -> str:
    return str(source.get("id") or source.get("chunk_id") or f"source-{index}")


def _source_document_id(source: Mapping[str, Any]) -> str:
    metadata = source.get("metadata") if isinstance(source.get("metadata"), Mapping) else {}
    document = source.get("document") if isinstance(source.get("document"), Mapping) else {}
    return str(source.get("document_id") or document.get("id") or metadata.get("document_id") or "")


def _source_document_title(source: Mapping[str, Any]) -> str:
    metadata = source.get("metadata") if isinstance(source.get("metadata"), Mapping) else {}
    document = source.get("document") if isinstance(source.get("document"), Mapping) else {}
    return str(source.get("document_title") or document.get("title") or metadata.get("document_title") or "")


def _source_status(source: Mapping[str, Any]) -> str:
    metadata = source.get("metadata") if isinstance(source.get("metadata"), Mapping) else {}
    document = source.get("document") if isinstance(source.get("document"), Mapping) else {}
    source_metadata = source.get("source_metadata") if isinstance(source.get("source_metadata"), Mapping) else {}
    source_metadata_document = source_metadata.get("document") if isinstance(source_metadata.get("document"), Mapping) else {}
    return str(
        source.get("status")
        or document.get("status")
        or metadata.get("status")
        or source_metadata_document.get("status")
        or ""
    )


def _source_version(source: Mapping[str, Any]) -> str:
    metadata = source.get("metadata") if isinstance(source.get("metadata"), Mapping) else {}
    document = source.get("document") if isinstance(source.get("document"), Mapping) else {}
    source_metadata = source.get("source_metadata") if isinstance(source.get("source_metadata"), Mapping) else {}
    source_metadata_document = source_metadata.get("document") if isinstance(source_metadata.get("document"), Mapping) else {}
    return str(
        source.get("version")
        or document.get("version")
        or metadata.get("version")
        or source_metadata_document.get("version")
        or ""
    ).strip()


def _source_expiry(source: Mapping[str, Any]) -> dt.date | None:
    metadata = source.get("metadata") if isinstance(source.get("metadata"), Mapping) else {}
    document = source.get("document") if isinstance(source.get("document"), Mapping) else {}
    for key in ("valid_until", "expires_at", "expired_at", "effective_until", "deprecated_at"):
        parsed = _parse_date(source.get(key) or document.get(key) or metadata.get(key))
        if parsed:
            return parsed
    return None


def _parse_date(value: Any) -> dt.date | None:
    if not value:
        return None
    text = str(value).strip()
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    for pattern in ("%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return dt.datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def _unique_ids(values: Any) -> list[str]:
    result: list[str] = []
    for value in values:
        item = str(value or "")
        if item and item not in result:
            result.append(item)
    return result
