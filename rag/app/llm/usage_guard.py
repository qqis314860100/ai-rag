import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.config import config

logger = logging.getLogger(__name__)


class LlmBudgetExceeded(Exception):
    """Raised before an upstream LLM call when local budget limits are exceeded."""


def estimate_input_chars(messages: list[dict[str, str]]) -> int:
    return sum(len(m.get("content", "")) for m in messages)


def _usage_log_path() -> Path:
    path = Path(config.llm_usage_log_path)
    if not path.is_absolute():
        path = Path(config.project_root) / path
    return path


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _iter_today_records() -> list[dict[str, Any]]:
    path = _usage_log_path()
    if not path.exists():
        return []

    records: list[dict[str, Any]] = []
    today = _today()
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if str(record.get("date")) == today and record.get("status") == "success":
                    records.append(record)
    except OSError as e:
        logger.warning("Failed to read LLM usage log: %s", e)
    return records


def check_budget(input_chars: int) -> None:
    if config.llm_max_input_chars_per_request > 0 and input_chars > config.llm_max_input_chars_per_request:
        raise LlmBudgetExceeded(
            f"单次输入过大：{input_chars} 字符，限制 {config.llm_max_input_chars_per_request} 字符。"
        )

    records = _iter_today_records()
    if config.llm_daily_request_limit > 0 and len(records) >= config.llm_daily_request_limit:
        raise LlmBudgetExceeded(
            f"今日 LLM 请求已达上限：{len(records)}/{config.llm_daily_request_limit}。"
        )

    used_input_chars = sum(int(r.get("input_chars") or 0) for r in records)
    next_total = used_input_chars + input_chars
    if config.llm_daily_input_char_limit > 0 and next_total > config.llm_daily_input_char_limit:
        raise LlmBudgetExceeded(
            f"今日 LLM 输入字符将超限：{next_total}/{config.llm_daily_input_char_limit}。"
        )


def usage_summary() -> dict[str, Any]:
    records = _iter_today_records()
    input_chars = sum(int(r.get("input_chars") or 0) for r in records)
    output_chars = sum(int(r.get("output_chars") or 0) for r in records)
    return {
        "date": _today(),
        "model": config.deepseek_model,
        "usage_log_path": str(_usage_log_path()),
        "success_requests": len(records),
        "input_chars": input_chars,
        "output_chars": output_chars,
        "limits": {
            "max_input_chars_per_request": config.llm_max_input_chars_per_request,
            "daily_request_limit": config.llm_daily_request_limit,
            "daily_input_char_limit": config.llm_daily_input_char_limit,
        },
    }


def record_usage(
    *,
    mode: str,
    model: str,
    input_chars: int,
    output_chars: int = 0,
    latency_ms: int = 0,
    status: str = "success",
    error: str = "",
) -> None:
    path = _usage_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    record = {
        "ts": now.isoformat(),
        "date": now.date().isoformat(),
        "mode": mode,
        "model": model,
        "input_chars": input_chars,
        "output_chars": output_chars,
        "latency_ms": latency_ms,
        "status": status,
        "error": error[:500],
    }
    try:
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as e:
        logger.warning("Failed to write LLM usage log: %s", e)
