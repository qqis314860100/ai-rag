import logging
import time

from ...chunking.chunker import chunk_document
from ...cleaning.cleaner import clean_parsed_document
from ...embedding.service import embed_query
from ...llm.client import chat as llm_chat
from ...llm.prompt_builder import build_messages, extract_sources
from ...parsers.base import ParserRegistry
from ...parsers.docx import DocxParser
from ...parsers.html import HtmlParser
from ...parsers.markdown import MarkdownParser
from ...parsers.pdf import PdfParser
from ...parsers.text import TxtParser
from ...retrieval.vector_store import delete_by_document, search, upsert_chunks
from ..config import config
from ..logging_safety import safe_log_json, sha256_short
from ..terminology import expand_query_with_terms
from .generate import (
    _build_answer_chat_result,
    _build_refusal_chat_result,
    _suggest_followups,
)
from .refusal import (
    MIN_ANSWER_CONFIDENCE,
    REFUSAL_ANSWER,
    EvidenceAssessment,
    _assess_insufficient_context,
)
from .retrieve import (
    _build_confidence_profile,
    _build_ingest_metadata,
    _estimate_confidence,
    _extract_query_terms,
    _keyword_rerank,
    rerank_hits,
)
from .rewrite import (
    _enrich_query_understanding_with_recall,
    _knowledge_asset_trace,
    _rewrite_query,
    _rewrite_query_with_trace,
    _select_knowledge_assets,
    _term_expansion_hits_dump,
)

logger = logging.getLogger(__name__)


ParserRegistry.register(".md", MarkdownParser())
ParserRegistry.register(".markdown", MarkdownParser())
ParserRegistry.register(".txt", TxtParser())
ParserRegistry.register(".pdf", PdfParser())
ParserRegistry.register(".docx", DocxParser())


def _validate_file_path(file_path: str) -> str:
    """拒绝 allowed_dirs 之外的路径，防止通过 file_path 参数读取任意文件。"""
    from pathlib import Path

    resolved = Path(file_path).expanduser().resolve()
    allowed_roots = [Path(d).expanduser().resolve() for d in config.rag_allowed_dirs if d]
    if not allowed_roots:
        raise ValueError("No allowed ingest directories configured")
    if not resolved.is_file():
        raise ValueError(f"File not found or not a regular file: {file_path}")
    if not any(resolved == root or resolved.is_relative_to(root) for root in allowed_roots):
        raise ValueError(f"Path outside allowed directories: {file_path}")
    return str(resolved)
ParserRegistry.register(".html", HtmlParser())
ParserRegistry.register(".htm", HtmlParser())
for _code_ext in (
    ".json",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".css",
    ".csv",
    ".xml",
    ".yaml",
    ".yml",
    ".py",
    ".sh",
    ".sql",
):
    ParserRegistry.register(_code_ext, TxtParser())


def _elapsed_ms(start: float) -> int:
    return int((time.time() - start) * 1000)


class RagPipeline:
    def __init__(self):
        self.config = config

    def ingest_document(
        self, document_id: str, file_path: str, metadata: dict | None = None
    ) -> dict:
        start = time.time()
        meta = _build_ingest_metadata(file_path, metadata)

        # 路径包含校验：仅允许白名单目录（data/uploads、knowledge）
        safe_path = _validate_file_path(file_path)
        parser = ParserRegistry.get(safe_path)
        parsed = parser.parse(safe_path, document_id, meta)
        parsed = clean_parsed_document(parsed)
        chunks = chunk_document(parsed)

        for c in chunks:
            c.metadata.update({
                "status": "active",
                "security_level": meta.get("security_level", "internal"),
                "category": meta.get("category", ""),
                "tags": meta.get("tags", []),
                "process": meta.get("process", ""),
                "station": meta.get("station", ""),
                "version": meta.get("version", "v1.0"),
                "source_format": meta.get("source_format", ""),
                "file_type": meta.get("file_type", ""),
                "mime_type": meta.get("mime_type", ""),
                "content_kind": meta.get("content_kind", ""),
                "preview_format": meta.get("preview_format", ""),
            })

        delete_by_document(document_id)
        chunk_count = upsert_chunks(chunks)

        total_ms = int((time.time() - start) * 1000)
        logger.info(
            "rag_ingest_completed %s",
            safe_log_json({
                "document_id_hash": sha256_short(document_id),
                "chunk_count": chunk_count,
                "duration_ms": total_ms,
            }),
        )

        return {
            "document_id": document_id,
            "chunk_count": chunk_count,
            "index_status": "ready",
        }

    def reindex_document(
        self, document_id: str, file_path: str, metadata: dict | None = None
    ) -> dict:
        return self.ingest_document(document_id, file_path, metadata)

    def search(
        self,
        query: str,
        top_k: int,
        allowed_security_levels: list[str],
        filters: dict | None = None,
    ) -> dict:
        start = time.time()
        term_expansion = expand_query_with_terms(query)
        retrieval_query = term_expansion.expanded_query
        term_expansion_hits = _term_expansion_hits_dump(term_expansion)
        candidate_top_k = max(top_k, min(top_k * 3, 30))

        q_embedding = embed_query(retrieval_query)
        hits = search(
            query_embedding=q_embedding,
            allowed_security_levels=allowed_security_levels,
            top_k=candidate_top_k,
            filters=filters,
        )
        rerank_result = rerank_hits(
            retrieval_query,
            hits,
            filters,
            term_expansion_hits=term_expansion_hits,
            top_k=top_k,
        )
        hits = rerank_result["results"]

        latency_ms = int((time.time() - start) * 1000)

        return {
            "query": query,
            "expanded_query": retrieval_query,
            "term_expansion_hits": term_expansion_hits,
            "rerank_trace": rerank_result["trace"],
            "results": hits,
            "latency_ms": latency_ms,
        }

    def debug_search(
        self,
        query: str,
        top_k: int,
        allowed_security_levels: list[str],
        filters: dict | None = None,
        include_prompt: bool = False,
    ) -> dict:
        search_result = self.search(
            query=query,
            top_k=top_k,
            allowed_security_levels=allowed_security_levels,
            filters=filters,
        )

        hits = search_result["results"]
        prompt_preview = ""
        context_chars = 0
        estimated_tokens = 0

        if include_prompt and hits:
            messages = build_messages(query, hits)
            prompt_preview = "\n\n".join(
                f"[{m['role']}]\n{m['content'][:500]}..."
                if len(m["content"]) > 500
                else f"[{m['role']}]\n{m['content']}"
                for m in messages
            )
            context_chars = sum(len(c.get("content", "")) for c in hits)
            estimated_tokens = context_chars // 2

        return {
            "query": query,
            "normalized_query": search_result.get("expanded_query") or query,
            "filters": filters or {},
            "retrieval": {
                "mode": "hybrid",
                "top_k": top_k,
                "latency_ms": search_result["latency_ms"],
                "term_expansion_hits": search_result.get("term_expansion_hits", []),
                "rerank_trace": search_result.get("rerank_trace", {}),
                "results": hits,
            },
            "prompt_preview": prompt_preview,
            "context_chars": context_chars,
            "estimated_tokens": estimated_tokens,
        }

    def chat(
        self,
        query: str,
        top_k: int,
        allowed_security_levels: list[str],
        filters: dict | None = None,
        history: list[dict[str, str]] | None = None,
        knowledge_assets: list[dict] | None = None,
    ) -> dict:
        total_start = time.time()
        stage_timings_ms: dict[str, int] = {}

        rewrite_start = time.time()
        matched_assets = _select_knowledge_assets(query, knowledge_assets)

        query_rewrite = _rewrite_query_with_trace(query, history, matched_assets)
        rewritten_query = query_rewrite.rewritten_query
        stage_timings_ms["rewrite_ms"] = _elapsed_ms(rewrite_start)

        search_start = time.time()
        search_result = self.search(
            query=rewritten_query,
            top_k=top_k,
            allowed_security_levels=allowed_security_levels,
            filters=filters,
        )
        retrieval_ms = _elapsed_ms(search_start)
        stage_timings_ms["retrieve_ms"] = retrieval_ms
        hits = search_result["results"]

        # 原问题和扩展 query 一起参与关键词融合，保留用户原词和术语别名命中。
        if rewritten_query != query:
            hits = _keyword_rerank(f"{query} {rewritten_query}", hits, filters)
        query_rewrite = _enrich_query_understanding_with_recall(
            query_rewrite,
            history=history,
            recall_hits=hits,
        )

        sources = extract_sources(hits)
        confidence_profile = _build_confidence_profile(
            query,
            hits,
            filters=filters,
            knowledge_assets=matched_assets,
            query_understanding=query_rewrite,
        )
        confidence = confidence_profile["confidence"]
        refusal_start = time.time()
        refusal = _assess_insufficient_context(
            query=query,
            query_rewrite=query_rewrite,
            hits=hits,
            sources=sources,
            confidence=confidence,
            knowledge_assets=matched_assets,
        )
        stage_timings_ms["refusal_ms"] = _elapsed_ms(refusal_start)
        if refusal.should_refuse:
            result = _build_refusal_chat_result(
                query=query,
                rewritten_query=rewritten_query,
                query_rewrite=query_rewrite,
                hits=hits,
                sources=sources,
                confidence=confidence,
                refusal=refusal,
                retrieval_ms=retrieval_ms,
                llm_ms=0,
                stage_timings_ms=stage_timings_ms,
                total_start=total_start,
                knowledge_assets=matched_assets,
                confidence_profile=confidence_profile,
            )
            logger.info("rag_pipeline_timing %s", safe_log_json(result["trace"].get("stage_timings_ms", {})))
            return result

        result = _build_answer_chat_result(
            query=query,
            rewritten_query=rewritten_query,
            query_rewrite=query_rewrite,
            hits=hits,
            sources=sources,
            confidence=confidence,
            retrieval_ms=retrieval_ms,
            stage_timings_ms=stage_timings_ms,
            total_start=total_start,
            history=history,
            knowledge_assets=matched_assets,
            max_context_chars=self.config.rag_max_context_chars,
            temperature=self.config.rag_temperature,
            llm_chat_fn=llm_chat,
            evidence_warnings=refusal.warnings,
            evidence_metadata=refusal.metadata,
            confidence_profile=confidence_profile,
        )
        logger.info("rag_pipeline_timing %s", safe_log_json(result["trace"].get("stage_timings_ms", {})))
        return result


__all__ = [
    "MIN_ANSWER_CONFIDENCE",
    "REFUSAL_ANSWER",
    "EvidenceAssessment",
    "RagPipeline",
    "_assess_insufficient_context",
    "_build_confidence_profile",
    "_build_ingest_metadata",
    "_enrich_query_understanding_with_recall",
    "_estimate_confidence",
    "_extract_query_terms",
    "_keyword_rerank",
    "_knowledge_asset_trace",
    "_rewrite_query",
    "_rewrite_query_with_trace",
    "_select_knowledge_assets",
    "_suggest_followups",
    "embed_query",
    "llm_chat",
    "rerank_hits",
    "search",
]
