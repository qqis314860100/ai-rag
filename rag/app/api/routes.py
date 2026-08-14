import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..core.config import config
from ..core.pipeline import (
    RagPipeline,
    _estimate_confidence,
    _suggest_followups,
)
from ..llm.usage_guard import usage_summary
from ..schemas.models import (
    ChatRequest,
    ChatResult,
    DebugSearchRequest,
    DebugSearchResult,
    IngestRequest,
    IngestResult,
    ReindexRequest,
    ReindexResult,
    SearchRequest,
    SearchResult,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/rag")
pipeline = RagPipeline()

if not config.rag_api_key:
    logger.warning(
        "RAG_API_KEY is not set — the RAG service is exposed without authentication. "
        "Set RAG_API_KEY in production and configure the API gateway to send it."
    )


def verify_api_key(request: Request) -> None:
    """Require the shared secret when one is configured."""
    if not config.rag_api_key:
        return
    provided = request.headers.get("X-API-Key", "")
    if provided != config.rag_api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@router.get("/health", dependencies=[Depends(verify_api_key)])
def health():
    try:
        from ..retrieval.vector_store import _get_collection
        chroma_count = _get_collection().count()
        chroma_status = "ok"
    except Exception as e:
        logger.exception("Chroma health check failed")
        chroma_count = -1
        chroma_status = f"error: {type(e).__name__}"

    from ..embedding.service import _use_fallback

    return {
        "status": "ok",
        "service": "rag-service",
        "version": "1.0.0",
        "chroma_status": chroma_status,
        "chroma_count": chroma_count,
        "embedding_model": config.embedding_model,
        "embedding_mode": "fallback-hash" if _use_fallback else "model",
        "llm_provider": config.deepseek_model,
    }


@router.get("/usage", dependencies=[Depends(verify_api_key)])
def usage():
    return usage_summary()


@router.get("/documents", dependencies=[Depends(verify_api_key)])
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
    except Exception:
        logger.exception("Failed to list documents")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/documents/ingest", response_model=IngestResult, dependencies=[Depends(verify_api_key)])
def ingest(request: IngestRequest):
    try:
        result = pipeline.ingest_document(
            document_id=request.document_id,
            file_path=request.file_path,
            metadata=request.metadata,
        )
        return result
    except ValueError as e:
        # Client errors (bad path, unsupported type) — safe to echo
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception(f"Ingest failed for {request.document_id}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/documents/reindex", response_model=ReindexResult, dependencies=[Depends(verify_api_key)])
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
    except Exception:
        logger.exception(f"Reindex failed for {request.document_id}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/search", response_model=SearchResult, dependencies=[Depends(verify_api_key)])
def search(request: SearchRequest):
    try:
        result = pipeline.search(
            query=request.query,
            top_k=request.top_k,
            allowed_security_levels=request.allowed_security_levels,
            filters=request.filters,
        )
        return result
    except Exception:
        logger.exception("Search failed")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/search/debug", response_model=DebugSearchResult, dependencies=[Depends(verify_api_key)])
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
    except Exception:
        logger.exception("Debug search failed")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/chat", response_model=ChatResult, dependencies=[Depends(verify_api_key)])
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
    except Exception:
        logger.exception("Chat failed")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/chat/stream", dependencies=[Depends(verify_api_key)])
def chat_stream(request: ChatRequest):
    """Streaming chat endpoint using SSE."""
    def _sse_json(obj: dict) -> str:
        return json.dumps(obj, ensure_ascii=False)

    async def generate():
        try:
            # 1. Retrieve with the same query processing as the non-streaming
            #    path (rewrite + keyword rerank) so both modes answer alike
            retrieved = pipeline.retrieve(
                query=request.query,
                top_k=request.top_k,
                allowed_security_levels=request.allowed_security_levels,
                filters=request.filters,
            )
            hits = retrieved["results"]
            retrieval_ms = retrieved["latency_ms"]

            # Send search metadata
            yield f"data: {_sse_json({'type': 'meta', 'retrieval_ms': retrieval_ms, 'hit_count': len(hits)})}\n\n"

            # 2. Build prompt
            from ..llm.prompt_builder import build_messages, extract_sources
            messages = build_messages(request.query, hits, request.history, pipeline.config.rag_max_context_chars)

            # 3. Stream LLM
            from ..llm.client import chat_stream as llm_stream
            for sse_chunk in llm_stream(messages, temperature=pipeline.config.rag_temperature):
                # Inject sources on the done event (parse JSON instead of
                # relying on substring matching)
                if sse_chunk.startswith("data: "):
                    try:
                        parsed = json.loads(sse_chunk[6:])
                    except json.JSONDecodeError:
                        parsed = None
                    if parsed and parsed.get("type") == "done":
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
                                "content": s.get("content", ""),
                            } for s in sources],
                            "confidence": _estimate_confidence(hits),
                            "followups": _suggest_followups(request.query, hits),
                        }
                        yield f"data: {_sse_json(done_data)}\n\n"
                        continue
                yield sse_chunk
        except Exception as e:
            logger.exception("Chat stream failed")
            yield f"data: {_sse_json({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                           headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                                   "X-Accel-Buffering": "no"})
