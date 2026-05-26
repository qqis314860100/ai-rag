import time
import logging
import re
from .config import config
from ..parsers.base import ParserRegistry
from ..parsers.markdown import MarkdownParser
from ..parsers.text import TxtParser
from ..parsers.pdf import PdfParser
from ..parsers.docx import DocxParser
from ..parsers.html import HtmlParser
from ..chunking.chunker import chunk_document
from ..cleaning.cleaner import clean_parsed_document
from ..core.source_metadata import infer_content_kind, infer_file_type, infer_mime_type, normalize_source_format
from ..embedding.service import embed_query
from ..retrieval.vector_store import search, upsert_chunks, delete_by_document
from ..llm.client import chat as llm_chat
from ..llm.prompt_builder import (
    build_messages,
    extract_sources,
    format_chunks_for_debug,
)
from ..schemas.models import AnswerIR, AnswerQueryRewrite

logger = logging.getLogger(__name__)

# Register parsers
ParserRegistry.register(".md", MarkdownParser())
ParserRegistry.register(".markdown", MarkdownParser())
ParserRegistry.register(".txt", TxtParser())
ParserRegistry.register(".pdf", PdfParser())
ParserRegistry.register(".docx", DocxParser())
ParserRegistry.register(".html", HtmlParser())
ParserRegistry.register(".htm", HtmlParser())
for _code_ext in (".json", ".js", ".jsx", ".ts", ".tsx", ".css", ".csv", ".xml", ".yaml", ".yml", ".py", ".sh", ".sql"):
    ParserRegistry.register(_code_ext, TxtParser())


class RagPipeline:
    def __init__(self):
        self.config = config

    def ingest_document(
        self, document_id: str, file_path: str, metadata: dict | None = None
    ) -> dict:
        start = time.time()
        meta = _build_ingest_metadata(file_path, metadata)

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
                "source_format": meta.get("source_format", ""),
                "file_type": meta.get("file_type", ""),
                "mime_type": meta.get("mime_type", ""),
                "content_kind": meta.get("content_kind", ""),
                "preview_format": meta.get("preview_format", ""),
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
        hits = _keyword_rerank(query, hits, filters)

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

        # 0. Query rewrite for chapter/number patterns and multi-turn references
        query_rewrite = _rewrite_query_with_trace(query, history)
        rewritten_query = query_rewrite.rewritten_query

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

        # 1.5 Re-apply the original user wording after chapter/number rewrite.
        if rewritten_query != query:
            hits = _keyword_rerank(query, hits, filters)

        # 2. Build prompt
        messages = build_messages(query, hits, history, self.config.rag_max_context_chars)

        # 3. Call LLM
        llm_start = time.time()
        llm_result = llm_chat(messages, temperature=self.config.rag_temperature)
        llm_ms = llm_result["latency_ms"]

        # 4. Extract sources
        sources = extract_sources(hits)
        confidence = _estimate_confidence(query, hits, filters)
        answer_ir = AnswerIR.from_chat(
            answer=llm_result["content"],
            sources=sources,
            original_query=query,
            rewritten_query=rewritten_query,
            query_rewrite=query_rewrite,
            confidence=confidence,
        )

        total_ms = int((time.time() - total_start) * 1000)

        return {
            "message_id": "",
            "answer": llm_result["content"],
            "sources": sources,
            "confidence": confidence,
            "followups": _suggest_followups(query, hits),
            "trace": {
                "retrieval_ms": retrieval_ms,
                "llm_ms": llm_ms,
                "total_ms": total_ms,
            },
            "answer_ir": answer_ir.model_dump(),
        }


def _estimate_confidence(query: str, hits: list[dict], filters: dict | None = None) -> float:
    if not hits:
        return 0.0

    top1 = _clamp_float(hits[0].get("score", 0))
    keyword_score = _keyword_coverage(query, hits[:3])
    context_score = _context_availability_score(hits[:3])
    source_score = _source_count_score(len(hits))
    filter_score = _filter_match_score(filters, hits[:3])

    confidence = (
        top1 * 0.35
        + keyword_score * 0.25
        + context_score * 0.20
        + source_score * 0.10
        + filter_score * 0.10
    )

    if top1 < 0.2:
        confidence = min(confidence, 0.55)
    if keyword_score < 0.2 and top1 < 0.45:
        confidence = min(confidence, 0.60)
    if context_score < 0.5:
        confidence = min(confidence, 0.75)
    if filters and filter_score < 0.5:
        confidence = min(confidence, 0.60)

    return round(_clamp_float(confidence), 2)


def _rewrite_query(query: str) -> str:
    """返回兼容旧调用方的重写查询字符串。"""
    return _rewrite_query_with_trace(query).rewritten_query


def _rewrite_query_with_trace(
    query: str,
    history: list[dict[str, str]] | None = None,
) -> AnswerQueryRewrite:
    """Resolve lightweight multi-turn references before retrieval.

    这里保持规则可解释，避免在检索前引入一次额外 LLM 调用。重写结果会进入
    AnswerIR，便于后续 API 持久化和调试面板展示。
    """
    original_query = _normalize_query_text(query)
    history_turns = _count_history_turns(history)
    topic = _extract_recent_history_topic(history)
    rewritten_query = original_query
    signals: list[str] = []
    strategies: list[str] = []
    reasons: list[str] = []

    if topic:
        signals.append("history_topic")

    if _is_low_information_query(original_query) and not topic:
        return AnswerQueryRewrite(
            original_query=original_query,
            rewritten_query=rewritten_query,
            changed=False,
            strategy="low_information",
            reason="问题信息量过低，且没有可用于补全的历史上下文",
            signals=["low_information"],
            history_turns=history_turns,
        )

    if topic and _has_reference_pronoun(original_query):
        candidate = _replace_reference_with_topic(original_query, topic)
        if candidate != rewritten_query:
            rewritten_query = candidate
            signals.append("pronoun")
            strategies.append("history_pronoun_resolution")
            reasons.append("用最近一轮用户问题补全指代对象")
    elif topic and _is_elliptical_followup(original_query):
        rewritten_query = f"{topic} {original_query}"
        signals.append("ellipsis")
        strategies.append("history_ellipsis_completion")
        reasons.append("用最近一轮用户问题补全省略主题")

    expanded_query, expanded = _expand_chapter_query(rewritten_query)
    if expanded:
        rewritten_query = expanded_query
        signals.append("chapter_number")
        strategies.append("chapter_number_expansion")
        reasons.append("章节编号被展开以提高召回")

    changed = rewritten_query != original_query
    if not strategies and not changed:
        strategies.append("none")
        reasons.append("问题已包含明确主题，无需改写")

    strategy = strategies[0] if len(strategies) == 1 else "compound"
    return AnswerQueryRewrite(
        original_query=original_query,
        rewritten_query=rewritten_query,
        changed=changed,
        strategy=strategy,
        reason="；".join(reasons),
        signals=_dedupe_preserve_order(signals),
        history_turns=history_turns,
    )


def _expand_chapter_query(query: str) -> tuple[str, bool]:
    parts = [query]
    m = re.search(r"第\s*(\d+)\s*章", query)
    if m:
        num = m.group(1)
        parts.append(f"{num}")
        parts.append(f"章节 {num}")
    m = re.search(r"第\s*([一二三四五六七八九十]+)\s*章", query)
    if m:
        cn_map = {"一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9", "十": "10"}
        num = cn_map.get(m.group(1), "")
        if num:
            parts.append(f"第{num}章")
    expanded = " ".join(_dedupe_preserve_order(parts))
    return expanded, expanded != query


def _normalize_query_text(query: str) -> str:
    return re.sub(r"\s+", " ", query).strip()


def _count_history_turns(history: list[dict[str, str]] | None) -> int:
    return sum(1 for item in history or [] if item.get("role") in {"user", "assistant"} and str(item.get("content") or "").strip())


def _extract_recent_history_topic(history: list[dict[str, str]] | None) -> str:
    if not history:
        return ""
    for item in reversed(history[-8:]):
        if item.get("role") != "user":
            continue
        topic = _extract_rewrite_topic(str(item.get("content") or ""))
        if topic:
            return topic
    return ""


def _extract_rewrite_topic(text: str) -> str:
    cleaned = _normalize_query_text(text)
    cleaned = re.sub(r"[？?！!。；;，,、]+", " ", cleaned)
    cleaned = re.sub(r"(请问|请|帮我|帮忙|一下|详细|介绍|说明|列出|查询|告诉我)", " ", cleaned)
    cleaned = re.sub(r"(是什么|有哪些|多少|如何|怎么处理|怎么办|怎么|为什么|是否|吗|呢)\s*$", " ", cleaned)
    cleaned = re.sub(r"(这个|那个|这些|那些|它|其|该|上述|前述|前面|刚才|这里|其中)", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" 的")
    if len(cleaned) < 4:
        return ""
    return cleaned[:40]


def _is_low_information_query(query: str) -> bool:
    cleaned = re.sub(r"[？?！!。；;，,、\s]+", "", query)
    cleaned = re.sub(r"(请问|请|一下|这个|那个|这些|那些|它|其|该|上述|前述|前面|还有|继续|呢|吗|什么|怎么|如何|为什么)", "", cleaned)
    return len(cleaned) < 2


def _has_reference_pronoun(query: str) -> bool:
    return bool(re.search(r"(这个|那个|这些|那些|它|其|该|上述|前述|前面|刚才|这里|其中|\bthis\b|\bthat\b|\bit\b|\bthey\b)", query, re.IGNORECASE))


def _is_elliptical_followup(query: str) -> bool:
    normalized = _normalize_query_text(query)
    if len(re.sub(r"\s+", "", normalized)) <= 14 and re.search(r"(呢|吗|？|\?)$", normalized):
        return True
    return bool(re.search(r"^(还有|另外|继续|再说|展开|那|那么)", normalized))


def _replace_reference_with_topic(query: str, topic: str) -> str:
    normalized = _normalize_query_text(query)
    replaced = re.sub(r"^(这个|那个|这些|那些|它|其|该|上述|前述|前面|刚才|这里|其中)", topic, normalized)
    if replaced != normalized:
        return replaced
    return re.sub(r"(这个|那个|这些|那些|它|其|该|上述|前述|前面|刚才|这里|其中)", topic, normalized, count=1)


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _build_ingest_metadata(file_path: str, metadata: dict | None = None) -> dict:
    source = metadata or {}
    file_type = infer_file_type(
        source.get("file_type"),
        source.get("source_format"),
        source.get("mime_type"),
        file_path=file_path,
    )
    mime_type = source.get("mime_type") or infer_mime_type(file_type)
    content_kind = source.get("content_kind") or infer_content_kind(file_type, mime_type)
    source_format = normalize_source_format(file_type)
    return {
        **source,
        "file_type": file_type,
        "source_format": source_format,
        "mime_type": mime_type,
        "content_kind": content_kind,
        "preview_format": content_kind,
    }


def _keyword_rerank(query: str, hits: list[dict], filters: dict | None = None) -> list[dict]:
    """Boost chunks with exact Chinese/domain term hits in title, section, and body."""
    keywords = _extract_query_terms(query)
    if not keywords or len(hits) <= 1:
        return hits

    for h in hits:
        metadata = h.get("metadata") if isinstance(h.get("metadata"), dict) else {}
        previous_ranking = metadata.get("ranking") if isinstance(metadata.get("ranking"), dict) else {}
        body_text = _hit_text(h, include_content=True)
        title_text = _hit_title_text(h)
        keyword_score = _term_coverage_score(keywords, body_text)
        title_score = _term_coverage_score(keywords, title_text)
        filter_score = _filter_match_score(filters, [h])
        vector_score = _clamp_float(previous_ranking.get("vector_score", h.get("score", 0)))

        fused_score = max(
            vector_score * 0.85,
            vector_score * 0.62 + keyword_score * 0.25 + title_score * 0.10 + filter_score * 0.03,
        )
        h["score"] = round(_clamp_float(fused_score), 4)
        metadata["ranking"] = {
            "vector_score": round(vector_score, 4),
            "keyword_coverage": round(keyword_score, 4),
            "title_coverage": round(title_score, 4),
            "filter_match": round(filter_score, 4),
        }
        h["metadata"] = metadata
    return sorted(hits, key=lambda h: h.get("score", 0), reverse=True)


_QUERY_STOPWORDS = {
    "请问",
    "请",
    "一下",
    "一个",
    "哪些",
    "什么",
    "怎么",
    "如何",
    "为什么",
    "以及",
    "或者",
    "这个",
    "那个",
    "相关",
    "详细",
    "介绍",
    "说明",
    "列出",
    "内容",
    "是",
    "吗",
    "呢",
}


def _extract_query_terms(query: str, limit: int = 18) -> list[str]:
    normalized = re.sub(r"\s+", " ", query).strip()
    terms: set[str] = set()

    for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]{1,}", normalized):
        terms.add(token.lower())

    for phrase in re.findall(r"[\u4e00-\u9fff]{2,}", normalized):
        cleaned = phrase
        for stopword in _QUERY_STOPWORDS:
            cleaned = cleaned.replace(stopword, " ")
        for part in re.split(r"\s+", cleaned):
            if len(part) < 2 or part in _QUERY_STOPWORDS:
                continue
            terms.add(part[:12])
            if len(part) <= 4:
                terms.add(part)
                continue
            for size in (4, 3, 2):
                for index in range(0, len(part) - size + 1):
                    ngram = part[index:index + size]
                    if ngram not in _QUERY_STOPWORDS:
                        terms.add(ngram)

    return sorted(terms, key=lambda term: (-len(term), term))[:limit]


def _keyword_coverage(query: str, hits: list[dict]) -> float:
    terms = _extract_query_terms(query)
    if not terms:
        return 0.5
    return _term_coverage_score(terms, " ".join(_hit_text(hit, include_content=True) for hit in hits))


def _term_coverage_score(terms: list[str], text: str) -> float:
    if not terms:
        return 0.5
    lowered = text.lower()
    total_weight = sum(max(len(term), 2) for term in terms)
    matched_weight = sum(max(len(term), 2) for term in terms if term.lower() in lowered)
    return _clamp_float(matched_weight / max(total_weight, 1))


def _context_availability_score(hits: list[dict]) -> float:
    if not hits:
        return 0.0
    scores: list[float] = []
    for hit in hits:
        source_context = hit.get("source_context") if isinstance(hit.get("source_context"), dict) else {}
        window = str(hit.get("context_window") or source_context.get("window") or "")
        content = str(hit.get("content") or source_context.get("content") or "")
        snippet = str(hit.get("snippet") or source_context.get("snippet") or "")
        if window and len(window) >= len(content):
            scores.append(1.0)
        elif content:
            scores.append(0.75)
        elif snippet:
            scores.append(0.45)
        else:
            scores.append(0.0)
    return round(sum(scores) / len(scores), 4)


def _source_count_score(count: int) -> float:
    if count >= 3:
        return 1.0
    if count == 2:
        return 0.75
    if count == 1:
        return 0.55
    return 0.0


def _filter_match_score(filters: dict | None, hits: list[dict]) -> float:
    meaningful_filters = {key: value for key, value in (filters or {}).items() if value not in (None, "", [], {})}
    if not meaningful_filters:
        return 0.7
    if not hits:
        return 0.0

    matched = 0
    total = 0
    for key, expected in meaningful_filters.items():
        for hit in hits:
            metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
            actual = hit.get(key, metadata.get(key))
            total += 1
            if _value_matches_filter(actual, expected):
                matched += 1
    return _clamp_float(matched / max(total, 1))


def _value_matches_filter(actual, expected) -> bool:
    if isinstance(expected, list):
        return any(_value_matches_filter(actual, item) for item in expected)
    if actual is None:
        return False
    actual_text = str(actual).lower()
    expected_text = str(expected).lower()
    return actual_text == expected_text or expected_text in actual_text


def _hit_title_text(hit: dict) -> str:
    return " ".join(
        str(hit.get(key, ""))
        for key in ("document_title", "section_path", "category", "document_type", "source_format")
    )


def _hit_text(hit: dict, include_content: bool = False) -> str:
    parts = [_hit_title_text(hit), str(hit.get("snippet", ""))]
    if include_content:
        parts.append(str(hit.get("content", "")))
        parts.append(str(hit.get("context_window", "")))
    return " ".join(parts)


def _clamp_float(value, minimum: float = 0.0, maximum: float = 1.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return minimum
    return max(minimum, min(maximum, number))


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
