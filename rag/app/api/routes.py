import time
import json
import logging
import re
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from ..core.pipeline import RagPipeline, _estimate_confidence, _suggest_followups
from ..evaluation import DiagramIR, build_placeholder_diagram_ir
from ..llm.usage_guard import usage_summary
from ..schemas.models import (
    IngestRequest, IngestResult,
    SearchRequest, SearchResult,
    DebugSearchRequest, DebugSearchResult,
    ChatRequest, ChatResult,
    DiagramGenerateRequest,
    ReindexRequest, ReindexResult,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rag")
pipeline = RagPipeline()


@router.get("/health")
def health():
    return {
        "status": "ok",
        "service": "rag-service",
        "version": "1.0.0",
        "chroma_status": "ok",
        "embedding_model": pipeline.config.embedding_model,
        "llm_provider": pipeline.config.deepseek_model,
    }


@router.get("/usage")
def usage():
    return usage_summary()


@router.get("/documents")
def list_rag_documents():
    """List all unique documents in Chroma with metadata."""
    try:
        from ..retrieval.vector_store import _get_collection
        coll = _get_collection()
        all_data = coll.get()
        docs: dict[str, dict] = {}
        for i, meta in enumerate(all_data.get("metadatas", []) or []):
            if not meta:
                continue
            doc_id = meta.get("document_id", "unknown")
            title = meta.get("title", doc_id)
            section = meta.get("section_path", "")
            if doc_id not in docs:
                docs[doc_id] = {
                    "document_id": doc_id,
                    "title": title,
                    "chunk_count": 0,
                    "section_paths": [],
                    "category": section.split(" / ")[0] if section else "",
                }
            docs[doc_id]["chunk_count"] += 1
            if section and section not in docs[doc_id]["section_paths"]:
                docs[doc_id]["section_paths"].append(section)

        return {"documents": sorted(docs.values(), key=lambda d: d["title"])}
    except Exception as e:
        logger.exception("Failed to list documents")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/documents/ingest", response_model=IngestResult)
def ingest(request: IngestRequest):
    try:
        result = pipeline.ingest_document(
            document_id=request.document_id,
            file_path=request.file_path,
            metadata=request.metadata,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Ingest failed for {request.document_id}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/documents/reindex", response_model=ReindexResult)
def reindex(request: ReindexRequest):
    try:
        result = pipeline.reindex_document(
            document_id=request.document_id,
            file_path=request.file_path,
            metadata=request.metadata,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Reindex failed for {request.document_id}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search", response_model=SearchResult)
def search(request: SearchRequest):
    try:
        result = pipeline.search(
            query=request.query,
            top_k=request.top_k,
            allowed_security_levels=request.allowed_security_levels,
            filters=request.filters,
        )
        return result
    except Exception as e:
        logger.exception("Search failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search/debug", response_model=DebugSearchResult)
def search_debug(request: DebugSearchRequest):
    try:
        result = pipeline.debug_search(
            query=request.query,
            top_k=request.top_k,
            allowed_security_levels=request.allowed_security_levels,
            filters=request.filters,
            include_prompt=request.include_prompt,
        )
        return result
    except Exception as e:
        logger.exception("Debug search failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat", response_model=ChatResult)
def chat(request: ChatRequest):
    try:
        result = pipeline.chat(
            query=request.query,
            top_k=request.top_k,
            allowed_security_levels=request.allowed_security_levels,
            filters=request.filters,
            history=request.history,
        )
        return result
    except Exception as e:
        logger.exception("Chat failed")
        raise HTTPException(status_code=500, detail=str(e))


def _extract_diagram_steps(content: str, max_steps: int) -> list[str]:
    cleaned = content.strip()
    candidates: list[str] = []

    numbered_content = re.sub(
        r"(^|[。；;.!?！？\s])(?:\d+[.)、]|[一二三四五六七八九十]+[、.])\s*",
        lambda match: f"{match.group(1)}\n",
        cleaned,
    )

    for block in re.split(r"[\r\n]+", numbered_content):
        block = block.strip()
        if not block:
            continue
        for part in re.split(r"[。；;.!?！？]+", block):
            line = re.sub(r"^\s*(?:[-*+]\s+|\d+[.)、]\s*|[一二三四五六七八九十]+[、.]\s*)", "", part).strip()
            if line:
                candidates.append(line)

    steps: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = re.sub(r"\s+", " ", candidate).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        steps.append(normalized[:80])
        if len(steps) >= max_steps:
            break

    if len(steps) < 2 and cleaned:
        compact = re.sub(r"\s+", " ", cleaned)
        steps = [compact[index:index + 36] for index in range(0, min(len(compact), 36 * max_steps), 36)]

    return steps[:max_steps] or ["整理回答要点", "检查关联证据"]


@router.post("/diagram/generate", response_model=DiagramIR)
def generate_diagram(request: DiagramGenerateRequest):
    try:
        diagram_type = request.diagram_type.strip().lower()
        if diagram_type not in {"mindmap", "flowchart"}:
            raise HTTPException(status_code=400, detail="diagram_type must be mindmap or flowchart")
        if not request.content.strip():
            raise HTTPException(status_code=400, detail="content is required")

        return build_placeholder_diagram_ir(
            title=request.title.strip() or "AI 整理",
            steps=_extract_diagram_steps(request.content, request.max_steps),
            source_ids=request.source_ids,
            diagram_type=diagram_type,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Diagram generation failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream")
def chat_stream(request: ChatRequest):
    """Streaming chat endpoint using SSE."""
    def _sse_json(obj: dict) -> str:
        return json.dumps(obj, ensure_ascii=False)

    async def generate():
        try:
            # 1. Search
            search_result = pipeline.search(
                query=request.query,
                top_k=request.top_k,
                allowed_security_levels=request.allowed_security_levels,
                filters=request.filters,
            )
            hits = search_result["results"]

            # Send search metadata
            yield f"data: {_sse_json({'type': 'meta', 'retrieval_ms': search_result['latency_ms'], 'hit_count': len(hits)})}\n\n"

            # 2. Build prompt
            from ..llm.prompt_builder import build_messages, extract_sources
            messages = build_messages(request.query, hits, request.history, pipeline.config.rag_max_context_chars)
            sources = extract_sources(hits)

            # 3. Stream LLM
            from ..llm.client import chat_stream as llm_stream
            total_tokens = 0
            for sse_chunk in llm_stream(messages, temperature=pipeline.config.rag_temperature):
                # Parse to inject sources on done event
                if '"type": "done"' in sse_chunk:
                    done_data = {
                        "type": "done",
                        "sources": sources,
                        "confidence": _estimate_confidence(hits),
                        "followups": _suggest_followups(request.query, hits),
                    }
                    yield f"data: {_sse_json(done_data)}\n\n"
                else:
                    yield sse_chunk
        except Exception as e:
            logger.exception("Chat stream failed")
            yield f"data: {_sse_json({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                           headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                                   "X-Accel-Buffering": "no"})
