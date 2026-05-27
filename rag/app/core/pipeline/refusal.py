from dataclasses import dataclass, field

from ...schemas.models import AnswerQueryRewrite, AnswerWarning
from .retrieve import _context_conflict_candidates
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
        warnings.append(AnswerWarning(
            code="context_conflict",
            message="检索上下文存在可能冲突的表述，回答时需要基于引用谨慎区分。",
            severity="info",
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
                "candidates": conflict_candidates,
            },
        },
    )
