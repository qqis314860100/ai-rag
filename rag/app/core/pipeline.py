import time
import logging
from .config import config
from ..parsers.base import ParserRegistry
from ..parsers.markdown import MarkdownParser
from ..parsers.text import TxtParser
from ..parsers.pdf import PdfParser
from ..parsers.docx import DocxParser
from ..chunking.chunker import chunk_document, Chunk
from ..cleaning.cleaner import clean_parsed_document
from ..embedding.service import embed_query
from ..retrieval.vector_store import search, upsert_chunks, delete_by_document
from ..llm.client import chat as llm_chat
from ..llm.prompt_builder import (
    build_messages,
    extract_sources,
    format_chunks_for_debug,
)

logger = logging.getLogger(__name__)

# Register parsers
ParserRegistry.register(".md", MarkdownParser())
ParserRegistry.register(".markdown", MarkdownParser())
ParserRegistry.register(".txt", TxtParser())
ParserRegistry.register(".pdf", PdfParser())
ParserRegistry.register(".docx", DocxParser())


class RagPipeline:
    def __init__(self):
        self.config = config

    def ingest_document(
        self, document_id: str, file_path: str, metadata: dict | None = None
    ) -> dict:
        start = time.time()
        meta = metadata or {}

        # 1. Parse document
        parser = ParserRegistry.get(file_path)
        parsed = parser.parse(file_path, document_id, meta)

        # 2. Clean
        parsed = clean_parsed_document(parsed)

        # 3. Chunk
        chunks = chunk_document(parsed)

        # 4. Attach metadata to each chunk
        for c in chunks:
            c.metadata.update({
                "status": "active",
                "security_level": meta.get("security_level", "internal"),
                "category": meta.get("category", ""),
                "tags": meta.get("tags", []),
                "process": meta.get("process", ""),
                "station": meta.get("station", ""),
                "version": meta.get("version", "v1.0"),
            })

        # 5. Delete old chunks + upsert new
        delete_by_document(document_id)
        chunk_count = upsert_chunks(chunks)

        total_ms = int((time.time() - start) * 1000)
        logger.info(f"Ingested {document_id}: {chunk_count} chunks in {total_ms}ms")

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
        self, query: str, top_k: int,
        allowed_security_levels: list[str],
        filters: dict | None = None,
    ) -> dict:
        start = time.time()

        # 1. Embed query
        q_embedding = embed_query(query)

        # 2. Search ChromaDB
        hits = search(
            query_embedding=q_embedding,
            allowed_security_levels=allowed_security_levels,
            top_k=top_k,
            filters=filters,
        )

        latency_ms = int((time.time() - start) * 1000)

        return {
            "query": query,
            "results": hits,
            "latency_ms": latency_ms,
        }

    def debug_search(
        self, query: str, top_k: int,
        allowed_security_levels: list[str],
        filters: dict | None = None,
        include_prompt: bool = False,
    ) -> dict:
        # Run search
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
            from ..llm.prompt_builder import build_messages
            messages = build_messages(query, hits)
            prompt_preview = "\n\n".join(
                f"[{m['role']}]\n{m['content'][:500]}..." if len(m['content']) > 500 else f"[{m['role']}]\n{m['content']}"
                for m in messages
            )
            context_chars = sum(len(c.get("content", "")) for c in hits)
            estimated_tokens = context_chars // 2  # rough estimate

        return {
            "query": query,
            "normalized_query": query,
            "filters": filters or {},
            "retrieval": {
                "mode": "vector",
                "top_k": top_k,
                "latency_ms": search_result["latency_ms"],
                "results": hits,
            },
            "prompt_preview": prompt_preview,
            "context_chars": context_chars,
            "estimated_tokens": estimated_tokens,
        }

    def chat(
        self, query: str, top_k: int,
        allowed_security_levels: list[str],
        filters: dict | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> dict:
        total_start = time.time()

        # 0. Query rewrite for chapter/number patterns
        rewritten_query = _rewrite_query(query)

        # 1. Search for relevant context (use rewritten query)
        search_start = time.time()
        search_result = self.search(
            query=rewritten_query,
            top_k=top_k,
            allowed_security_levels=allowed_security_levels,
            filters=filters,
        )
        retrieval_ms = int((time.time() - search_start) * 1000)

        hits = search_result["results"]

        # 1.5 Keyword-aware rerank: boost chunks matching query keywords
        hits = _keyword_rerank(query, hits)

        # 2. Build prompt
        messages = build_messages(query, hits, history, self.config.rag_max_context_chars)

        # 3. Call LLM
        llm_start = time.time()
        llm_result = llm_chat(messages, temperature=self.config.rag_temperature)
        llm_ms = llm_result["latency_ms"]

        # 4. Extract sources
        sources = extract_sources(hits)

        total_ms = int((time.time() - total_start) * 1000)

        return {
            "message_id": "",
            "answer": llm_result["content"],
            "sources": sources,
            "confidence": _estimate_confidence(hits),
            "followups": _suggest_followups(query, hits),
            "trace": {
                "retrieval_ms": retrieval_ms,
                "llm_ms": llm_ms,
                "total_ms": total_ms,
            },
        }


def _estimate_confidence(hits: list[dict]) -> float:
    if not hits:
        return 0.0
    top_scores = [h.get("score", 0) for h in hits[:3] if h.get("score", 0) > 0]
    if not top_scores:
        return 0.3
    avg = sum(top_scores) / len(top_scores)
    return round(min(avg, 1.0), 2)


def _rewrite_query(query: str) -> str:
    """Expand chapter numbers and key terms for better retrieval."""
    import re
    parts = [query]
    # "第5章" → add "5" "5. 安全" variants
    m = re.search(r"第\s*(\d+)\s*章", query)
    if m:
        num = m.group(1)
        parts.append(f"{num}")
        parts.append(f"章节 {num}")
    # "第五章" → same
    m = re.search(r"第\s*([一二三四五六七八九十]+)\s*章", query)
    if m:
        cn_map = {"一":"1","二":"2","三":"3","四":"4","五":"5","六":"6","七":"7","八":"8","九":"9","十":"10"}
        num = cn_map.get(m.group(1), "")
        if num:
            parts.append(f"第{num}章")
    return " ".join(parts)


def _keyword_rerank(query: str, hits: list[dict]) -> list[dict]:
    """Boost chunks that contain exact query keywords (simple BM25-like fusion)."""
    import re
    keywords = [w for w in re.split(r"\s+", query) if len(w) >= 1]
    if not keywords or len(hits) <= 1:
        return hits
    for h in hits:
        content = h.get("content", "")
        title = h.get("section_path", "") + " " + h.get("document_title", "")
        keyword_score = sum(1 for kw in keywords if kw.lower() in (content + title).lower())
        # Fuse: 70% vector + 30% keyword boost
        vector_score = h.get("score", 0)
        keyword_boost = min(keyword_score / max(len(keywords), 1), 1.0) * 0.3
        h["score"] = round(vector_score * 0.7 + keyword_boost, 4)
    return sorted(hits, key=lambda h: h.get("score", 0), reverse=True)


def _suggest_followups(query: str, hits: list[dict]) -> list[str]:
    if not hits:
        return []
    suggestions: list[str] = []
    titles = set()
    for h in hits[:3]:
        title = h.get("document_title", "")
        if title and title not in titles:
            suggestions.append(f"请详细介绍《{title}》的内容")
            titles.add(title)
    return suggestions[:3]
