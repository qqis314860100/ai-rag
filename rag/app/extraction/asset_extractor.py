"""文档编目元数据抽取（复用解析→切分→抽取链路）。

ep AI 能力服务契约端点 /rag/extract 的实现：输入与 ingest 同形态的
DocumentRequest，输出与 ep AiCapabilityClient.ExtractionResult 逐字段对齐。
抽取遵循拒答纪律：内容为空/不可用时返回空字段结果（""/[]/0.0），
不编造编目建议；LLM 用量纳入现有 usage_guard 预算检查。
"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter
from typing import Any

from ..chunking.chunker import chunk_document
from ..cleaning.cleaner import clean_parsed_document
from ..core import pipeline as _pipeline  # noqa: F401 - 导入即注册解析器
from ..core.pipeline import _validate_file_path
from ..parsers.base import ParserRegistry
from ..schemas.models import ExtractionResult

logger = logging.getLogger(__name__)

# LLM 抽取只取正文前缀，避免单次请求输入超预算。
_LLM_CONTEXT_CHARS = 6000
_MAX_EVIDENCE = 3
_MAX_TAGS = 8
_EVIDENCE_SNIPPET_CHARS = 90

# 抽取标签时剔除的高频虚词/泛词。
_STOPWORDS = {
    "这个", "那个", "需要", "进行", "可以", "如果", "然后", "以及", "或者",
    "因为", "所以", "当前", "相关", "通过", "确认", "检查", "文档", "章节",
    "内容", "我们", "你们", "他们", "是否", "没有", "不是", "还是", "要求",
}


def _llm_live() -> bool:
    """是否真正走外部 LLM（离线/mock 时返回 False，走确定性抽取）。"""
    from ..llm.client import _mock_reason
    return not _mock_reason()


def _parse_document_chunks(*, document_id: str, file_path: str):
    """复用 解析→清洗→切分 链路，返回 Chunk 列表（文件不存在/越权由校验器抛错）。"""
    safe_path = _validate_file_path(file_path)
    parser = ParserRegistry.get(safe_path)
    parsed = parser.parse(safe_path, document_id, {})
    parsed = clean_parsed_document(parsed)
    return chunk_document(parsed)


def extract_asset_metadata(
    *,
    document_id: str,
    file_path: str,
    title: str = "",
    scopes: list[dict] | None = None,
    target_type: str = "",
) -> ExtractionResult:
    """按 ep 契约抽取一条编目元数据建议。

    - LLM 可用：LLM 生成 JSON（提示词含字段语义与拒答纪律），解析/校验失败自动降级；
    - LLM 不可用或内容不足：确定性抽取原文可推导字段（summary/description/
      tags/evidence/scopeHints），类型/分类代码类字段保持空字符串，不给无依据建议值。
    """
    chunks = _parse_document_chunks(document_id=document_id, file_path=file_path)
    parts = [re.sub(r"\s+", " ", (chunk.content or "").strip()) for chunk in chunks]
    parts = [part for part in parts if part]
    if not parts:
        # 拒答纪律：没有可抽取内容时不编造建议。
        return ExtractionResult()

    result = ExtractionResult(
        name=_clean_text(title or document_id, 120),
        scopeHints=_scope_hints(scopes),
        evidence=_evidence_lines(document_id, title, chunks),
    )
    if _llm_live():
        try:
            llm_result = _extract_via_llm(
                title=result.name,
                target_type=target_type,
                scope_hints=result.scopeHints,
                parts=parts,
            )
            if llm_result is not None:
                return llm_result
        except Exception:
            logger.debug("LLM extraction failed, falling back to deterministic extractor", exc_info=True)

    _fill_deterministic(result, parts)
    return result


def _extract_via_llm(
    *,
    title: str,
    target_type: str,
    scope_hints: list[str],
    parts: list[str],
) -> ExtractionResult | None:
    """LLM JSON 抽取；结构化输出缺失/不合法时返回 None，由调用方降级。"""
    from ..llm.client import chat as llm_chat

    context = "\n".join(parts)[:_LLM_CONTEXT_CHARS]
    schema_hint = json.dumps(
        {
            "name": "str（简短名称）",
            "description": "str（一两句内容/功能描述）",
            "assetTypeCode": "str（英文代码，不确定留空）",
            "tags": ["str（3-8 个标签）"],
            "summary": "str（≤200字摘要）",
            "categoryCode": "str（英文代码，不确定留空）",
            "scopeHints": ["str（正文出现的产线/基地/平台等范围取值）"],
            "evidence": ["str（抽取依据的原文要点，每条≤80字）"],
            "confidence": "number（0~1）",
        },
        ensure_ascii=False,
    )
    system = (
        "你是企业产线知识库的资产/文档编目抽取器，只输出 JSON，不要任何解释。\n"
        "根据给定文档内容给出“建议性编目字段”，供人工确认：\n"
        f"- 目标类型 targetType：{target_type or '未知'}\n"
        "- 纪律：全部依据原文；原文没有依据的字段一律保持空字符串/空数组；"
        "内容与目标无关或信息不足时所有字段留空、confidence 置 0，绝不编造。\n"
        f"输出 JSON 结构：\n{schema_hint}"
    )
    user = (
        f"文档名：{title}\n"
        f"已知范围提示：{('、'.join(scope_hints)) or '无'}\n"
        f"文档内容：\n{context}"
    )
    response = llm_chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.1,
        response_format={"type": "json_object"},
    )
    parsed = _parse_json_object(str(response.get("content") or ""))
    return _coerce_extraction_result(parsed)


def _coerce_extraction_result(payload: dict[str, Any]) -> ExtractionResult | None:
    """把 LLM JSON 收敛到契约模型；结构不合法返回 None 走降级。"""
    if not isinstance(payload, dict):
        return None

    def text(key: str) -> str:
        value = payload.get(key)
        return _clean_text(value, 200) if value is not None else ""

    def string_list(key: str) -> list[str]:
        value = payload.get(key)
        if not isinstance(value, list):
            return []
        cleaned: list[str] = []
        for item in value:
            item_text = _clean_text(item, 80)
            if item_text and item_text not in cleaned:
                cleaned.append(item_text)
        return cleaned

    try:
        return ExtractionResult(
            name=text("name"),
            description=text("description"),
            assetTypeCode=text("assetTypeCode"),
            tags=string_list("tags")[:_MAX_TAGS],
            summary=text("summary"),
            categoryCode=text("categoryCode"),
            scopeHints=string_list("scopeHints"),
            evidence=string_list("evidence"),
            confidence=_clamp_confidence(payload.get("confidence")),
        )
    except (TypeError, ValueError):
        return None


def _fill_deterministic(result: ExtractionResult, parts: list[str]) -> None:
    """离线/降级路径：只填原文可推导字段，代码类字段保持空（无依据不猜）。"""
    text = " ".join(parts)
    summary = _first_summary(text)
    if summary:
        result.summary = summary
        result.description = summary if len(summary) < 140 else summary[:140]
    tags = _extract_tags(text)
    if tags:
        result.tags = tags
    if result.summary or result.evidence:
        result.confidence = 0.6


def _first_summary(text: str, limit: int = 200) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip(" ，。；;、,.!?！？")
    if not cleaned:
        return ""
    head = cleaned[:limit]
    # 尽量在句末符号处截断，保持摘要可读。
    for sep in ("。", ". ", "！", "？"):
        cut = head.rfind(sep)
        if cut > limit // 2:
            return head[: cut + 1]
    return head


def _extract_tags(text: str, limit: int = _MAX_TAGS) -> list[str]:
    candidates = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{1,}|[\u4e00-\u9fff]{2,12}", text)
    counter: Counter[str] = Counter()
    for candidate in candidates:
        normalized = candidate.strip().lower()
        if not normalized or candidate in _STOPWORDS or re.fullmatch(r"\d+", normalized):
            continue
        if len(candidate) < 2:
            continue
        # 含数字/拉丁字符的术语更可能是关键实体，加权。
        weight = 3 if re.search(r"[A-Za-z0-9]", candidate) else 1
        counter[candidate] += weight
    ranked = [word for word, _count in counter.most_common(limit * 3)]
    tags: list[str] = []
    for word in ranked:
        if word not in tags:
            tags.append(word)
        if len(tags) >= limit:
            break
    return tags


def _evidence_lines(document_id: str, title: str, chunks) -> list[str]:
    lines: list[str] = []
    label = title or document_id or "文档"
    for chunk in chunks[:_MAX_EVIDENCE]:
        snippet = re.sub(r"\s+", " ", chunk.content or "").strip()
        if not snippet:
            continue
        location = chunk.section_path or (f"第{chunk.page_number}页" if chunk.page_number else "正文")
        lines.append(f"{label}｜{location}｜{snippet[:_EVIDENCE_SNIPPET_CHARS]}")
    return lines


def _scope_hints(scopes: list[dict] | None) -> list[str]:
    hints: list[str] = []
    for scope in scopes or []:
        if not isinstance(scope, dict):
            continue
        for value in scope.values():
            item = str(value or "").strip()
            if item and item not in hints:
                hints.append(item)
    return hints[:12]


def _clean_text(value: Any, limit: int) -> str:
    if value is None:
        return ""
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    return cleaned[:limit]


def _clamp_confidence(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def _parse_json_object(content: str) -> dict[str, Any]:
    text = content.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fenced:
        text = fenced.group(1)
    elif not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise TypeError("extraction response must be a JSON object")
    return parsed
