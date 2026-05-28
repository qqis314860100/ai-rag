import math
import re

from ..source_metadata import (
    infer_content_kind,
    infer_file_type,
    infer_mime_type,
    normalize_source_format,
)


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


def _estimate_confidence(query: str, hits: list[dict], filters: dict | None = None, knowledge_assets: list[dict] | None = None) -> float:
    if not hits:
        return 0.0

    top1 = _clamp_float(hits[0].get("score", 0))
    keyword_score = _keyword_coverage(query, hits[:3])
    context_score = _context_availability_score(hits[:3])
    source_score = _source_count_score(len(hits))
    filter_score = _filter_match_score(filters, hits[:3])
    asset_score = min(1.0, len(knowledge_assets or []) / 3)

    confidence = (
        top1 * 0.32
        + keyword_score * 0.25
        + context_score * 0.20
        + source_score * 0.10
        + filter_score * 0.08
        + asset_score * 0.05
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


_HYBRID_SIGNAL_WEIGHTS = {
    "vector_recall": 0.38,
    "keyword_bm25": 0.22,
    "title_hit": 0.12,
    "section_hit": 0.10,
    "term_hit": 0.10,
    "document_filter_hit": 0.08,
}


def _keyword_rerank(
    query: str,
    hits: list[dict],
    filters: dict | None = None,
    term_expansion_hits: list[dict] | None = None,
) -> list[dict]:
    """Hybrid retrieval scoring over vector candidates, with auditable signals."""
    keywords = _extract_query_terms(query)
    if not hits:
        return hits

    bm25_scores = _bm25_scores(keywords, hits)
    for index, h in enumerate(hits):
        metadata = h.get("metadata") if isinstance(h.get("metadata"), dict) else {}
        previous_ranking = metadata.get("ranking") if isinstance(metadata.get("ranking"), dict) else {}
        body_text = _hit_text(h, include_content=True)
        keyword_score = _signal_coverage_score(keywords, body_text)
        bm25_score = bm25_scores[index] if index < len(bm25_scores) else 0.0
        keyword_bm25_score = max(keyword_score, bm25_score)
        title_score = _signal_coverage_score(keywords, _hit_document_title_text(h))
        section_score = _signal_coverage_score(keywords, _hit_section_text(h))
        term_score = _term_hit_score(term_expansion_hits, h)
        if term_expansion_hits is None:
            term_score = _clamp_float(previous_ranking.get("term_match", 0))
        filter_score = _filter_match_score(filters, [h])
        vector_score = _clamp_float(previous_ranking.get("vector_score", h.get("score", 0)))

        hybrid_score = (
            vector_score * _HYBRID_SIGNAL_WEIGHTS["vector_recall"]
            + keyword_bm25_score * _HYBRID_SIGNAL_WEIGHTS["keyword_bm25"]
            + title_score * _HYBRID_SIGNAL_WEIGHTS["title_hit"]
            + section_score * _HYBRID_SIGNAL_WEIGHTS["section_hit"]
            + term_score * _HYBRID_SIGNAL_WEIGHTS["term_hit"]
            + filter_score * _HYBRID_SIGNAL_WEIGHTS["document_filter_hit"]
        )
        vector_floor = vector_score * (0.85 if not keywords else 0.35)
        fused_score = max(vector_floor, hybrid_score)
        fused_score = _clamp_float(fused_score)

        signals = _build_retrieval_signals(
            vector_score=vector_score,
            keyword_score=keyword_bm25_score,
            bm25_score=bm25_score,
            title_score=title_score,
            section_score=section_score,
            term_score=term_score,
            filter_score=filter_score,
            filters=filters,
        )
        h["score"] = round(_clamp_float(fused_score), 4)
        metadata["ranking"] = {
            "vector_score": round(vector_score, 4),
            "keyword_coverage": round(keyword_score, 4),
            "bm25_score": round(bm25_score, 4),
            "keyword_bm25": round(keyword_bm25_score, 4),
            "title_coverage": round(title_score, 4),
            "section_coverage": round(section_score, 4),
            "term_match": round(term_score, 4),
            "filter_match": round(filter_score, 4),
            "hybrid_score": round(fused_score, 4),
            "signal_weights": _HYBRID_SIGNAL_WEIGHTS,
            "scoring_version": "hybrid_v1",
        }
        metadata["retrieval_signals"] = signals
        metadata["retrieval_mode"] = "hybrid"
        h["metadata"] = metadata
    return sorted(hits, key=lambda h: h.get("score", 0), reverse=True)


def _bm25_scores(terms: list[str], hits: list[dict]) -> list[float]:
    if not terms or not hits:
        return [0.0 for _ in hits]

    documents = [_hit_text(hit, include_content=True).lower() for hit in hits]
    tokenized = [_document_term_frequencies(terms, document) for document in documents]
    lengths = [sum(freqs.values()) or 1 for freqs in tokenized]
    avgdl = sum(lengths) / max(len(lengths), 1)
    raw_scores: list[float] = []
    k1 = 1.4
    b = 0.72
    total_docs = len(hits)

    for freqs, length in zip(tokenized, lengths):
        score = 0.0
        for term in terms:
            term_key = term.lower()
            tf = freqs.get(term_key, 0)
            if tf <= 0:
                continue
            document_frequency = sum(1 for item in tokenized if item.get(term_key, 0) > 0)
            idf = math.log(1 + (total_docs - document_frequency + 0.5) / (document_frequency + 0.5))
            denominator = tf + k1 * (1 - b + b * length / max(avgdl, 1))
            score += idf * (tf * (k1 + 1)) / max(denominator, 0.0001)
        raw_scores.append(score)

    max_score = max(raw_scores) if raw_scores else 0.0
    if max_score <= 0:
        return [0.0 for _ in hits]
    return [round(_clamp_float(score / max_score), 4) for score in raw_scores]


def _document_term_frequencies(terms: list[str], document: str) -> dict[str, int]:
    frequencies: dict[str, int] = {}
    for term in terms:
        term_key = term.lower()
        count = document.count(term_key)
        if count > 0:
            frequencies[term_key] = count
    return frequencies


def _signal_coverage_score(terms: list[str], text: str) -> float:
    if not terms:
        return 0.0
    return _term_coverage_score(terms, text)


def _term_hit_score(term_expansion_hits: list[dict] | None, hit: dict) -> float:
    if not term_expansion_hits:
        return 0.0

    terms: list[str] = []
    for item in term_expansion_hits:
        if not isinstance(item, dict):
            continue
        terms.extend(
            str(value).strip()
            for value in (
                item.get("canonical_term"),
                item.get("matched_text"),
                *(item.get("expansions") if isinstance(item.get("expansions"), list) else []),
            )
            if str(value).strip()
        )
    return _signal_coverage_score(_dedupe_terms(terms), _hit_text(hit, include_content=True))


def _build_retrieval_signals(
    *,
    vector_score: float,
    keyword_score: float,
    bm25_score: float,
    title_score: float,
    section_score: float,
    term_score: float,
    filter_score: float,
    filters: dict | None,
) -> list[dict]:
    meaningful_filters = _meaningful_filters(filters)
    return [
        {
            "name": "vector_recall",
            "score": round(vector_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["vector_recall"],
        },
        {
            "name": "keyword_bm25",
            "score": round(keyword_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["keyword_bm25"],
            "details": {"bm25_score": round(bm25_score, 4)},
        },
        {
            "name": "title_hit",
            "score": round(title_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["title_hit"],
        },
        {
            "name": "section_hit",
            "score": round(section_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["section_hit"],
        },
        {
            "name": "term_hit",
            "score": round(term_score, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["term_hit"],
        },
        {
            "name": "document_filter_hit",
            "score": round(filter_score if meaningful_filters else 0.0, 4),
            "weight": _HYBRID_SIGNAL_WEIGHTS["document_filter_hit"],
            "details": {"active_filters": sorted(meaningful_filters)},
        },
    ]


_CONFLICT_PAIRS = (
    (r"(必须|必须要|(?<!不)需要|应当)", r"(无需|不需要|禁止|严禁|不得|不应|不能)"),
    (r"(可以|(?<!不)允许|可进行|可直接)", r"(禁止|严禁|不得|不能|不允许|不可)"),
    (r"(启用|开启|打开|接通)", r"(停用|关闭|断开|切断)"),
    (r"((?<!不)合格|正常|(?<!不)满足|(?<!不)通过)", r"(不合格|异常|不满足|失败|不通过)"),
    (r"((?<!不)高于|大于|(?<!不)超过|不低于|至少)", r"((?<!不)低于|小于|不超过|不高于|至多)"),
)

_CONFLICT_MODAL_PATTERN = re.compile(
    r"(必须要|必须|应当|无需|不需要|需要|禁止|严禁|不得|不应|不能|不允许|不可|"
    r"可以|允许|可进行|可直接|启用|开启|打开|接通|停用|关闭|断开|切断|"
    r"合格|正常|满足|通过|不合格|异常|不满足|失败|"
    r"高于|大于|超过|不低于|至少|低于|小于|不超过|不高于|至多)"
)

_CONFLICT_TOKEN_STOPWORDS = {
    "测试",
    "过程",
    "过程中",
    "进行",
    "确认",
    "相关",
    "要求",
    "标准",
    "注意",
    "事项",
    "安全",
    "操作",
}


def _has_context_conflict(query: str, hits: list[dict]) -> bool:
    return bool(_context_conflict_candidates(query, hits))


def _context_conflict_candidates(query: str, hits: list[dict], limit: int = 3) -> list[dict]:
    if len(hits) < 2:
        return []

    query_terms = _extract_query_terms(query, limit=8)
    relevant_sentences = [
        {
            "text": sentence,
            "chunk_id": str(hit.get("chunk_id") or ""),
            "document_title": str(hit.get("document_title") or ""),
            "section_path": str(hit.get("section_path") or ""),
        }
        for hit in hits[:4]
        for sentence in _split_claim_sentences(_hit_text(hit, include_content=True))
        if not query_terms or _term_coverage_score(query_terms, sentence) >= 0.08
    ]
    if len(relevant_sentences) < 2:
        return []

    candidates: list[dict] = []
    for pair_index, (positive_pattern, negative_pattern) in enumerate(_CONFLICT_PAIRS):
        positive_claims = [
            claim
            for claim in relevant_sentences
            if re.search(positive_pattern, claim["text"])
        ]
        negative_claims = [
            claim
            for claim in relevant_sentences
            if re.search(negative_pattern, claim["text"])
        ]
        for positive_claim in positive_claims:
            for negative_claim in negative_claims:
                positive_sentence = positive_claim["text"]
                negative_sentence = negative_claim["text"]
                if positive_claim["chunk_id"] == negative_claim["chunk_id"] and positive_sentence == negative_sentence:
                    continue
                if _is_same_claim_conflict(
                    positive_sentence,
                    negative_sentence,
                    query_terms=query_terms,
                    pair_index=pair_index,
                ):
                    candidates.append({
                        "positive": positive_claim,
                        "negative": negative_claim,
                        "confidence": "candidate",
                    })
                    if len(candidates) >= limit:
                        return candidates
    return candidates


def _split_claim_sentences(text: str) -> list[str]:
    chunks = re.split(r"[。！？!?；;，,\n]+", text)
    return [chunk.strip() for chunk in chunks if len(chunk.strip()) >= 6]


def _is_same_claim_conflict(
    positive_sentence: str,
    negative_sentence: str,
    *,
    query_terms: list[str],
    pair_index: int,
) -> bool:
    positive_tokens = _claim_tokens(positive_sentence)
    negative_tokens = _claim_tokens(negative_sentence)
    if not positive_tokens or not negative_tokens:
        return False

    shared_tokens = positive_tokens & negative_tokens
    if not shared_tokens:
        return False

    query_token_set = set(query_terms)
    if query_token_set:
        query_overlap = shared_tokens & query_token_set
        if not query_overlap and _term_coverage_score(query_terms, positive_sentence + negative_sentence) < 0.18:
            return False

    overlap_ratio = len(shared_tokens) / max(min(len(positive_tokens), len(negative_tokens)), 1)
    shared_specific_tokens = [
        token for token in shared_tokens
        if len(token) >= 3 or re.search(r"[A-Za-z0-9]", token)
    ]

    # 安全章节经常同时出现“必须培训”和“禁止进入”等不同动作，只有对象/动作高度一致才视为冲突。
    if pair_index in (0, 1):
        return overlap_ratio >= 0.5 and len(shared_specific_tokens) >= 2
    return overlap_ratio >= 0.45 and bool(shared_specific_tokens)


def _claim_tokens(sentence: str) -> set[str]:
    normalized = _CONFLICT_MODAL_PATTERN.sub(" ", sentence.lower())
    tokens: set[str] = set()

    for token in re.findall(r"[a-z][a-z0-9_-]{1,}", normalized):
        if token not in _CONFLICT_TOKEN_STOPWORDS:
            tokens.add(token)

    for phrase in re.findall(r"[\u4e00-\u9fff]{2,}", normalized):
        for size in (4, 3, 2):
            for index in range(0, len(phrase) - size + 1):
                token = phrase[index:index + size]
                if token not in _CONFLICT_TOKEN_STOPWORDS:
                    tokens.add(token)
    return tokens


_QUERY_STOPWORDS = (
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
    "多少",
    "是",
    "的",
    "吗",
    "呢",
)


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
    meaningful_filters = _meaningful_filters(filters)
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


def _hit_document_title_text(hit: dict) -> str:
    metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
    return " ".join(
        str(value)
        for value in (
            hit.get("document_title"),
            metadata.get("document_title"),
            metadata.get("title"),
            hit.get("category"),
            metadata.get("category"),
        )
        if value
    )


def _hit_section_text(hit: dict) -> str:
    metadata = hit.get("metadata") if isinstance(hit.get("metadata"), dict) else {}
    return " ".join(
        str(value)
        for value in (
            hit.get("section_path"),
            metadata.get("section_path"),
            metadata.get("section_title"),
            metadata.get("chapter_title"),
        )
        if value
    )


def _hit_text(hit: dict, include_content: bool = False) -> str:
    parts = [_hit_title_text(hit), str(hit.get("snippet", ""))]
    if include_content:
        parts.append(str(hit.get("content", "")))
        parts.append(str(hit.get("context_window", "")))
    return " ".join(parts)


def _meaningful_filters(filters: dict | None) -> dict:
    return {key: value for key, value in (filters or {}).items() if value not in (None, "", [], {})}


def _dedupe_terms(terms: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for term in terms:
        normalized = term.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(term.strip())
    return deduped


def _clamp_float(value, minimum: float = 0.0, maximum: float = 1.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return minimum
    return max(minimum, min(maximum, number))
