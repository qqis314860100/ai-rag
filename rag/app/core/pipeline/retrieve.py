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


_CONFLICT_PAIRS = (
    (r"(必须|必须要|(?<!不)需要|应当)", r"(无需|不需要|禁止|严禁|不得|不应|不能)"),
    (r"(可以|允许|可进行|可直接)", r"(禁止|严禁|不得|不能|不允许|不可)"),
    (r"(启用|开启|打开|接通)", r"(停用|关闭|断开|切断)"),
    (r"(合格|正常|满足|通过)", r"(不合格|异常|不满足|失败)"),
    (r"(高于|大于|超过|不低于|至少)", r"(低于|小于|不超过|不高于|至多)"),
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
    if len(hits) < 2:
        return False

    query_terms = _extract_query_terms(query, limit=8)
    relevant_sentences = [
        sentence
        for hit in hits[:4]
        for sentence in _split_claim_sentences(_hit_text(hit, include_content=True))
        if not query_terms or _term_coverage_score(query_terms, sentence) >= 0.08
    ]
    if len(relevant_sentences) < 2:
        return False

    for pair_index, (positive_pattern, negative_pattern) in enumerate(_CONFLICT_PAIRS):
        positive_claims = [
            sentence
            for sentence in relevant_sentences
            if re.search(positive_pattern, sentence)
        ]
        negative_claims = [
            sentence
            for sentence in relevant_sentences
            if re.search(negative_pattern, sentence)
        ]
        for positive_sentence in positive_claims:
            for negative_sentence in negative_claims:
                if _is_same_claim_conflict(
                    positive_sentence,
                    negative_sentence,
                    query_terms=query_terms,
                    pair_index=pair_index,
                ):
                    return True
    return False


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
