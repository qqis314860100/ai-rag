from __future__ import annotations

import re
from typing import Any, Mapping

from ..schemas.models import AnswerWarning, ImageArtifactContract


_SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("email", re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")),
    ("phone", re.compile(r"(?<!\d)(?:\+?\d[\d -]{7,}\d)(?!\d)")),
    ("api_key", re.compile(r"\b(?:sk|ak|key|token)[-_]?[A-Za-z0-9]{12,}\b", re.I)),
    ("long_id", re.compile(r"\b[A-Za-z0-9_-]{24,}\b")),
)


def _source_id(source: Mapping[str, Any], index: int) -> str:
    return str(source.get("id") or source.get("chunk_id") or f"source-{index}")


def _document_id(source: Mapping[str, Any]) -> str:
    return str(source.get("document_id") or "")


def _redact(text: str) -> tuple[str, dict[str, int]]:
    report: dict[str, int] = {}
    redacted = text
    for code, pattern in _SENSITIVE_PATTERNS:
        redacted, count = pattern.subn(f"[已脱敏:{code}]", redacted)
        if count:
            report[code] = count
    return redacted, report


def build_image_artifact_contract(
    *,
    question: str,
    answer: str,
    sources: list[Mapping[str, Any]],
    requested_by_user: bool = False,
) -> ImageArtifactContract:
    source_ids: list[str] = []
    document_ids: list[str] = []
    snippets: list[str] = []
    for index, source in enumerate(sources, 1):
        source_id = _source_id(source, index)
        document_id = _document_id(source)
        if source_id not in source_ids:
            source_ids.append(source_id)
        if document_id and document_id not in document_ids:
            document_ids.append(document_id)
        snippet = str(source.get("snippet") or source.get("content") or "").strip()
        if snippet:
            snippets.append(snippet[:220])

    raw_prompt = "\n".join([
        f"用户问题：{question.strip()}",
        f"回答摘要：{answer.strip()[:900]}",
        "引用依据：",
        *[f"- {snippet}" for snippet in snippets[:4]],
        "请生成企业知识库场景下的清晰示意图，必须忠于引用证据，不补充未出现的参数和结论。",
    ])
    sanitized_prompt, report = _redact(raw_prompt)
    warnings: list[AnswerWarning] = []

    if not requested_by_user:
        warnings.append(AnswerWarning(
            code="image_requires_explicit_request",
            message="图片产物必须由用户明确触发，本阶段不自动生成。",
            severity="info",
        ))
    if not source_ids:
        warnings.append(AnswerWarning(
            code="image_requires_sources",
            message="图片产物必须继承可追溯引用，当前回答没有有效来源。",
            severity="warning",
        ))

    allowed = requested_by_user and bool(source_ids)
    return ImageArtifactContract(
        allowed=allowed,
        sanitized_prompt=sanitized_prompt[:1600],
        inherited_source_ids=source_ids,
        inherited_document_ids=document_ids,
        redaction_report=report,
        safety_warnings=warnings,
        metadata={
            "provider": "not_configured",
            "permission_model": "inherit_from_chat_message_and_sources",
            "default_auto_generate": False,
            "requires_async_worker": True,
        },
    )
