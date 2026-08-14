"""Pydantic schemas for RAG service requests and responses."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

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
    content: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


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
    score: float
    snippet: str = ""
    content: str = ""


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
# Health
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str
    service: str = "rag-service"
    version: str = "1.0.0"
    chroma_status: str = "unknown"
    embedding_model: str = ""
    llm_provider: str = ""
