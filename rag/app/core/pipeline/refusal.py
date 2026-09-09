from dataclasses import dataclass, field

from ...schemas.models import AnswerQueryRewrite, AnswerWarning
from .retrieve_signals import context_conflict_candidates as _context_conflict_candidates
from .rewrite import _dedupe_preserve_order, _knowledge_asset_trace

REFUSAL_ANSWER = "根据当前知识库信息，我暂时无法确认该问题。"
MIN_ANSWER_CONFIDENCE = 0.5


@dataclass
class EvidenceAssessment:
    should_refuse: bool = False
    reasons: list[str] = field(default_factory=list)
    warnings: list[AnswerWarning] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


def _assess_insufficient_context(
    *,
    query: str,
    query_rewrite: AnswerQueryRewrite,
    hits: list[dict],
    sources: list[dict],
    confidence: float,
    knowledge_assets: list[dict] | None = None,
) -> EvidenceAssessment:
    reasons: list[str] = []
    warnings: list[AnswerWarning] = []

    if query_rewrite.strategy == "low_information":
        reasons.append("low_information")
        warnings.append(AnswerWarning(
            code="low_information",
            message="用户问题信息量过低，且没有可用于补全的历史上下文。",
        ))

    if not sources:
        reasons.append("no_valid_citations")
        warnings.append(AnswerWarning(
            code="no_valid_citations",
            message="检索结果中没有可用于回答的有效引用。",
        ))

    if hits and confidence < MIN_ANSWER_CONFIDENCE:
        reasons.append("insufficient_evidence")
        warnings.append(AnswerWarning(
            code="insufficient_evidence",
            message="检索证据与问题匹配度不足，不能形成可追溯回答。",
            severity="info",
            citation_ids=[str(source.get("id") or source.get("chunk_id") or "") for source in sources if source.get("id") or source.get("chunk_id")],
        ))

    conflict_candidates = _context_conflict_candidates(query, hits)
    if conflict_candidates:
        conflict_citation_ids = _conflict_citation_ids(conflict_candidates)
        warnings.append(AnswerWarning(
            code="context_conflict",
            message=_context_conflict_message(conflict_candidates),
            severity="info",
            citation_ids=conflict_citation_ids,
        ))

    return EvidenceAssessment(
        should_refuse=bool(reasons),
        reasons=_dedupe_preserve_order(reasons),
        warnings=warnings,
        metadata={
            "refusal_reason": reasons[0] if reasons else "",
            "refusal_reasons": _dedupe_preserve_order(reasons),
            "evidence": {
                "hit_count": len(hits),
                "confidence": confidence,
                "min_answer_confidence": MIN_ANSWER_CONFIDENCE,
            },
            "knowledge_assets": _knowledge_asset_trace(knowledge_assets or []),
            "conflict_assessment": {
                "status": "candidate" if conflict_candidates else "none",
                "hard_refusal": False,
                "verification": "precise" if conflict_candidates else "none",
                "verification_required": bool(conflict_candidates),
                "decision": "warn_only" if conflict_candidates else "none",
                "rules": [
                    "核对冲突片段是否指向同一对象、动作或参数",
                    "可确认的一致部分正常回答，差异部分必须分别列出引用",
                    "不要仅因候选冲突直接拒答",
                ] if conflict_candidates else [],
                "candidates": conflict_candidates,
            },
        },
    )


def _conflict_citation_ids(conflict_candidates: list[dict]) -> list[str]:
    citation_ids: list[str] = []
    for candidate in conflict_candidates:
        for side in ("positive", "negative"):
            chunk_id = str(candidate.get(side, {}).get("chunk_id") or "")
            if chunk_id and chunk_id not in citation_ids:
                citation_ids.append(chunk_id)
    return citation_ids


def _context_conflict_message(conflict_candidates: list[dict]) -> str:
    if not conflict_candidates:
        return "检索上下文存在可能冲突的表述，回答时需要基于引用谨慎区分。"

    checks: list[str] = []
    for candidate in conflict_candidates[:2]:
        positive = candidate.get("positive", {})
        negative = candidate.get("negative", {})
        positive_id = str(positive.get("chunk_id") or "未知来源")
        negative_id = str(negative.get("chunk_id") or "未知来源")
        positive_text = _compact_claim_text(str(positive.get("text") or ""))
        negative_text = _compact_claim_text(str(negative.get("text") or ""))
        checks.append(f"{positive_id}「{positive_text}」 vs {negative_id}「{negative_text}」")

    return "检索上下文存在可能冲突的表述，需精确核验：" + "；".join(checks)


def _compact_claim_text(text: str, limit: int = 56) -> str:
    clean_text = " ".join(text.split())
    if len(clean_text) <= limit:
        return clean_text
    return clean_text[:limit - 1] + "…"
