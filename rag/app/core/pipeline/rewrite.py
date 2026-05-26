import re

from ...schemas.models import AnswerQueryRewrite
from ..terminology import TermExpansionResult, expand_query_with_terms


def _asset_terms(asset: dict) -> list[str]:
    values = [
        str(asset.get("label") or ""),
        str(asset.get("summary") or ""),
    ]
    retrieval_terms = asset.get("retrieval_terms")
    if isinstance(retrieval_terms, list):
        values.extend(str(term) for term in retrieval_terms)
    return [value.strip() for value in values if value and value.strip()]


def _select_knowledge_assets(query: str, knowledge_assets: list[dict] | None = None) -> list[dict]:
    if not knowledge_assets:
        return []
    normalized_query = query.lower()
    matched: list[dict] = []
    for asset in knowledge_assets:
        terms = _asset_terms(asset)
        if any(len(term) >= 2 and term.lower() in normalized_query for term in terms):
            matched.append(asset)
    return matched[:8]


def _knowledge_asset_trace(assets: list[dict]) -> list[dict]:
    return [
        {
            "asset_type": str(asset.get("asset_type") or ""),
            "id": str(asset.get("id") or ""),
            "label": str(asset.get("label") or ""),
            "status": str(asset.get("status") or ""),
            "retrieval_terms": asset.get("retrieval_terms") if isinstance(asset.get("retrieval_terms"), list) else [],
        }
        for asset in assets
    ]


def _knowledge_asset_expansion_text(assets: list[dict]) -> str:
    terms: list[str] = []
    for asset in assets:
        terms.extend(_asset_terms(asset)[:8])
    return " ".join(_dedupe_preserve_order(terms)[:24])


def _rewrite_query(query: str) -> str:
    """返回兼容旧调用方的重写查询字符串。"""
    return _rewrite_query_with_trace(query).rewritten_query


def _rewrite_query_with_trace(
    query: str,
    history: list[dict[str, str]] | None = None,
    knowledge_assets: list[dict] | None = None,
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

    term_expansion = expand_query_with_terms(rewritten_query)
    term_expansion_hits = _term_expansion_hits_dump(term_expansion)
    if term_expansion.changed or term_expansion_hits:
        rewritten_query = term_expansion.expanded_query
        signals.append("terminology_expansion")
        for hit in term_expansion.hits:
            signals.append(f"term:{hit.canonical_term}")
        if term_expansion.changed:
            strategies.append("terminology_expansion")
            reasons.append("命中术语库并扩展别名、缩写和同义表达")

    asset_expansion = _knowledge_asset_expansion_text(knowledge_assets or [])
    if asset_expansion:
        rewritten_query = " ".join(_dedupe_preserve_order([rewritten_query, asset_expansion]))
        signals.append("knowledge_asset_expansion")
        for asset in knowledge_assets or []:
            asset_type = str(asset.get("asset_type") or "asset")
            asset_id = str(asset.get("id") or "")
            if asset_id:
                signals.append(f"asset:{asset_type}:{asset_id}")
        strategies.append("knowledge_asset_expansion")
        reasons.append("命中已发布知识资产并扩展检索语义")

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
        term_expansion_hits=term_expansion_hits,
    )


def _term_expansion_hits_dump(result: TermExpansionResult) -> list[dict]:
    return [hit.as_dict() for hit in result.hits]


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
    cleaned = re.sub(r"(是什么|是多少|为多少|有哪些|多少|如何|怎么处理|怎么办|怎么|为什么|是否|吗|呢)\s*$", " ", cleaned)
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
