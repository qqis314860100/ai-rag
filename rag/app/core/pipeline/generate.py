import time
from collections.abc import Callable

from ...artifacts import plan_visual_artifacts
from ...llm.prompt_builder import build_messages
from ...schemas.models import AnswerIR, AnswerQueryRewrite
from .refusal import EvidenceAssessment, REFUSAL_ANSWER
from .rewrite import _knowledge_asset_trace


def _build_answer_chat_result(
    *,
    query: str,
    rewritten_query: str,
    query_rewrite: AnswerQueryRewrite,
    hits: list[dict],
    sources: list[dict],
    confidence: float,
    retrieval_ms: int,
    total_start: float,
    history: list[dict[str, str]] | None,
    knowledge_assets: list[dict],
    max_context_chars: int,
    temperature: float,
    llm_chat_fn: Callable,
) -> dict:
    messages = build_messages(query, hits, history, max_context_chars)

    llm_start = time.time()
    llm_result = llm_chat_fn(messages, temperature=temperature)
    llm_ms = llm_result.get("latency_ms", int((time.time() - llm_start) * 1000))

    answer_ir = AnswerIR.from_chat(
        answer=llm_result["content"],
        sources=sources,
        original_query=query,
        rewritten_query=rewritten_query,
        query_rewrite=query_rewrite,
        confidence=confidence,
        metadata={"knowledge_assets": _knowledge_asset_trace(knowledge_assets)},
    )
    visual_plan = plan_visual_artifacts(
        question=query,
        answer=llm_result["content"],
        sources=sources,
        confidence=confidence,
        answer_status=answer_ir.status,
    )
    visual_plan.metadata["knowledge_assets"] = _knowledge_asset_trace(knowledge_assets)

    total_ms = int((time.time() - total_start) * 1000)

    return {
        "message_id": "",
        "answer": llm_result["content"],
        "sources": sources,
        "confidence": confidence,
        "followups": _suggest_followups(query, hits),
        "trace": {
            "retrieval_ms": retrieval_ms,
            "llm_ms": llm_ms,
            "total_ms": total_ms,
            "knowledge_asset_count": len(knowledge_assets),
        },
        "answer_ir": answer_ir.model_dump(),
        "visual_plan": visual_plan.model_dump(),
    }


def _build_refusal_chat_result(
    *,
    query: str,
    rewritten_query: str,
    query_rewrite: AnswerQueryRewrite,
    hits: list[dict],
    sources: list[dict],
    confidence: float,
    refusal: EvidenceAssessment,
    retrieval_ms: int,
    llm_ms: int,
    total_start: float,
    knowledge_assets: list[dict] | None = None,
) -> dict:
    answer_ir = AnswerIR.from_chat(
        answer=REFUSAL_ANSWER,
        sources=sources,
        original_query=query,
        rewritten_query=rewritten_query,
        query_rewrite=query_rewrite,
        confidence=confidence,
        status="insufficient_context",
        warnings=refusal.warnings,
        metadata=refusal.metadata,
    )
    visual_plan = plan_visual_artifacts(
        question=query,
        answer=REFUSAL_ANSWER,
        sources=sources,
        confidence=confidence,
        answer_status=answer_ir.status,
    )
    visual_plan.metadata["knowledge_assets"] = _knowledge_asset_trace(knowledge_assets or [])
    total_ms = int((time.time() - total_start) * 1000)

    return {
        "message_id": "",
        "answer": REFUSAL_ANSWER,
        "sources": sources,
        "confidence": confidence,
        "followups": _suggest_followups(query, hits) if sources else [],
        "trace": {
            "retrieval_ms": retrieval_ms,
            "llm_ms": llm_ms,
            "total_ms": total_ms,
        },
        "answer_ir": answer_ir.model_dump(),
        "visual_plan": visual_plan.model_dump(),
    }


def _suggest_followups(query: str, hits: list[dict]) -> list[str]:
    if not hits:
        return []
    suggestions: list[str] = []
    titles = set()
    for h in hits[:3]:
        title = h.get("document_title", "")
        if title and title not in titles:
            suggestions.append(f"请详细介绍《{title}》的内容")
            titles.add(title)
    return suggestions[:3]
