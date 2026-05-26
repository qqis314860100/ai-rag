"""企业术语检索扩展。

这里先保留轻量内置词库，后续 API 侧术语资产落库后可以替换为同一契约的数据源。
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TermEntry:
    canonical_term: str
    abbreviation: str = ""
    aliases: tuple[str, ...] = ()
    synonyms: tuple[str, ...] = ()
    retrieval_terms: tuple[str, ...] = ()
    source: str = "built_in_battery_line_glossary"


@dataclass(frozen=True)
class TermExpansionHit:
    canonical_term: str
    matched_text: str
    matched_kind: str
    expansions: tuple[str, ...]
    source: str

    def as_dict(self) -> dict:
        return {
            "canonical_term": self.canonical_term,
            "matched_text": self.matched_text,
            "matched_kind": self.matched_kind,
            "expansions": list(self.expansions),
            "source": self.source,
        }


@dataclass(frozen=True)
class TermExpansionResult:
    original_query: str
    expanded_query: str
    hits: tuple[TermExpansionHit, ...]

    @property
    def changed(self) -> bool:
        return self.expanded_query != self.original_query


TERM_GLOSSARY: tuple[TermEntry, ...] = (
    TermEntry(
        canonical_term="OCV",
        abbreviation="OCV",
        aliases=("开路电压", "电芯开路电压"),
        synonyms=("静置电压", "open circuit voltage"),
        retrieval_terms=("电压一致性", "OCV测试", "OCV异常"),
    ),
    TermEntry(
        canonical_term="DCR",
        abbreviation="DCR",
        aliases=("直流内阻", "电芯直流内阻"),
        synonyms=("内阻", "direct current resistance"),
        retrieval_terms=("DCR测试", "内阻异常", "电阻一致性"),
    ),
    TermEntry(
        canonical_term="EOL",
        abbreviation="EOL",
        aliases=("下线测试", "终检测试", "产线终检"),
        synonyms=("end of line", "末端测试"),
        retrieval_terms=("模组EOL", "EOL测试", "终检"),
    ),
    TermEntry(
        canonical_term="SOC",
        abbreviation="SOC",
        aliases=("荷电状态", "电量状态"),
        synonyms=("state of charge",),
        retrieval_terms=("SOC校准", "电量估算", "充电状态"),
    ),
    TermEntry(
        canonical_term="SOP",
        abbreviation="SOP",
        aliases=("标准作业程序", "标准操作规程"),
        synonyms=("作业指导书", "standard operating procedure"),
        retrieval_terms=("操作步骤", "作业规范", "工艺规程"),
    ),
    TermEntry(
        canonical_term="CCD",
        abbreviation="CCD",
        aliases=("视觉检测", "工业相机检测"),
        synonyms=("机器视觉", "charge coupled device"),
        retrieval_terms=("CCD定位", "外观检测", "视觉拍照"),
    ),
    TermEntry(
        canonical_term="Busbar",
        abbreviation="",
        aliases=("汇流排", "母排", "连接排"),
        synonyms=("bus bar", "汇流条"),
        retrieval_terms=("Busbar焊接", "汇流排焊接", "母排连接"),
    ),
)


def expand_query_with_terms(query: str, *, max_terms_per_hit: int = 8) -> TermExpansionResult:
    original_query = re.sub(r"\s+", " ", query).strip()
    if not original_query:
        return TermExpansionResult(original_query=original_query, expanded_query=original_query, hits=())

    hits: list[TermExpansionHit] = []
    appended_terms: list[str] = []
    seen_terms = {_normalize_surface(term) for term in _query_surfaces(original_query)}

    for entry in TERM_GLOSSARY:
        matched_text, matched_kind = _match_entry(original_query, entry)
        if not matched_text:
            continue

        expansions: list[str] = []
        for term in _entry_expansion_terms(entry):
            normalized = _normalize_surface(term)
            if not normalized or normalized in seen_terms:
                continue
            seen_terms.add(normalized)
            expansions.append(term)
            appended_terms.append(term)
            if len(expansions) >= max_terms_per_hit:
                break

        hits.append(TermExpansionHit(
            canonical_term=entry.canonical_term,
            matched_text=matched_text,
            matched_kind=matched_kind,
            expansions=tuple(expansions),
            source=entry.source,
        ))

    expanded_query = " ".join([original_query, *appended_terms]).strip()
    return TermExpansionResult(
        original_query=original_query,
        expanded_query=expanded_query,
        hits=tuple(hits),
    )


def _match_entry(query: str, entry: TermEntry) -> tuple[str, str]:
    surfaces: tuple[tuple[str, str], ...] = (
        ((entry.abbreviation, "abbreviation"),) if entry.abbreviation else ()
    ) + (
        (entry.canonical_term, "term"),
        *((alias, "alias") for alias in entry.aliases),
        *((synonym, "synonym") for synonym in entry.synonyms),
    )

    for surface, kind in surfaces:
        if _surface_in_query(surface, query):
            return surface, kind
    return "", ""


def _entry_expansion_terms(entry: TermEntry) -> tuple[str, ...]:
    return _dedupe((
        entry.canonical_term,
        entry.abbreviation,
        *entry.aliases,
        *entry.synonyms,
        *entry.retrieval_terms,
    ))


def _surface_in_query(surface: str, query: str) -> bool:
    if not surface:
        return False
    if re.search(r"[A-Za-z0-9]", surface):
        pattern = rf"(?<![A-Za-z0-9]){re.escape(surface)}(?![A-Za-z0-9])"
        return bool(re.search(pattern, query, flags=re.IGNORECASE))
    return surface in query


def _query_surfaces(query: str) -> tuple[str, ...]:
    return tuple(re.findall(r"[A-Za-z][A-Za-z0-9_-]*|[\u4e00-\u9fff]{2,}", query))


def _normalize_surface(value: str) -> str:
    return re.sub(r"\s+", "", value).lower()


def _dedupe(values: tuple[str, ...]) -> tuple[str, ...]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = value.strip()
        normalized = _normalize_surface(cleaned)
        if not cleaned or normalized in seen:
            continue
        seen.add(normalized)
        result.append(cleaned)
    return tuple(result)
