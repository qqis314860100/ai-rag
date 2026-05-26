"""企业术语检索扩展。

这里先保留轻量内置词库，后续 API 侧术语资产落库后可以替换为同一契约的数据源。
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TermSourceRef:
    document_id: str = ""
    title: str = ""
    section_path: str = ""

    def as_dict(self) -> dict:
        return {
            "document_id": self.document_id,
            "title": self.title,
            "section_path": self.section_path,
        }


@dataclass(frozen=True)
class TermEntry:
    canonical_term: str
    abbreviation: str = ""
    aliases: tuple[str, ...] = ()
    synonyms: tuple[str, ...] = ()
    definition: str = ""
    applicable_scenarios: tuple[str, ...] = ()
    source_refs: tuple[TermSourceRef, ...] = ()
    related_topics: tuple[str, ...] = ()
    retrieval_terms: tuple[str, ...] = ()
    source: str = "built_in_battery_line_glossary"

    def as_contract_dict(self) -> dict:
        return {
            "canonical_term": self.canonical_term,
            "abbreviation": self.abbreviation,
            "aliases": list(self.aliases),
            "synonyms": list(self.synonyms),
            "definition": self.definition,
            "applicable_scenarios": list(self.applicable_scenarios),
            "source_refs": [ref.as_dict() for ref in self.source_refs],
            "related_topics": list(self.related_topics),
            "retrieval_terms": list(self.retrieval_terms),
            "source": self.source,
        }


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
        definition="电芯或模组在无负载静置状态下测得的端电压，用于一致性、容量状态和异常筛查。",
        applicable_scenarios=("电芯分选", "静置复测", "电压一致性分析", "来料和出货检验"),
        source_refs=(TermSourceRef(document_id="battery-line-glossary", title="电池产线术语库", section_path="测试 / OCV"),),
        related_topics=("电芯分选", "静置时间", "电压一致性", "SOC估算"),
        retrieval_terms=("电压一致性", "OCV测试", "OCV异常"),
    ),
    TermEntry(
        canonical_term="DCR",
        abbreviation="DCR",
        aliases=("直流内阻", "电芯直流内阻"),
        synonyms=("内阻", "direct current resistance"),
        definition="电芯或模组在直流脉冲或规定工况下表现出的等效内阻，常用于功率能力和连接质量判断。",
        applicable_scenarios=("内阻测试", "模组终检", "连接阻抗排查", "功率性能评估"),
        source_refs=(TermSourceRef(document_id="battery-line-glossary", title="电池产线术语库", section_path="测试 / DCR"),),
        related_topics=("内阻一致性", "连接阻抗", "Busbar焊接", "夹具接触"),
        retrieval_terms=("DCR测试", "内阻异常", "电阻一致性"),
    ),
    TermEntry(
        canonical_term="EOL",
        abbreviation="EOL",
        aliases=("下线测试", "终检测试", "产线终检"),
        synonyms=("end of line", "末端测试"),
        definition="产品下线前执行的终检测试集合，用于确认安全、电性能、通讯和关键装配质量是否满足放行标准。",
        applicable_scenarios=("模组下线", "Pack终检", "出货放行", "异常复测"),
        source_refs=(TermSourceRef(document_id="battery-line-glossary", title="电池产线术语库", section_path="终检 / EOL"),),
        related_topics=("终检流程", "绝缘耐压", "DCR测试", "功能测试"),
        retrieval_terms=("模组EOL", "EOL测试", "终检"),
    ),
    TermEntry(
        canonical_term="SOC",
        abbreviation="SOC",
        aliases=("荷电状态", "电量状态"),
        synonyms=("state of charge",),
        definition="电池当前剩余电量相对额定容量的百分比状态，通常结合 OCV 曲线、电流积分和温度补偿估算。",
        applicable_scenarios=("BMS估算", "容量校准", "充放电测试", "OCV曲线判断"),
        source_refs=(TermSourceRef(document_id="battery-line-glossary", title="电池产线术语库", section_path="电性能 / SOC"),),
        related_topics=("OCV曲线", "容量校准", "BMS", "温度补偿"),
        retrieval_terms=("SOC校准", "电量估算", "充电状态"),
    ),
    TermEntry(
        canonical_term="SOP",
        abbreviation="SOP",
        aliases=("标准作业程序", "标准操作规程"),
        synonyms=("作业指导书", "standard operating procedure"),
        definition="规定岗位操作步骤、工艺参数、质量检查和异常处置要求的标准化作业文件。",
        applicable_scenarios=("岗位作业", "新人培训", "异常处置", "工艺稽核"),
        source_refs=(TermSourceRef(document_id="battery-line-glossary", title="电池产线术语库", section_path="作业文件 / SOP"),),
        related_topics=("作业指导书", "工艺规程", "质量检查", "安全注意事项"),
        retrieval_terms=("操作步骤", "作业规范", "工艺规程"),
    ),
    TermEntry(
        canonical_term="CCD",
        abbreviation="CCD",
        aliases=("视觉检测", "工业相机检测"),
        synonyms=("机器视觉", "charge coupled device"),
        definition="产线视觉检测中常用的图像采集和识别能力，通常用于定位、外观缺陷和尺寸一致性检查。",
        applicable_scenarios=("极片外观检测", "焊接定位", "装配防错", "尺寸检测"),
        source_refs=(TermSourceRef(document_id="battery-line-glossary", title="电池产线术语库", section_path="视觉检测 / CCD"),),
        related_topics=("机器视觉", "外观缺陷", "定位补偿", "图像采集"),
        retrieval_terms=("CCD定位", "外观检测", "视觉拍照"),
    ),
    TermEntry(
        canonical_term="Busbar",
        abbreviation="",
        aliases=("汇流排", "母排", "连接排"),
        synonyms=("bus bar", "汇流条"),
        definition="用于电芯、模组或 Pack 内部电流汇集和传导的导电连接件，其焊接和接触质量会影响阻抗与温升。",
        applicable_scenarios=("模组装配", "激光焊接", "连接阻抗排查", "温升分析"),
        source_refs=(TermSourceRef(document_id="battery-line-glossary", title="电池产线术语库", section_path="连接件 / Busbar"),),
        related_topics=("激光焊接", "连接阻抗", "DCR", "温升"),
        retrieval_terms=("Busbar焊接", "汇流排焊接", "母排连接"),
    ),
)

TERMINOLOGY_CONTRACT = {
    "schema_version": "terminology.v1",
    "owner_service": "api",
    "consumer_service": "rag",
    "required_fields": [
        "canonical_term",
        "definition",
    ],
    "structured_fields": [
        "abbreviation",
        "aliases",
        "definition",
        "applicable_scenarios",
        "source_refs",
        "related_topics",
        "retrieval_terms",
    ],
    "retrieval_rule": "RAG 在查询改写和检索前可使用 abbreviation、aliases、synonyms、retrieval_terms 扩展召回，并在 trace 中记录命中的 canonical_term。",
}


def terminology_contract() -> dict:
    return dict(TERMINOLOGY_CONTRACT)


def list_term_entries() -> list[dict]:
    return [entry.as_contract_dict() for entry in TERM_GLOSSARY]


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
