import time
import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from ..core.pipeline import RagPipeline, _estimate_confidence, _suggest_followups
from ..schemas.models import (
    IngestRequest, IngestResult,
    SearchRequest, SearchResult,
    DebugSearchRequest, DebugSearchResult,
    ChatRequest, ChatResult,
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

            # 3. Stream LLM
            from ..llm.client import chat_stream as llm_stream
            total_tokens = 0
            for sse_chunk in llm_stream(messages, temperature=pipeline.config.rag_temperature):
                # Parse to inject sources on done event
                if '"type": "done"' in sse_chunk:
                    sources = extract_sources(hits)
                    done_data = {
                        "type": "done",
                        "sources": [{
                            "chunk_id": s.get("chunk_id", ""),
                            "document_id": s.get("document_id", ""),
                            "document_title": s.get("document_title", ""),
                            "section_path": s.get("section_path", ""),
                            "page_number": s.get("page_number", 0),
                            "score": s.get("score", 0),
                            "snippet": s.get("content", "")[:200],
                        } for s in sources],
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
