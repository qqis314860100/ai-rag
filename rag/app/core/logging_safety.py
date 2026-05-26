from __future__ import annotations

import hashlib
import json
from typing import Any


SENSITIVE_TEXT_KEYS = {
    "answer",
    "content",
    "context",
    "context_after",
    "context_before",
    "context_window",
    "messages",
    "prompt",
    "prompt_preview",
    "query",
    "snippet",
}


def sha256_short(value: Any) -> str:
    text = "" if value is None else str(value)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def safe_text_summary(value: Any, limit: int = 120) -> dict[str, Any]:
    text = "" if value is None else str(value)
    return {
        "sha256": sha256_short(text),
        "chars": len(text),
        "preview": text[:limit],
        "truncated": len(text) > limit,
    }


def safe_content_marker(value: Any) -> dict[str, Any]:
    text = "" if value is None else str(value)
    return {
        "sha256": sha256_short(text),
        "chars": len(text),
        "redacted": True,
    }


def safe_log_payload(payload: Any) -> Any:
    if isinstance(payload, dict):
        sanitized: dict[str, Any] = {}
        for key, value in payload.items():
            if key in SENSITIVE_TEXT_KEYS:
                sanitized[key] = safe_content_marker(value)
            else:
                sanitized[key] = safe_log_payload(value)
        return sanitized
    if isinstance(payload, list):
        return [safe_log_payload(item) for item in payload]
    return payload


def safe_log_json(payload: dict[str, Any]) -> str:
    return json.dumps(safe_log_payload(payload), ensure_ascii=False)

