import logging
import time
from pathlib import Path

from ..chunking.chunker import chunk_document
from ..cleaning.cleaner import clean_parsed_document
from ..embedding.service import embed_query
from ..llm.client import chat as llm_chat
from ..llm.prompt_builder import (
    build_messages,
    extract_sources,
)
from ..parsers.base import ParserRegistry
from ..parsers.docx import DocxParser
from ..parsers.markdown import MarkdownParser
from ..parsers.pdf import PdfParser
from ..parsers.text import TxtParser
from ..retrieval.vector_store import delete_by_document, search, upsert_chunks
from .config import config

logger = logging.getLogger(__name__)

# Register parsers
ParserRegistry.register(".md", MarkdownParser())
ParserRegistry.register(".markdown", MarkdownParser())
ParserRegistry.register(".txt", TxtParser())
ParserRegistry.register(".pdf", PdfParser())
ParserRegistry.register(".docx", DocxParser())


def _validate_file_path(file_path: str) -> str:
    """Reject paths outside the configured allowed directories.

    The ingest endpoints receive file paths from the API gateway; without a
    containment check an attacker who can reach the RAG service directly could
    read arbitrary files from the host and vectorize them.
    """
    resolved = Path(file_path).expanduser().resolve()
    allowed_roots = [Path(d).expanduser().resolve() for d in config.rag_allowed_dirs if d]
    if not allowed_roots:
        raise ValueError("No allowed ingest directories configured")
    if not resolved.is_file():
        raise ValueError(f"File not found or not a regular file: {file_path}")
    if not any(resolved == root or resolved.is_relative_to(root) for root in allowed_roots):
        raise ValueError(f"Path outside allowed directories: {file_path}")
    return str(resolved)


class RagPipeline:
    def __init__(self):
        self.config = config

    def ingest_document(
        self, document_id: str, file_path: str, metadata: dict | None = None
    ) -> dict:
        start = time.time()
        meta = metadata or {}

        # 1. Parse document (path containment check first)
        safe_path = _validate_file_path(file_path)
        parser = ParserRegistry.get(safe_path)
        parsed = parser.parse(safe_path, document_id, meta)

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

    def retrieve(
        self, query: str, top_k: int,
        allowed_security_levels: list[str],
        filters: dict | None = None,
    ) -> dict:
        """Shared retrieval for chat/search: rewrite → embed → search → rerank.

        Both the streaming and non-streaming chat paths must go through here so
        they produce consistent results.
        """
        start = time.time()

        # 0. Query rewrite for chapter/number patterns
        rewritten_query = _rewrite_query(query)

        # 1. Embed + search
        q_embedding = embed_query(rewritten_query)
        hits = search(
            query_embedding=q_embedding,
            allowed_security_levels=allowed_security_levels,
            top_k=top_k,
            filters=filters,
        )

        # 2. Keyword-aware rerank: boost chunks matching query keywords
        hits = _keyword_rerank(query, hits)

        latency_ms = int((time.time() - start) * 1000)
        return {"results": hits, "latency_ms": latency_ms}

    def search(
        self, query: str, top_k: int,
        allowed_security_levels: list[str],
        filters: dict | None = None,
    ) -> dict:
        result = self.retrieve(
            query=query,
            top_k=top_k,
            allowed_security_levels=allowed_security_levels,
            filters=filters,
        )
        return {
            "query": query,
            "results": result["results"],
            "latency_ms": result["latency_ms"],
        }

    def debug_search(
        self, query: str, top_k: int,
        allowed_security_levels: list[str],
        filters: dict | None = None,
        include_prompt: bool = False,
    ) -> dict:
        # Run search
        search_result = self.retrieve(
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

        # 1. Retrieve context (rewrite + rerank applied inside)
        search_result = self.retrieve(
            query=query,
            top_k=top_k,
            allowed_security_levels=allowed_security_levels,
            filters=filters,
        )
        retrieval_ms = search_result["latency_ms"]
        hits = search_result["results"]

        # 2. Build prompt
        messages = build_messages(query, hits, history, self.config.rag_max_context_chars)

        # 3. Call LLM
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
