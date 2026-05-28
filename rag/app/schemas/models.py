"""Pydantic schemas for RAG service requests and responses."""

from __future__ import annotations

import re
from typing import Any, Literal, Mapping
from pydantic import AliasChoices, BaseModel, Field
from .source_models import SourceContext, SourceMetadata


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

class IngestRequest(BaseModel):
    document_id: str
    file_path: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class IngestResult(BaseModel):
    document_id: str
    chunk_count: int
    index_status: str  # ready | failed


class ReindexRequest(BaseModel):
    document_id: str
    file_path: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ReindexResult(BaseModel):
    document_id: str
    chunk_count: int
    index_status: str


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

class SearchHit(BaseModel):
    chunk_id: str
    document_id: str
    document_title: str
    section_path: str = ""
    page_number: int = 0
    chunk_index: int = 0
    section_level: int = 0
    document_type: str = ""
    source_format: str = ""
    category: str = ""
    version: str = ""
    offset_start: int | None = None
    offset_end: int | None = None
    snippet: str = ""
    content: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)
    source_metadata: SourceMetadata = Field(default_factory=SourceMetadata)
    source_context: SourceContext = Field(default_factory=SourceContext)
    context_before: str = ""
    context_after: str = ""
    context_window: str = ""


class SearchRequest(BaseModel):
    query: str
    top_k: int = Field(default=5, ge=1, le=50)
    mode: str = "vector"
    filters: dict[str, Any] = Field(default_factory=dict)
    allowed_security_levels: list[str] = Field(default=["public", "internal"])


class TermExpansionHit(BaseModel):
    canonical_term: str = ""
    matched_text: str = ""
    matched_kind: str = ""
    expansions: list[str] = Field(default_factory=list)
    source: str = ""


class QueryCandidateTerm(BaseModel):
    term: str = ""
    matched_text: str = ""
    matched_kind: str = ""
    source: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reason: str = ""


class QuerySpellCorrection(BaseModel):
    original: str = ""
    correction: str = ""
    source: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    reason: str = ""


class QueryAmbiguity(BaseModel):
    is_ambiguous: bool = False
    candidates: list[str] = Field(default_factory=list)
    reason: str = ""


class QueryUnderstanding(BaseModel):
    original_query: str = ""
    rewritten_query: str = ""
    intent: str = "general"
    candidate_terms: list[QueryCandidateTerm] = Field(default_factory=list)
    spell_corrections: list[QuerySpellCorrection] = Field(default_factory=list)
    ambiguity: QueryAmbiguity = Field(default_factory=QueryAmbiguity)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    needs_confirmation: bool = False
    grey_answer_hint: str = ""
    trace: list[dict[str, Any]] = Field(default_factory=list)


class SearchResult(BaseModel):
    query: str
    expanded_query: str = ""
    term_expansion_hits: list[TermExpansionHit] = Field(default_factory=list)
    rerank_trace: dict[str, Any] = Field(default_factory=dict)
    results: list[SearchHit]
    latency_ms: int


# ---------------------------------------------------------------------------
# Debug Search
# ---------------------------------------------------------------------------

class DebugSearchRequest(BaseModel):
    query: str
    top_k: int = Field(default=8, ge=1, le=50)
    mode: str = "vector"
    filters: dict[str, Any] = Field(default_factory=dict)
    allowed_security_levels: list[str] = Field(default=["public", "internal"])
    include_prompt: bool = False


class DebugSearchResult(BaseModel):
    query: str
    normalized_query: str
    filters: dict[str, Any]
    retrieval: dict[str, Any]
    prompt_preview: str = ""
    context_chars: int = 0
    estimated_tokens: int = 0


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class Source(BaseModel):
    chunk_id: str
    document_id: str
    document_title: str
    section_path: str = ""
    page_number: int = 0
    chunk_index: int = 0
    section_level: int = 0
    document_type: str = ""
    source_format: str = ""
    category: str = ""
    version: str = ""
    offset_start: int | None = None
    offset_end: int | None = None
    score: float
    snippet: str = ""
    content: str = ""
    source_metadata: SourceMetadata = Field(default_factory=SourceMetadata)
    source_context: SourceContext = Field(default_factory=SourceContext)
    context_before: str = ""
    context_after: str = ""
    context_window: str = ""


class ChatRequest(BaseModel):
    query: str
    top_k: int = Field(default=5, ge=1, le=50)
    allowed_security_levels: list[str] = Field(default=["public", "internal"])
    filters: dict[str, Any] = Field(default_factory=dict)
    history: list[dict[str, str]] = Field(default_factory=list)
    knowledge_assets: list[dict[str, Any]] = Field(default_factory=list)
    session_id: str | None = None
    stream: bool = False


class ChatTrace(BaseModel):
    rewrite_ms: int = 0
    retrieve_ms: int = 0
    retrieval_ms: int = 0
    refusal_ms: int = 0
    generate_ms: int = 0
    artifact_ms: int = 0
    llm_ms: int = 0
    total_ms: int = 0
    stage_timings_ms: dict[str, int] = Field(default_factory=dict)


AnswerStatus = Literal["answered", "partial", "insufficient_context", "error"]
AnswerWarningSeverity = Literal["info", "warning", "error"]


class AnswerQueryRewrite(BaseModel):
    original_query: str = ""
    rewritten_query: str = ""
    changed: bool = False
    strategy: str = "none"
    reason: str = ""
    signals: list[str] = Field(default_factory=list)
    history_turns: int = 0
    term_expansion_hits: list[TermExpansionHit] = Field(default_factory=list)
    query_understanding: QueryUnderstanding = Field(default_factory=QueryUnderstanding)


class AnswerCitation(BaseModel):
    id: str
    source_index: int = 0
    chunk_id: str = ""
    document_id: str = ""
    document_title: str = ""
    section_path: str = ""
    page_number: int = 0
    offset_start: int | None = None
    offset_end: int | None = None
    snippet: str = ""
    score: float = 0.0
    source_metadata: SourceMetadata = Field(default_factory=SourceMetadata)

    @classmethod
    def from_source(cls, source: Mapping[str, Any], index: int) -> "AnswerCitation":
        source_id = str(source.get("id") or source.get("chunk_id") or f"source-{index}")
        return cls(
            id=source_id,
            source_index=index,
            chunk_id=str(source.get("chunk_id") or ""),
            document_id=str(source.get("document_id") or ""),
            document_title=str(source.get("document_title") or ""),
            section_path=str(source.get("section_path") or ""),
            page_number=_coerce_int(source.get("page_number")),
            offset_start=_coerce_optional_int(source.get("offset_start")),
            offset_end=_coerce_optional_int(source.get("offset_end")),
            snippet=str(source.get("snippet") or "")[:500],
            score=_coerce_float(source.get("score")),
            source_metadata=SourceMetadata.from_source(source),
        )


class AnswerClaim(BaseModel):
    id: str
    text: str
    citation_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    kind: str = "conclusion"


class AnswerWarning(BaseModel):
    code: str
    message: str
    severity: AnswerWarningSeverity = "warning"
    citation_ids: list[str] = Field(default_factory=list)


class AnswerIR(BaseModel):
    schema_version: str = "answer-ir/v1"
    status: AnswerStatus = "answered"
    answer: str = ""
    claims: list[AnswerClaim] = Field(default_factory=list)
    citations: list[AnswerCitation] = Field(default_factory=list)
    query_rewrite: AnswerQueryRewrite = Field(default_factory=AnswerQueryRewrite)
    query_understanding: QueryUnderstanding = Field(default_factory=QueryUnderstanding)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    warnings: list[AnswerWarning] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def from_chat(
        cls,
        *,
        answer: str,
        sources: list[Mapping[str, Any]],
        original_query: str,
        rewritten_query: str,
        confidence: float,
        query_rewrite: AnswerQueryRewrite | Mapping[str, Any] | None = None,
        status: AnswerStatus | None = None,
        warnings: list[AnswerWarning] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> "AnswerIR":
        citations = [AnswerCitation.from_source(source, index) for index, source in enumerate(sources, 1)]
        normalized_confidence = _clamp_confidence(confidence)
        derived_status = status or _derive_answer_status(answer, citations, normalized_confidence)
        answer_confidence = 0.0 if derived_status == "insufficient_context" else normalized_confidence
        claim_text = _extract_primary_claim(answer)
        claims = [
            AnswerClaim(
                id="claim-1",
                text=claim_text,
                citation_ids=[citation.id for citation in citations],
                confidence=answer_confidence,
            )
        ] if claim_text and derived_status != "insufficient_context" else []
        derived_warnings = list(warnings or [])
        if not citations:
            derived_warnings.append(AnswerWarning(
                code="no_citations",
                message="当前回答没有可用引用，不能作为可追溯结论。",
            ))
        if answer_confidence > 0 and answer_confidence < 0.6:
            derived_warnings.append(AnswerWarning(
                code="low_confidence",
                message="当前回答置信度较低，需要人工核对原文。",
                severity="info",
                citation_ids=[citation.id for citation in citations],
            ))
        if isinstance(query_rewrite, AnswerQueryRewrite):
            rewrite = query_rewrite
        elif isinstance(query_rewrite, Mapping):
            rewrite = AnswerQueryRewrite.model_validate(query_rewrite)
        else:
            rewrite = AnswerQueryRewrite(
                original_query=original_query,
                rewritten_query=rewritten_query,
                changed=rewritten_query != original_query,
                strategy="chapter_number_expansion" if rewritten_query != original_query else "none",
                reason="章节编号被展开以提高召回" if rewritten_query != original_query else "",
            )

        return cls(
            status=derived_status,
            answer=answer,
            claims=claims,
            citations=citations,
            query_rewrite=rewrite,
            query_understanding=rewrite.query_understanding,
            confidence=answer_confidence,
            warnings=derived_warnings,
            metadata=metadata or {},
        )


VisualArtifactType = Literal["diagram", "flowchart", "mindmap", "chart", "table", "image"]


class VisualArtifactPlan(BaseModel):
    type: VisualArtifactType = Field(validation_alias=AliasChoices("type", "artifact_type"))
    auto_generate: bool = False
    title: str = ""
    reason: str = ""
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    priority: int = Field(default=50, ge=0, le=100)
    source_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class VisualPlan(BaseModel):
    schema_version: str = "visual-plan/v1"
    can_generate: bool = False
    artifacts: list[VisualArtifactPlan] = Field(default_factory=list)
    warnings: list[AnswerWarning] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChatResult(BaseModel):
    message_id: str = ""
    answer: str
    sources: list[Source] = Field(default_factory=list)
    confidence: float = 0.0
    followups: list[str] = Field(default_factory=list)
    trace: ChatTrace = Field(default_factory=ChatTrace)
    answer_ir: AnswerIR | None = None
    visual_plan: VisualPlan | None = None


# ---------------------------------------------------------------------------
# Diagram IR
# ---------------------------------------------------------------------------

class DiagramGenerateRequest(BaseModel):
    title: str = "AI 整理"
    content: str
    type: str = Field(default="mindmap", validation_alias=AliasChoices("type", "diagram_type"))
    source_ids: list[str] = Field(default_factory=list)
    max_steps: int = Field(default=8, ge=2, le=12)


class ImageArtifactContractRequest(BaseModel):
    question: str = ""
    answer: str
    sources: list[dict[str, Any]] = Field(default_factory=list)
    requested_by_user: bool = False


class KnowledgeGraphPlanRequest(BaseModel):
    content: str
    sources: list[dict[str, Any]] = Field(default_factory=list)


class ImageArtifactContract(BaseModel):
    schema_version: str = "image-artifact-contract/v1"
    renderer: str = "image-contract"
    status: str = "contract_only"
    allowed: bool = False
    async_required: bool = True
    sanitized_prompt: str = ""
    inherited_source_ids: list[str] = Field(default_factory=list)
    inherited_document_ids: list[str] = Field(default_factory=list)
    redaction_report: dict[str, int] = Field(default_factory=dict)
    safety_warnings: list[AnswerWarning] = Field(default_factory=list)
    failure_fallback: str = "返回文本说明和引用证据，不生成图片。"
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    service: str = "rag-service"
    version: str = "1.0.0"
    chroma_status: str = "unknown"
    embedding_model: str = ""
    llm_provider: str = ""


def _coerce_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _coerce_optional_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _clamp_confidence(value: Any) -> float:
    return max(0.0, min(1.0, _coerce_float(value)))


REFUSAL_ANSWER_PATTERN = re.compile(
    r"^\s*(?:根据当前知识库信息[，,]\s*)?(?:我)?(?:暂时)?(?:无法确认|无法回答|不能确定)(?:该|这个)?问题[。.!！]?\s*$"
    r"|^\s*(?:没有足够(?:信息|证据)|信息不足|问题不够具体|请补充)"
)


def _derive_answer_status(answer: str, citations: list[AnswerCitation], confidence: float) -> AnswerStatus:
    if not answer.strip() or not citations:
        return "insufficient_context"
    if REFUSAL_ANSWER_PATTERN.search(answer):
        return "insufficient_context"
    if confidence > 0 and confidence < 0.6:
        return "partial"
    return "answered"


def _extract_primary_claim(answer: str) -> str:
    for line in answer.splitlines():
        cleaned = line.strip().lstrip("-*0123456789.、 ")
        if cleaned and not cleaned.startswith("[来源") and not cleaned.startswith("来源"):
            return cleaned[:300]
    return ""
