import re

from ...schemas.models import (
    AnswerQueryRewrite,
    QueryAmbiguity,
    QueryCandidateTerm,
    QuerySpellCorrection,
    QueryUnderstanding,
)
from ..terminology import TermExpansionResult, expand_query_with_terms, list_term_entries


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
    spell_corrections = _detect_spell_corrections(original_query)

    if topic:
        signals.append("history_topic")

    if _is_low_information_query(original_query) and not topic:
        understanding = _build_query_understanding(
            original_query=original_query,
            rewritten_query=rewritten_query,
            intent=_infer_query_intent(original_query),
            candidate_terms=[],
            spell_corrections=[],
            ambiguity=QueryAmbiguity(
                is_ambiguous=True,
                reason="问题信息量过低，无法稳定判断用户意图",
            ),
            signals=["low_information"],
            strategy="low_information",
        )
        return AnswerQueryRewrite(
            original_query=original_query,
            rewritten_query=rewritten_query,
            changed=False,
            strategy="low_information",
            reason="问题信息量过低，且没有可用于补全的历史上下文",
            signals=["low_information"],
            history_turns=history_turns,
            query_understanding=understanding,
        )

    if spell_corrections:
        rewritten_query = _apply_spell_corrections(rewritten_query, spell_corrections)
        signals.append("spell_correction")
        strategies.append("spell_correction")
        reasons.append("根据企业术语库修正常见缩写错写")

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
    candidate_terms = _query_candidate_terms(term_expansion, knowledge_assets or [], spell_corrections)
    ambiguity = _query_ambiguity(original_query, candidate_terms, spell_corrections)
    understanding = _build_query_understanding(
        original_query=original_query,
        rewritten_query=rewritten_query,
        intent=_infer_query_intent(original_query),
        candidate_terms=candidate_terms,
        spell_corrections=spell_corrections,
        ambiguity=ambiguity,
        signals=signals,
        strategy=strategy,
    )
    return AnswerQueryRewrite(
        original_query=original_query,
        rewritten_query=rewritten_query,
        changed=changed,
        strategy=strategy,
        reason="；".join(reasons),
        signals=_dedupe_preserve_order(signals),
        history_turns=history_turns,
        term_expansion_hits=term_expansion_hits,
        query_understanding=understanding,
    )


def _enrich_query_understanding_with_recall(
    query_rewrite: AnswerQueryRewrite,
    *,
    history: list[dict[str, str]] | None = None,
    recall_hits: list[dict] | None = None,
) -> AnswerQueryRewrite:
    """把首轮召回和多轮上下文产生的候选理解补回 Query Understanding。

    检索前只能看到用户问题、历史和术语资产；文档标题、章节标题属于首轮召回证据，
    因此在 search 完成后补充，并保留每个候选的可审计来源。
    """
    understanding = query_rewrite.query_understanding
    extra_candidates = [
        *_history_candidate_terms(query_rewrite.original_query, history, query_rewrite.signals),
        *_recall_candidate_terms(recall_hits or []),
    ]
    if not extra_candidates:
        return query_rewrite

    signals = list(query_rewrite.signals)
    if any(candidate.matched_kind == "history_question" for candidate in extra_candidates):
        signals.append("history_question_candidate")
    if any(candidate.matched_kind == "document_title" for candidate in extra_candidates):
        signals.append("recall_document_title_candidate")
    if any(candidate.matched_kind == "section_title" for candidate in extra_candidates):
        signals.append("recall_section_title_candidate")
    signals = _dedupe_preserve_order(signals)

    candidate_terms = _dedupe_candidate_terms([
        *understanding.candidate_terms,
        *extra_candidates,
    ])
    ambiguity = _query_ambiguity(
        query_rewrite.original_query,
        candidate_terms,
        understanding.spell_corrections,
    )
    enriched = _build_query_understanding(
        original_query=understanding.original_query,
        rewritten_query=understanding.rewritten_query,
        intent=understanding.intent,
        candidate_terms=candidate_terms,
        spell_corrections=understanding.spell_corrections,
        ambiguity=ambiguity,
        signals=signals,
        strategy=query_rewrite.strategy,
    )
    return query_rewrite.model_copy(update={
        "signals": signals,
        "query_understanding": enriched,
    })


def _term_expansion_hits_dump(result: TermExpansionResult) -> list[dict]:
    return [hit.as_dict() for hit in result.hits]


def _detect_spell_corrections(query: str) -> list[QuerySpellCorrection]:
    corrections: list[QuerySpellCorrection] = []
    tokens = re.findall(r"[A-Za-z]{2,8}", query)
    if not tokens:
        return corrections

    abbreviations = [
        str(entry.get("abbreviation") or entry.get("canonical_term") or "")
        for entry in list_term_entries()
        if str(entry.get("abbreviation") or entry.get("canonical_term") or "")
    ]
    known_abbreviations = {abbreviation.lower() for abbreviation in abbreviations}
    seen: set[tuple[str, str]] = set()
    for token in tokens:
        normalized = token.lower()
        if normalized in known_abbreviations:
            continue
        for abbreviation in abbreviations:
            target = abbreviation.lower()
            if normalized == target or abs(len(normalized) - len(target)) > 1:
                continue
            distance = _damerau_levenshtein(normalized, target, max_distance=1)
            transposed = len(normalized) == len(target) and sorted(normalized) == sorted(target)
            if distance <= 1 or transposed:
                key = (token, abbreviation)
                if key in seen:
                    continue
                seen.add(key)
                corrections.append(QuerySpellCorrection(
                    original=token,
                    correction=abbreviation,
                    source="built_in_battery_line_glossary",
                    confidence=0.82 if transposed else 0.78,
                    reason="疑似企业术语缩写错写",
                ))
                break
    return corrections


def _apply_spell_corrections(query: str, corrections: list[QuerySpellCorrection]) -> str:
    rewritten = query
    for correction in corrections:
        if not correction.original or not correction.correction:
            continue
        rewritten = re.sub(
            rf"(?<![A-Za-z0-9]){re.escape(correction.original)}(?![A-Za-z0-9])",
            correction.correction,
            rewritten,
            flags=re.IGNORECASE,
        )
    return rewritten


def _query_candidate_terms(
    term_expansion: TermExpansionResult,
    knowledge_assets: list[dict],
    spell_corrections: list[QuerySpellCorrection],
) -> list[QueryCandidateTerm]:
    candidates: list[QueryCandidateTerm] = []
    for hit in term_expansion.hits:
        candidates.append(QueryCandidateTerm(
            term=hit.canonical_term,
            matched_text=hit.matched_text,
            matched_kind=hit.matched_kind,
            source=hit.source,
            confidence=0.9,
            reason="命中企业术语库",
        ))
    for correction in spell_corrections:
        candidates.append(QueryCandidateTerm(
            term=correction.correction,
            matched_text=correction.original,
            matched_kind="spell_correction",
            source=correction.source,
            confidence=correction.confidence,
            reason=correction.reason,
        ))
    for asset in knowledge_assets:
        label = str(asset.get("label") or "")
        if not label:
            continue
        candidates.append(QueryCandidateTerm(
            term=label,
            matched_text=label,
            matched_kind=str(asset.get("asset_type") or "knowledge_asset"),
            source=f"knowledge_asset:{asset.get('id') or ''}".rstrip(":"),
            confidence=0.76,
            reason="命中已发布知识资产",
        ))
    return _dedupe_candidate_terms(candidates)


def _history_candidate_terms(
    original_query: str,
    history: list[dict[str, str]] | None,
    signals: list[str],
) -> list[QueryCandidateTerm]:
    if not history or not any(signal in {"pronoun", "ellipsis"} for signal in signals):
        return []

    candidates: list[QueryCandidateTerm] = []
    for index, item in enumerate(reversed(history[-8:]), 1):
        if item.get("role") != "user":
            continue
        content = _normalize_query_text(str(item.get("content") or ""))
        topic = _extract_rewrite_topic(content)
        if not topic or topic == original_query:
            continue
        candidates.append(QueryCandidateTerm(
            term=topic,
            matched_text=content[:80],
            matched_kind="history_question",
            source=f"history_question:{index}",
            confidence=0.72,
            reason="来自最近多轮用户问题，用于补全指代或省略主题",
        ))
        if len(candidates) >= 3:
            break
    return candidates


def _recall_candidate_terms(hits: list[dict]) -> list[QueryCandidateTerm]:
    candidates: list[QueryCandidateTerm] = []
    seen: set[tuple[str, str]] = set()
    for rank, hit in enumerate(hits[:5], 1):
        score = _coerce_score(hit.get("score"))
        chunk_id = str(hit.get("chunk_id") or f"rank-{rank}")
        title = _clean_candidate_label(str(hit.get("document_title") or ""))
        if title and (title, "document_title") not in seen:
            seen.add((title, "document_title"))
            candidates.append(QueryCandidateTerm(
                term=title,
                matched_text=title,
                matched_kind="document_title",
                source=f"first_recall:{rank}:document_title:{chunk_id}",
                confidence=round(min(0.84, 0.66 + score * 0.12), 2),
                reason="来自首轮召回结果的文档标题",
            ))

        section = _clean_candidate_label(_last_section_title(str(hit.get("section_path") or "")))
        if section and (section, "section_title") not in seen:
            seen.add((section, "section_title"))
            candidates.append(QueryCandidateTerm(
                term=section,
                matched_text=section,
                matched_kind="section_title",
                source=f"first_recall:{rank}:section_title:{chunk_id}",
                confidence=round(min(0.8, 0.6 + score * 0.12), 2),
                reason="来自首轮召回结果的章节标题",
            ))
    return candidates[:8]


def _query_ambiguity(
    query: str,
    candidate_terms: list[QueryCandidateTerm],
    spell_corrections: list[QuerySpellCorrection],
) -> QueryAmbiguity:
    if _is_low_information_query(query):
        return QueryAmbiguity(is_ambiguous=True, reason="问题信息量过低")
    correction_targets = _dedupe_preserve_order([item.correction for item in spell_corrections if item.correction])
    if len(correction_targets) > 1:
        return QueryAmbiguity(
            is_ambiguous=True,
            candidates=correction_targets,
            reason="存在多个可能的术语纠错候选",
        )
    terms = _dedupe_preserve_order([item.term for item in candidate_terms if item.term])
    if len(terms) > 3:
        return QueryAmbiguity(
            is_ambiguous=True,
            candidates=terms[:5],
            reason="命中过多候选术语，需要结合召回证据确认主语义",
        )
    return QueryAmbiguity()


def _build_query_understanding(
    *,
    original_query: str,
    rewritten_query: str,
    intent: str,
    candidate_terms: list[QueryCandidateTerm],
    spell_corrections: list[QuerySpellCorrection],
    ambiguity: QueryAmbiguity,
    signals: list[str],
    strategy: str,
) -> QueryUnderstanding:
    confidence = _estimate_understanding_confidence(
        candidate_terms=candidate_terms,
        spell_corrections=spell_corrections,
        ambiguity=ambiguity,
        signals=signals,
        strategy=strategy,
    )
    needs_confirmation = ambiguity.is_ambiguous and confidence < 0.75
    grey_answer_hint = _grey_answer_hint(spell_corrections, candidate_terms, needs_confirmation)
    trace = [
        {"source": "rewrite_strategy", "value": strategy},
        *({"source": "signal", "value": signal} for signal in _dedupe_preserve_order(signals)),
        *(
            {
                "source": "spell_similarity",
                "value": f"{correction.original} -> {correction.correction}",
                "candidate": correction.correction,
                "matched_text": correction.original,
                "confidence": correction.confidence,
                "reason": correction.reason,
            }
            for correction in spell_corrections
            if correction.original and correction.correction
        ),
        *(
            {
                "source": "candidate_source",
                "value": candidate.source,
                "term": candidate.term,
                "matched_text": candidate.matched_text,
                "matched_kind": candidate.matched_kind,
                "confidence": candidate.confidence,
                "reason": candidate.reason,
            }
            for candidate in candidate_terms
            if candidate.term or candidate.matched_text or candidate.source
        ),
    ]
    return QueryUnderstanding(
        original_query=original_query,
        rewritten_query=rewritten_query,
        intent=intent,
        candidate_terms=candidate_terms,
        spell_corrections=spell_corrections,
        ambiguity=ambiguity,
        confidence=confidence,
        needs_confirmation=needs_confirmation,
        grey_answer_hint=grey_answer_hint,
        trace=trace,
    )


def _infer_query_intent(query: str) -> str:
    if re.search(r"(流程图|思维导图|画图|图解|整理成图)", query):
        return "artifact_generation"
    if re.search(r"(异常|故障|报警|不良|失效|排查|怎么处理|怎么办)", query):
        return "troubleshooting"
    if re.search(r"(步骤|流程|操作|规程|SOP|作业|如何)", query, re.IGNORECASE):
        return "procedure"
    if re.search(r"(阈值|标准|参数|多少|电压|电流|温度|压力|范围)", query):
        return "parameter"
    if re.search(r"(区别|差异|对比|比较)", query):
        return "comparison"
    if re.search(r"(第\s*[\d一二三四五六七八九十]+\s*章|章节)", query):
        return "chapter_lookup"
    if re.search(r"(是什么|定义|介绍|说明)", query):
        return "definition"
    return "general"


def _estimate_understanding_confidence(
    *,
    candidate_terms: list[QueryCandidateTerm],
    spell_corrections: list[QuerySpellCorrection],
    ambiguity: QueryAmbiguity,
    signals: list[str],
    strategy: str,
) -> float:
    if strategy == "low_information":
        return 0.2
    confidence = 0.62
    if candidate_terms:
        confidence += min(0.18, len(candidate_terms) * 0.06)
    if spell_corrections:
        confidence += min(item.confidence for item in spell_corrections) * 0.12
    if any(signal in {"pronoun", "ellipsis", "chapter_number"} for signal in signals):
        confidence += 0.08
    if ambiguity.is_ambiguous:
        confidence -= 0.18
    return round(max(0.0, min(1.0, confidence)), 2)


def _grey_answer_hint(
    spell_corrections: list[QuerySpellCorrection],
    candidate_terms: list[QueryCandidateTerm],
    needs_confirmation: bool,
) -> str:
    if needs_confirmation:
        return "当前问题存在歧义，需要用户确认后再回答。"
    if spell_corrections:
        corrections = "、".join(
            f"{item.original} -> {item.correction}"
            for item in spell_corrections
            if item.original and item.correction
        )
        if corrections:
            return f"系统按术语库推测为 {corrections}。"
    if candidate_terms:
        terms = "、".join(_dedupe_preserve_order([item.term for item in candidate_terms if item.term])[:3])
        if terms:
            return f"已命中术语：{terms}。"
    return ""


def _damerau_levenshtein(source: str, target: str, *, max_distance: int) -> int:
    if source == target:
        return 0
    if abs(len(source) - len(target)) > max_distance:
        return max_distance + 1
    previous = list(range(len(target) + 1))
    current = [0] * (len(target) + 1)
    for i, source_char in enumerate(source, 1):
        current[0] = i
        row_min = current[0]
        for j, target_char in enumerate(target, 1):
            cost = 0 if source_char == target_char else 1
            current[j] = min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + cost,
            )
            if i > 1 and j > 1 and source_char == target[j - 2] and source[i - 2] == target_char:
                current[j] = min(current[j], previous[j - 2] + 1)
            row_min = min(row_min, current[j])
        if row_min > max_distance:
            return max_distance + 1
        previous, current = current, previous
    return previous[-1]


def _dedupe_candidate_terms(candidates: list[QueryCandidateTerm]) -> list[QueryCandidateTerm]:
    seen: set[tuple[str, str]] = set()
    result: list[QueryCandidateTerm] = []
    for candidate in candidates:
        key = (candidate.term, candidate.matched_kind)
        if key in seen:
            continue
        seen.add(key)
        result.append(candidate)
    return result


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


def _last_section_title(section_path: str) -> str:
    parts = re.split(r"\s*(?:/|>|›|»|->|→)\s*", section_path)
    for part in reversed(parts):
        cleaned = part.strip()
        if cleaned:
            return cleaned
    return section_path.strip()


def _clean_candidate_label(value: str) -> str:
    cleaned = _normalize_query_text(value)
    cleaned = re.sub(r"^[\s#\-•·\d.、]+", "", cleaned).strip()
    if len(cleaned) < 2 or cleaned.lower() in {"unknown", "untitled"}:
        return ""
    return cleaned[:80]


def _coerce_score(value: object) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, score))


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
