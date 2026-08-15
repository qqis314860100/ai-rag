from __future__ import annotations

import re
from collections import Counter
from typing import Any

_STOPWORDS = {
    "这个",
    "那个",
    "需要",
    "进行",
    "可以",
    "如果",
    "然后",
    "以及",
    "或者",
    "因为",
    "所以",
    "当前",
    "相关",
    "通过",
    "确认",
    "检查",
    "文档",
    "章节",
    "来源",
    "引用",
    "回答正文",
}

_CATEGORY_RULES: tuple[tuple[str, str, set[str]], ...] = (
    ("equipment", "设备", {"设备", "夹具", "传感器", "电机", "阀门", "工站", "产线", "模组", "测试柜", "仪器", "探针", "线束"}),
    ("step", "步骤", {"步骤", "流程", "先", "再", "然后", "最后", "执行", "连接", "施加", "测量", "计算"}),
    ("parameter", "参数", {"温度", "压力", "电压", "电流", "时间", "速度", "阈值", "窗口", "SOC", "PPM", "mA", "MΩ", "V", "DC", "AC"}),
    ("risk", "风险", {"异常", "故障", "风险", "报警", "缺陷", "超限", "失效", "安全", "击穿", "短路", "泄漏"}),
    ("action", "处理方法", {"检查", "确认", "调整", "复位", "更换", "记录", "上传", "恢复", "定位", "处理", "隔离", "返修", "复核"}),
)

CATEGORY_ORDER = ("equipment", "step", "parameter", "risk", "action", "concept")
SEQUENCE_PATTERN = r"先|再|然后|之后|随后|最后|第一步|第二步|第三步|执行|连接|施加|测量|计算|记录|上传"
DECISION_PATTERN = r"如果|若|是否|判断|异常|失败|否则|低于|高于|超过|不通过|报警"
ACTION_PATTERN = r"检查|确认|处理|恢复|更换|复位|记录|上传|隔离|返修|复核|定位|调整"
PARAMETER_PATTERN = r"\d+(?:\.\d+)?\s?(?:V|mA|A|MΩ|GΩ|Ω|秒|s|PPM|%RH|%)|≥\s?\d+|≤\s?\d+"
MAX_MINDMAP_CATEGORIES = 5
MAX_KEYWORDS_PER_CATEGORY = 4


def clean_text(value: str, max_length: int = 80) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip(" ，。；：、,.!?！？()（）[]【】|")
    return cleaned[:max_length]


def source_id_at(source_ids: list[str], index: int) -> str:
    if 0 <= index < len(source_ids):
        return source_ids[index]
    return f"source-{index + 1}"


def extract_evidence_blocks(content: str, source_ids: list[str]) -> list[dict[str, str]]:
    blocks: list[dict[str, str]] = []
    pattern = re.compile(
        r"\[引用\s*(\d+)\]\s*文档：(?P<title>.*?)\s*章节：(?P<section>.*?)\s*片段：(?P<snippet>.*?)(?=\n\[引用\s*\d+\]|\Z)",
        re.DOTALL,
    )
    for match in pattern.finditer(content):
        index = int(match.group(1)) - 1
        title = clean_text(match.group("title"), 42)
        section = clean_text(match.group("section"), 56)
        snippet = clean_text(match.group("snippet"), 160)
        blocks.append(
            {
                "source_id": source_id_at(source_ids, index),
                "title": title,
                "section": section,
                "snippet": snippet,
                "text": " ".join(part for part in (title, section, snippet) if part),
            }
        )
    return blocks


def category_for_keyword(keyword: str) -> tuple[str, str]:
    if re.search(PARAMETER_PATTERN, keyword, flags=re.IGNORECASE):
        return "parameter", "参数"
    for category, label, markers in _CATEGORY_RULES:
        if any(marker in keyword for marker in markers):
            return category, label
    return "concept", "概念"


def _term_weight(term: str, text: str) -> int:
    return len(re.findall(re.escape(term), text, flags=re.IGNORECASE))


def _adjusted_keyword_weight(term: str, weight: int) -> int:
    category, _label = category_for_keyword(term)
    bonus = 0
    if category != "concept":
        bonus += 3
    if category == "parameter":
        bonus += 2
    return weight + bonus


def extract_diagram_keywords(content: str, limit: int = 10) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fffA-Za-z0-9Ωμ/%-]{2,}", content)
    counter: Counter[str] = Counter()

    for word in words:
        normalized = clean_text(word, 16)
        if len(normalized) < 2 or normalized in _STOPWORDS:
            continue
        if re.fullmatch(r"\d+", normalized):
            continue
        counter[normalized] += 1

        if re.search(r"[\u4e00-\u9fff]{5,}", normalized):
            for size in (4, 3, 2):
                for index in range(len(normalized) - size + 1):
                    ngram = normalized[index:index + size]
                    if ngram not in _STOPWORDS:
                        counter[ngram] += 1

    ranked = sorted(counter.items(), key=lambda item: (-_adjusted_keyword_weight(item[0], item[1]), -len(item[0]), item[0]))
    return [word for word, _count in ranked[:limit]]


def extract_weighted_keywords(content: str, source_ids: list[str], limit: int) -> list[dict[str, Any]]:
    evidence_blocks = extract_evidence_blocks(content, source_ids)
    counter: Counter[str] = Counter()
    source_map: dict[str, set[str]] = {}
    evidence_map: dict[str, list[dict[str, str]]] = {}

    fields: list[tuple[str, int, str]] = [(content, 3, "answer")]
    for block in evidence_blocks:
        fields.extend(
            [
                (block["title"], 3, block["source_id"]),
                (block["section"], 2, block["source_id"]),
                (block["snippet"], 2, block["source_id"]),
            ]
        )

    for text, weight, source_id in fields:
        for keyword in extract_diagram_keywords(text, limit=limit * 3):
            if keyword in _STOPWORDS:
                continue
            counter[keyword] += weight + _term_weight(keyword, text)
            if source_id != "answer":
                source_map.setdefault(keyword, set()).add(source_id)
                matched_block = next((block for block in evidence_blocks if block["source_id"] == source_id), None)
                if matched_block:
                    evidence_map.setdefault(keyword, []).append(matched_block)

    for parameter in re.findall(PARAMETER_PATTERN, content, flags=re.IGNORECASE):
        normalized = clean_text(parameter, 18)
        if normalized:
            counter[normalized] += 5

    ranked = sorted(counter.items(), key=lambda item: (-item[1], -len(item[0]), item[0]))
    results: list[dict[str, Any]] = []
    seen_categories: Counter[str] = Counter()
    for keyword, weight in ranked:
        category, label = category_for_keyword(keyword)
        weight = _adjusted_keyword_weight(keyword, weight)
        if seen_categories[category] >= 6:
            continue
        seen_categories[category] += 1
        results.append(
            {
                "term": keyword,
                "weight": weight,
                "category": category,
                "category_label": label,
                "source_ids": sorted(source_map.get(keyword, set())),
                "evidence": evidence_map.get(keyword, [])[:2],
            }
        )
        if len(results) >= limit:
            break
    return results


def extract_diagram_steps(content: str, max_steps: int) -> list[str]:
    cleaned = content.strip()
    candidates: list[str] = []

    numbered_content = re.sub(
        r"(^|[。；;.!?！？\s])(?:\d+[.)、]|[一二三四五六七八九十]+[、.])\s*",
        lambda match: f"{match.group(1)}\n",
        cleaned,
    )

    for block in re.split(r"[\r\n]+", numbered_content):
        block = block.strip()
        if not block:
            continue
        for part in re.split(r"[。；;.!?！？]+", block):
            line = re.sub(r"^\s*(?:[-*+]\s+|\d+[.)、]\s*|[一二三四五六七八九十]+[、.]\s*)", "", part).strip()
            if line and (
                re.search(SEQUENCE_PATTERN, line)
                or re.search(DECISION_PATTERN, line)
                or re.search(ACTION_PATTERN, line)
                or len(candidates) < 2
            ):
                candidates.append(line)

    steps: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = re.sub(r"\s+", " ", candidate).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        steps.append(normalized[:80])
        if len(steps) >= max_steps:
            break

    if len(steps) < 2 and cleaned:
        compact = re.sub(r"\s+", " ", cleaned)
        steps = [compact[index:index + 36] for index in range(0, min(len(compact), 36 * max_steps), 36)]

    return steps[:max_steps] or ["整理回答要点", "检查关联证据"]


def step_kind(step: str) -> str:
    if re.search(DECISION_PATTERN, step):
        return "decision"
    if re.search(ACTION_PATTERN, step):
        return "action"
    return "step"
