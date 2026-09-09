import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from ..artifacts import (
    DiagramIR,
    KnowledgeGapClusterRequest,
    KnowledgeGapClusterResult,
    build_image_artifact_contract,
    build_knowledge_gap_cluster_drafts,
    build_llm_diagram_ir,
    plan_visual_artifacts,
)
from ..artifacts.knowledge_graph import build_lightweight_knowledge_graph
from ..core.config import config
from ..core.pipeline import (
    REFUSAL_ANSWER,
    RagPipeline,
    _assess_insufficient_context,
    _build_confidence_profile,
    _enrich_query_understanding_with_recall,
    _keyword_rerank,
    _knowledge_asset_trace,
    _rewrite_query_with_trace,
    _select_knowledge_assets,
    _suggest_followups,
)
from ..core.pipeline.answer_verification import verify_answer_ir
from ..core.terminology import list_term_entries, terminology_contract
from ..extraction.asset_extractor import extract_asset_metadata
from ..llm.usage_guard import LlmBudgetExceeded, usage_summary
from ..schemas.models import (
    AnswerIR,
    ChatRequest,
    ChatResult,
    DebugSearchRequest,
    DebugSearchResult,
    DiagramGenerateRequest,
    ExtractionResult,
    ImageArtifactContract,
    ImageArtifactContractRequest,
    IngestRequest,
    IngestResult,
    KnowledgeGraphPlanRequest,
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

def _budget_exceeded_http_error(error: LlmBudgetExceeded) -> HTTPException:
    return HTTPException(status_code=429, detail=error.as_detail())


def verify_api_key(request: Request) -> None:
    """配置了 RAG_API_KEY 时，所有 /rag 端点必须携带服务密钥。

    X-Service-Key 是外部 AI 能力服务（ep）约定的鉴权头，X-API-Key 为存量
    API 网关头；迁移期两者兼容，后续收敛为统一键时只保留其一。
    """
    if not config.rag_api_key:
        return
    provided = request.headers.get("X-Service-Key") or request.headers.get("X-API-Key", "")
    if provided != config.rag_api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _ep_citation_refs(sources: list[dict]) -> list[dict]:
    """把检索来源映射为 ep ChatCitations.refs 契约字段（docId/location/excerpt/inScope）。"""
    refs: list[dict] = []
    for source in sources or []:
        doc_id = str(source.get("document_id") or source.get("chunk_id") or "")
        location = str(source.get("section_path") or "")
        if not location and source.get("page_number"):
            location = f"第{source.get('page_number')}页"
        excerpt = str(source.get("snippet") or source.get("content") or "")[:200]
        refs.append({
            "docId": doc_id,
            "location": location,
            "excerpt": excerpt,
            "inScope": True,
        })
    return refs


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


@router.get("/terminology/contract", dependencies=[Depends(verify_api_key)])
def get_terminology_contract():
    return {
        "contract": terminology_contract(),
        "terms": list_term_entries(),
    }


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


def _require_ingest_source(request: IngestRequest) -> tuple[str, str]:
    """解析 (document_id, file_path)，兼容存量与 ep DocumentRequest 形态。

    ep 请求只带 namespace/targetType/targetId/title/scopes（文件字节运输方案
    联调期定），当前仍需 file_path 指向本地暂存文件才能解析入库。
    """
    document_id = (request.document_id or "").strip()
    if not document_id and request.target_id is not None:
        document_id = f"{request.namespace or 'ep'}:{request.target_type or 'doc'}:{request.target_id}"
    file_path = (request.file_path or "").strip()
    if not file_path:
        raise HTTPException(
            status_code=400,
            detail="file_path 缺失：文件字节运输方案未定，联调期需先提供本地暂存文件路径",
        )
    if not document_id:
        raise HTTPException(
            status_code=400,
            detail="document_id 缺失：请提供 document_id 或 ep 契约的 targetId",
        )
    return document_id, file_path


@router.post("/documents/ingest", response_model=IngestResult, dependencies=[Depends(verify_api_key)])
def ingest(request: IngestRequest):
    try:
        document_id, file_path = _require_ingest_source(request)
        result = pipeline.ingest_document(
            document_id=document_id,
            file_path=file_path,
            metadata=request.metadata,
            namespace=request.namespace or None,
            scopes=request.scopes or None,
        )
        return result
    except ValueError as e:
        # Client errors (bad path, unsupported type) — safe to echo
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception(f"Ingest failed for {request.document_id}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/extract", response_model=ExtractionResult, dependencies=[Depends(verify_api_key)])
def extract_metadata(request: IngestRequest):
    """AI 能力服务编目元数据抽取（复用 解析→切分→抽取 链路）。

    请求与 /documents/ingest 同形态；输出与 ep AiCapabilityClient.ExtractionResult
    逐字段对齐（空字段语义 ""/[]/0.0）。抽取计入 usage_guard 预算；内容不足时
    返回空字段结果而非编造建议。
    """
    try:
        document_id, file_path = _require_ingest_source(request)
        result = extract_asset_metadata(
            document_id=document_id,
            file_path=file_path,
            title=request.title,
            scopes=request.scopes or None,
            target_type=request.target_type,
        )
        return result
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except LlmBudgetExceeded as e:
        raise _budget_exceeded_http_error(e)
    except Exception:
        logger.exception(f"Extract failed for {request.title or request.target_id}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/documents/reindex", response_model=ReindexResult, dependencies=[Depends(verify_api_key)])
def reindex(request: ReindexRequest):
    try:
        result = pipeline.reindex_document(
            document_id=request.document_id,
            file_path=request.file_path,
            metadata=request.metadata,
            namespace=request.namespace or None,
            scopes=request.scopes or None,
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
            namespace=request.namespace or None,
            scopes=request.scopes or None,
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
            namespace=request.namespace or None,
            scopes=request.scopes or None,
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
            knowledge_assets=request.knowledge_assets,
            namespace=request.namespace or None,
            scopes=request.scopes or None,
        )
        return result
    except LlmBudgetExceeded as e:
        raise _budget_exceeded_http_error(e)
    except Exception:
        logger.exception("Chat failed")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/diagram/generate", response_model=DiagramIR, dependencies=[Depends(verify_api_key)])
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
    except LlmBudgetExceeded as e:
        raise _budget_exceeded_http_error(e)
    except Exception as e:
        logger.exception("Diagram generation failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/artifacts/image/contract", response_model=ImageArtifactContract, dependencies=[Depends(verify_api_key)])
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


@router.post("/knowledge/graph/plan", dependencies=[Depends(verify_api_key)])
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


@router.post("/knowledge-gaps/cluster-drafts", response_model=KnowledgeGapClusterResult, dependencies=[Depends(verify_api_key)])
def knowledge_gap_cluster_drafts(request: KnowledgeGapClusterRequest):
    try:
        return build_knowledge_gap_cluster_drafts(request)
    except Exception as e:
        logger.exception("Knowledge gap clustering failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream", dependencies=[Depends(verify_api_key)])
def chat_stream(request: ChatRequest, req: Request):
    """Streaming chat endpoint using SSE.

    - 存量调用（X-API-Key 或不带服务键头）：保持 stage/meta/token/done/error 事件序，
      电池语料 UI/API 行为不变；
    - ep 能力服务（带 X-Service-Key）：事件序对齐契约 meta → delta* → citations → done
      （或 error），citations.refs 含 docId/location/excerpt/inScope 字段。
    """
    ep_mode = bool(req.headers.get("X-Service-Key"))

    def _sse_json(obj: dict) -> str:
        return json.dumps(obj, ensure_ascii=False)

    def _sse(obj: dict) -> str:
        return f"data: {_sse_json(obj)}\n\n"

    async def generate():
        try:
            if not ep_mode:
                yield _sse({'type': 'stage', 'stage': 'accepted', 'message': 'RAG 流式请求已接收。'})
            # 1. Search
            matched_assets = _select_knowledge_assets(request.query, request.knowledge_assets)
            query_rewrite = _rewrite_query_with_trace(request.query, request.history, matched_assets)
            rewritten_query = query_rewrite.rewritten_query
            search_result = pipeline.search(
                query=rewritten_query,
                top_k=request.top_k,
                allowed_security_levels=request.allowed_security_levels,
                filters=request.filters,
                namespace=request.namespace or None,
                scopes=request.scopes or None,
            )

            hits = search_result["results"]
            if rewritten_query != request.query:
                hits = _keyword_rerank(f"{request.query} {rewritten_query}", hits, request.filters)
            query_rewrite = _enrich_query_understanding_with_recall(
                query_rewrite,
                history=request.history,
                recall_hits=hits,
            )

            # Send search metadata
            if ep_mode:
                yield _sse({'type': 'meta', 'sessionId': request.session_id or '', 'messageId': ''})
            else:
                yield _sse({'type': 'meta', 'retrieval_ms': search_result['latency_ms'], 'hit_count': len(hits), 'query_rewrite': query_rewrite.model_dump()})

            from ..llm.prompt_builder import build_messages, extract_sources
            sources = extract_sources(hits)
            confidence_profile = _build_confidence_profile(
                request.query,
                hits,
                filters=request.filters,
                knowledge_assets=matched_assets,
                query_understanding=query_rewrite,
            )
            confidence = confidence_profile["confidence"]
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
                    metadata={
                        **refusal.metadata,
                        "confidence_profile": confidence_profile,
                    },
                )
                if ep_mode:
                    yield _sse({'type': 'delta', 'text': REFUSAL_ANSWER})
                    yield _sse({'type': 'citations', 'refs': []})
                    yield _sse({'type': 'done', 'usage': ''})
                    return
                yield _sse({'type': 'token', 'content': REFUSAL_ANSWER})
                visual_plan = plan_visual_artifacts(
                    question=request.query,
                    answer=REFUSAL_ANSWER,
                    sources=sources,
                    confidence=answer_ir.confidence,
                    answer_status=answer_ir.status,
                )
                visual_plan.metadata["knowledge_assets"] = answer_ir.metadata.get("knowledge_assets", [])
                yield _sse({'type': 'done', 'sources': sources, 'confidence': answer_ir.confidence, 'followups': [], 'answer_ir': answer_ir.model_dump(), 'visual_plan': visual_plan.model_dump()})
                return

            # 2. Build prompt
            messages = build_messages(
                request.query,
                hits,
                request.history,
                pipeline.config.rag_max_context_chars,
                evidence_warnings=refusal.warnings,
            )

            # 3. Stream LLM
            from ..llm.client import chat_stream as llm_stream

            full_answer = ""
            for sse_chunk in llm_stream(messages, temperature=pipeline.config.rag_temperature):
                event_data: dict | None = None
                if sse_chunk.startswith("data: "):
                    try:
                        event_data = json.loads(sse_chunk[len("data: "):].strip())
                    except Exception:  # noqa: BLE001 - 事件解析失败视为普通 chunk
                        event_data = None

                if ep_mode:
                    if event_data and event_data.get("type") == "token":
                        full_answer += str(event_data.get("content") or "")
                        yield _sse({'type': 'delta', 'text': str(event_data.get("content") or "")})
                    elif event_data and event_data.get("type") == "done":
                        answer_ir = AnswerIR.from_chat(
                            answer=full_answer,
                            sources=sources,
                            original_query=request.query,
                            rewritten_query=rewritten_query,
                            query_rewrite=query_rewrite,
                            confidence=confidence,
                            warnings=refusal.warnings,
                            metadata={
                                "knowledge_assets": _knowledge_asset_trace(matched_assets),
                                **refusal.metadata,
                                "confidence_profile": confidence_profile,
                            },
                        )
                        answer_ir = verify_answer_ir(answer_ir, sources=sources, hits=hits)
                        yield _sse({'type': 'citations', 'refs': _ep_citation_refs(sources)})
                        yield _sse({'type': 'done', 'usage': ''})
                    elif event_data and event_data.get("type") == "error":
                        yield _sse({'type': 'error', 'code': str(event_data.get("code") or "LLM_STREAM_ERROR"),
                                    'message': str(event_data.get("message") or "LLM 流式生成失败")})
                    # ep 契约严格：其它未知事件不转发，避免解析器报未知事件
                    continue

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
                        warnings=refusal.warnings,
                        metadata={
                            "knowledge_assets": _knowledge_asset_trace(matched_assets),
                            **refusal.metadata,
                            "confidence_profile": confidence_profile,
                        },
                    )
                    answer_ir = verify_answer_ir(answer_ir, sources=sources, hits=hits)
                    visual_plan = plan_visual_artifacts(
                        question=request.query,
                        answer=full_answer,
                        sources=sources,
                        confidence=answer_ir.confidence,
                        answer_status=answer_ir.status,
                    )
                    visual_plan.metadata["knowledge_assets"] = answer_ir.metadata.get("knowledge_assets", [])
                    done_data = {
                        "type": "done",
                        "sources": sources,
                        "confidence": answer_ir.confidence,
                        "followups": _suggest_followups(request.query, hits),
                        "answer_ir": answer_ir.model_dump(),
                        "visual_plan": visual_plan.model_dump(),
                    }
                    yield _sse(done_data)
                else:
                    yield sse_chunk

        except Exception as e:
            logger.exception("Chat stream failed")
            yield _sse({'type': 'error', 'code': 'INTERNAL_ERROR', 'message': str(e)})

    return StreamingResponse(generate(), media_type="text/event-stream",
                           headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                                   "X-Accel-Buffering": "no"})
