"""Pydantic schemas for RAG service requests and responses."""

from __future__ import annotations

from typing import Any, Literal, Mapping
from pydantic import BaseModel, Field
from ..core.source_metadata import build_source_metadata


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

class SourceDocument(BaseModel):
    id: str = ""
    title: str = ""
    category: str = ""
    file_type: str = ""
    source_format: str = ""
    mime_type: str = ""
    security_level: str = ""
    version: str = ""
    status: str = ""
    available: bool = False


class SourceSection(BaseModel):
    path: str = ""
    title: str = ""
    level: int = 0
    available: bool = False


class SourceChunk(BaseModel):
    id: str = ""
    index: int = 0
    title: str = ""
    type: str = "text"
    available: bool = False


class SourcePage(BaseModel):
    number: int = 0
    available: bool = False


class SourceOffset(BaseModel):
    start: int | None = None
    end: int | None = None
    unit: str = "char"
    available: bool = False


class SourceFormat(BaseModel):
    name: str = ""
    mime_type: str = ""
    available: bool = False


class SourceContext(BaseModel):
    content: str = ""
    snippet: str = ""
    before: str = ""
    after: str = ""
    window: str = ""
    page_number: int = 0
    offset_start: int | None = None
    offset_end: int | None = None
    offset_unit: str = "char"
    available: bool = False


class SourceMetadata(BaseModel):
    """Canonical source contract shared by search/chat outputs.

    Availability and compatibility rules:
    - `document.available` is true when an id or title can be resolved.
    - `section.available` is true when the parser emits a heading or path.
    - `chunk.available` is true once a retrieved hit can be tied to a chunk.
    - `page.available` is true only for page-aware sources with a positive page.
    - `offset.available` is true when a concrete start/end span is known.
    - `format.available` is true when source type or MIME is known.
    - `snippet_available` is true when the retrieval preview is non-empty.
    - Flat legacy fields remain on `SearchHit`/`Source` until all consumers
      migrate, so new metadata is strictly additive.
    """

    document: SourceDocument = Field(default_factory=SourceDocument)
    section: SourceSection = Field(default_factory=SourceSection)
    chunk: SourceChunk = Field(default_factory=SourceChunk)
    page: SourcePage = Field(default_factory=SourcePage)
    offset: SourceOffset = Field(default_factory=SourceOffset)
    format: SourceFormat = Field(default_factory=SourceFormat)
    content_kind: str = ""
    snippet: str = ""
    snippet_available: bool = False

    @classmethod
    def from_source(cls, source: Mapping[str, Any] | None) -> "SourceMetadata":
        if not source:
            return cls()

        normalized = build_source_metadata(source)
        document = normalized.get("document") if isinstance(normalized.get("document"), dict) else {}
        section = normalized.get("section") if isinstance(normalized.get("section"), dict) else {}
        chunk = normalized.get("chunk") if isinstance(normalized.get("chunk"), dict) else {}
        page = normalized.get("page") if isinstance(normalized.get("page"), dict) else {}
        offset = normalized.get("offset") if isinstance(normalized.get("offset"), dict) else {}
        metadata = normalized.get("metadata") if isinstance(normalized.get("metadata"), dict) else {}
        source_format = str(normalized.get("format") or normalized.get("file_type") or metadata.get("source_format") or "")
        offset_start = offset.get("start")
        if offset_start is None:
            offset_start = metadata.get("offset_start")
        offset_end = offset.get("end")
        if offset_end is None:
            offset_end = metadata.get("offset_end")

        return cls(
            document=SourceDocument(
                id=str(normalized.get("document_id") or document.get("id") or ""),
                title=str(normalized.get("document_title") or document.get("title") or ""),
                category=str(document.get("category") or metadata.get("category") or ""),
                file_type=str(document.get("file_type") or normalized.get("file_type") or ""),
                source_format=str(document.get("source_format") or normalized.get("source_format") or ""),
                mime_type=str(document.get("mime_type") or normalized.get("mime_type") or ""),
                security_level=str(document.get("security_level") or metadata.get("security_level") or ""),
                version=str(document.get("version") or metadata.get("version") or ""),
                status=str(document.get("status") or metadata.get("status") or ""),
                available=bool(document.get("available")),
            ),
            section=SourceSection(
                path=str(normalized.get("section_path") or section.get("path") or ""),
                title=str(section.get("title") or normalized.get("section_path") or ""),
                level=_coerce_int(section.get("level") or metadata.get("section_level")),
                available=bool(section.get("available")),
            ),
            chunk=SourceChunk(
                id=str(normalized.get("chunk_id") or chunk.get("id") or ""),
                index=_coerce_int(chunk.get("index") or metadata.get("chunk_index")),
                title=str(chunk.get("title") or normalized.get("document_title") or ""),
                type=str(chunk.get("type") or metadata.get("chunk_type") or "text"),
                available=bool(chunk.get("available")),
            ),
            page=SourcePage(
                number=_coerce_int(normalized.get("page_number") or page.get("number")),
                available=bool(page.get("available")),
            ),
            offset=SourceOffset(
                start=_coerce_optional_int(offset_start),
                end=_coerce_optional_int(offset_end),
                unit=str(offset.get("unit") or metadata.get("offset_unit") or "char"),
                available=bool(offset.get("available")),
            ),
            format=SourceFormat(
                name=source_format,
                mime_type=str(normalized.get("mime_type") or document.get("mime_type") or ""),
                available=bool(normalized.get("format_available") or metadata.get("format_available")),
            ),
            content_kind=str(normalized.get("content_kind") or ""),
            snippet=str(normalized.get("snippet") or "")[:200],
            snippet_available=bool(normalized.get("snippet_available") or metadata.get("snippet_available")),
        )


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


class SearchResult(BaseModel):
    query: str
    expanded_query: str = ""
    term_expansion_hits: list[TermExpansionHit] = Field(default_factory=list)
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
    session_id: str | None = None
    stream: bool = False


class ChatTrace(BaseModel):
    retrieval_ms: int = 0
    llm_ms: int = 0
    total_ms: int = 0


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
        claim_text = _extract_primary_claim(answer)
        claims = [
            AnswerClaim(
                id="claim-1",
                text=claim_text,
                citation_ids=[citation.id for citation in citations],
                confidence=normalized_confidence,
            )
        ] if claim_text and derived_status != "insufficient_context" else []
        derived_warnings = list(warnings or [])
        if not citations:
            derived_warnings.append(AnswerWarning(
                code="no_citations",
                message="当前回答没有可用引用，不能作为可追溯结论。",
            ))
        if normalized_confidence > 0 and normalized_confidence < 0.6:
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
            confidence=normalized_confidence,
            warnings=derived_warnings,
            metadata=metadata or {},
        )


VisualArtifactType = Literal["mindmap", "flowchart", "architecture", "table", "image"]


class VisualArtifactPlan(BaseModel):
    artifact_type: VisualArtifactType
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
    diagram_type: str = "mindmap"
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


def _derive_answer_status(answer: str, citations: list[AnswerCitation], confidence: float) -> AnswerStatus:
    if not answer.strip() or not citations:
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
