import time
import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from ..core.pipeline import (
    REFUSAL_ANSWER,
    RagPipeline,
    _assess_insufficient_context,
    _estimate_confidence,
    _keyword_rerank,
    _rewrite_query_with_trace,
    _suggest_followups,
)
from ..core.terminology import list_term_entries, terminology_contract
from ..artifacts import DiagramIR, build_image_artifact_contract, build_llm_diagram_ir, plan_visual_artifacts
from ..artifacts.knowledge_graph import build_lightweight_knowledge_graph
from ..llm.usage_guard import usage_summary
from ..schemas.models import (
    IngestRequest, IngestResult,
    SearchRequest, SearchResult,
    DebugSearchRequest, DebugSearchResult,
    ChatRequest, ChatResult,
    DiagramGenerateRequest, ImageArtifactContract, ImageArtifactContractRequest, KnowledgeGraphPlanRequest, AnswerIR,
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


@router.get("/terminology/contract")
def get_terminology_contract():
    return {
        "contract": terminology_contract(),
        "terms": list_term_entries(),
    }


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
            knowledge_assets=request.knowledge_assets,
        )
        return result
    except Exception as e:
        logger.exception("Chat failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/diagram/generate", response_model=DiagramIR)
def generate_diagram(request: DiagramGenerateRequest):
    try:
        diagram_type = request.type.strip().lower()
        if diagram_type not in {"mindmap", "flowchart"}:
            raise HTTPException(status_code=400, detail="type must be mindmap or flowchart")
        if not request.content.strip():
            raise HTTPException(status_code=400, detail="content is required")

        return build_llm_diagram_ir(
            title=request.title.strip() or "AI 整理",
            content=request.content,
            source_ids=request.source_ids,
            diagram_type=diagram_type,
            max_steps=request.max_steps,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Diagram generation failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/artifacts/image/contract", response_model=ImageArtifactContract)
def image_artifact_contract(request: ImageArtifactContractRequest):
    try:
        return build_image_artifact_contract(
            question=request.question,
            answer=request.answer,
            sources=request.sources,
            requested_by_user=request.requested_by_user,
        )
    except Exception as e:
        logger.exception("Image artifact contract failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/knowledge/graph/plan")
def knowledge_graph_plan(request: KnowledgeGraphPlanRequest):
    try:
        if not request.content.strip():
            raise HTTPException(status_code=400, detail="content is required")
        return build_lightweight_knowledge_graph(request.content, request.sources)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Knowledge graph planning failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream")
def chat_stream(request: ChatRequest):
    """Streaming chat endpoint using SSE."""
    def _sse_json(obj: dict) -> str:
        return json.dumps(obj, ensure_ascii=False)

    async def generate():
        try:
            # 1. Search
            matched_assets = [
                asset for asset in request.knowledge_assets
                if str(asset.get("label") or "").lower() in request.query.lower()
                or any(str(term).lower() in request.query.lower() for term in asset.get("retrieval_terms", []) if len(str(term)) >= 2)
            ][:8]
            query_rewrite = _rewrite_query_with_trace(request.query, request.history, matched_assets)
            rewritten_query = query_rewrite.rewritten_query
            search_result = pipeline.search(
                query=rewritten_query,
                top_k=request.top_k,
                allowed_security_levels=request.allowed_security_levels,
                filters=request.filters,
            )
            hits = search_result["results"]
            if rewritten_query != request.query:
                hits = _keyword_rerank(f"{request.query} {rewritten_query}", hits, request.filters)

            # Send search metadata
            yield f"data: {_sse_json({'type': 'meta', 'retrieval_ms': search_result['latency_ms'], 'hit_count': len(hits), 'query_rewrite': query_rewrite.model_dump()})}\n\n"

            # 2. Build prompt
            from ..llm.prompt_builder import build_messages, extract_sources
            messages = build_messages(request.query, hits, request.history, pipeline.config.rag_max_context_chars)
            sources = extract_sources(hits)
            confidence = _estimate_confidence(request.query, hits, request.filters, matched_assets)
            refusal = _assess_insufficient_context(
                query=request.query,
                query_rewrite=query_rewrite,
                hits=hits,
                sources=sources,
                confidence=confidence,
                knowledge_assets=matched_assets,
            )
            if refusal.should_refuse:
                answer_ir = AnswerIR.from_chat(
                    answer=REFUSAL_ANSWER,
                    sources=sources,
                    original_query=request.query,
                    rewritten_query=rewritten_query,
                    query_rewrite=query_rewrite,
                    confidence=confidence,
                    status="insufficient_context",
                    warnings=refusal.warnings,
                    metadata=refusal.metadata,
                )
                yield f"data: {_sse_json({'type': 'token', 'content': REFUSAL_ANSWER})}\n\n"
                visual_plan = plan_visual_artifacts(
                    question=request.query,
                    answer=REFUSAL_ANSWER,
                    sources=sources,
                    confidence=confidence,
                    answer_status=answer_ir.status,
                )
                visual_plan.metadata["knowledge_assets"] = answer_ir.metadata.get("knowledge_assets", [])
                yield f"data: {_sse_json({'type': 'done', 'sources': sources, 'confidence': confidence, 'followups': [], 'answer_ir': answer_ir.model_dump(), 'visual_plan': visual_plan.model_dump()})}\n\n"
                return

            # 3. Stream LLM
            from ..llm.client import chat_stream as llm_stream
            full_answer = ""
            for sse_chunk in llm_stream(messages, temperature=pipeline.config.rag_temperature):
                event_data: dict | None = None
                if sse_chunk.startswith("data: "):
                    try:
                        event_data = json.loads(sse_chunk[len("data: "):].strip())
                    except Exception:
                        event_data = None

                if event_data and event_data.get("type") == "token":
                    full_answer += str(event_data.get("content") or "")
                    yield sse_chunk
                elif event_data and event_data.get("type") == "done":
                    answer_ir = AnswerIR.from_chat(
                        answer=full_answer,
                        sources=sources,
                        original_query=request.query,
                        rewritten_query=rewritten_query,
                        query_rewrite=query_rewrite,
                        confidence=confidence,
                        metadata={"knowledge_assets": [
                            {
                                "asset_type": str(asset.get("asset_type") or ""),
                                "id": str(asset.get("id") or ""),
                                "label": str(asset.get("label") or ""),
                                "status": str(asset.get("status") or ""),
                                "retrieval_terms": asset.get("retrieval_terms", []),
                            }
                            for asset in matched_assets
                        ]},
                    )
                    visual_plan = plan_visual_artifacts(
                        question=request.query,
                        answer=full_answer,
                        sources=sources,
                        confidence=confidence,
                        answer_status=answer_ir.status,
                    )
                    visual_plan.metadata["knowledge_assets"] = answer_ir.metadata.get("knowledge_assets", [])
                    done_data = {
                        "type": "done",
                        "sources": sources,
                        "confidence": confidence,
                        "followups": _suggest_followups(request.query, hits),
                        "answer_ir": answer_ir.model_dump(),
                        "visual_plan": visual_plan.model_dump(),
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
