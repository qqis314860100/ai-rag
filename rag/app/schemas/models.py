"""Pydantic schemas for RAG service requests and responses."""

from __future__ import annotations

from typing import Any, Mapping
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


class SearchResult(BaseModel):
    query: str
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


class ChatResult(BaseModel):
    message_id: str = ""
    answer: str
    sources: list[Source] = Field(default_factory=list)
    confidence: float = 0.0
    followups: list[str] = Field(default_factory=list)
    trace: ChatTrace = Field(default_factory=ChatTrace)


# ---------------------------------------------------------------------------
# Diagram IR
# ---------------------------------------------------------------------------

class DiagramGenerateRequest(BaseModel):
    title: str = "AI 整理"
    content: str
    diagram_type: str = "mindmap"
    source_ids: list[str] = Field(default_factory=list)
    max_steps: int = Field(default=8, ge=2, le=12)


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
