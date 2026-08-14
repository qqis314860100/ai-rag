import logging
import time

from openai import OpenAI

from ..core.config import config
from .usage_guard import LlmBudgetExceeded, check_budget, estimate_input_chars, record_usage

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=config.deepseek_api_key or "mock-key",
            base_url=config.deepseek_base_url,
            # Retry transient upstream failures (429/5xx) with backoff
            max_retries=2,
            timeout=60.0,
        )
    return _client


def _has_api_key() -> bool:
    return bool(config.deepseek_api_key)


class LlmProviderError(Exception):
    """Raised when the upstream LLM call fails (after retries)."""


def chat(
    messages: list[dict[str, str]],
    temperature: float | None = None,
    stream: bool = False,
) -> dict:
    """
    Returns: { "content": str, "model": str, "latency_ms": int }
    """
    temp = temperature if temperature is not None else config.rag_temperature

    if not _has_api_key():
        logger.info("No DEEPSEEK_API_KEY set, using mock LLM response")
        return _mock_chat(messages)

    client = _get_client()
    start = time.time()
    input_chars = estimate_input_chars(messages)

    try:
        check_budget(input_chars)
        response = client.chat.completions.create(
            model=config.deepseek_model,
            messages=messages,
            temperature=temp,
            stream=stream,
            timeout=60,
        )
        if stream:
            return {"stream": response, "model": config.deepseek_model, "latency_ms": 0}
        elapsed_ms = int((time.time() - start) * 1000)
        content = response.choices[0].message.content or ""
        record_usage(
            mode="chat",
            model=config.deepseek_model,
            input_chars=input_chars,
            output_chars=len(content),
            latency_ms=elapsed_ms,
        )

        return {
            "content": content,
            "model": config.deepseek_model,
            "latency_ms": elapsed_ms,
        }
    except LlmBudgetExceeded as e:
        logger.warning("DeepSeek call blocked by local budget guard: %s", e)
        record_usage(
            mode="chat",
            model=config.deepseek_model,
            input_chars=input_chars,
            status="blocked",
            error=str(e),
        )
        return {
            "content": f"本次请求已被本地预算保护拦截：{e}",
            "model": config.deepseek_model + " (blocked)",
            "latency_ms": 0,
        }
    except Exception as e:
        logger.error(f"DeepSeek API error: {e}")
        record_usage(
            mode="chat",
            model=config.deepseek_model,
            input_chars=input_chars,
            status="error",
            error=str(e),
        )
        # Never fabricate answers on upstream failure: surface the error so the
        # caller can degrade explicitly (e.g. show a clear failure message).
        raise LlmProviderError(f"LLM provider error: {e}") from e

def chat_stream(messages: list[dict[str, str]], temperature: float | None = None):
    """Generator that yields SSE token strings from DeepSeek streaming response."""
    temp = temperature if temperature is not None else config.rag_temperature
    client = _get_client()

    if not _has_api_key():
        # Mock streaming
        mock = _mock_chat(messages)
        content = mock["content"]
        for i in range(0, len(content), 3):
            yield f"data: {_sse_json({'type': 'token', 'content': content[i:i+3]})}\n\n"
        yield f"data: {_sse_json({'type': 'done', 'model': mock['model'], 'latency_ms': mock['latency_ms']})}\n\n"
        return

    start = time.time()
    input_chars = estimate_input_chars(messages)
    output_chars = 0

    try:
        check_budget(input_chars)
        response = client.chat.completions.create(
            model=config.deepseek_model,
            messages=messages,
            temperature=temp,
            stream=True,
            timeout=60,
        )
        for chunk in response:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                output_chars += len(delta.content)
                yield f"data: {_sse_json({'type': 'token', 'content': delta.content})}\n\n"
        elapsed_ms = int((time.time() - start) * 1000)
        record_usage(
            mode="stream",
            model=config.deepseek_model,
            input_chars=input_chars,
            output_chars=output_chars,
            latency_ms=elapsed_ms,
        )
        yield f"data: {_sse_json({'type': 'done', 'model': config.deepseek_model, 'latency_ms': 0})}\n\n"
    except LlmBudgetExceeded as e:
        logger.warning("DeepSeek streaming call blocked by local budget guard: %s", e)
        record_usage(
            mode="stream",
            model=config.deepseek_model,
            input_chars=input_chars,
            status="blocked",
            error=str(e),
        )
        yield f"data: {_sse_json({'type': 'error', 'message': f'本次请求已被本地预算保护拦截：{e}'})}\n\n"
    except Exception as e:  # noqa: BLE001 - stream generators must surface errors as SSE events
        logger.error(f"DeepSeek streaming error: {e}")
        record_usage(
            mode="stream",
            model=config.deepseek_model,
            input_chars=input_chars,
            output_chars=output_chars,
            status="error",
            error=str(e),
        )
        yield f"data: {_sse_json({'type': 'error', 'message': str(e)})}\n\n"

def _sse_json(obj: dict) -> str:
    import json
    return json.dumps(obj, ensure_ascii=False)


def _mock_chat(messages: list[dict[str, str]], error: str = "") -> dict:
    context_texts: list[str] = []
    for m in messages:
        if m["role"] == "system":
            # Extract context snippets
            for line in m["content"].split("\n"):
                if line.startswith("内容："):
                    context_texts.append(line[3:])

    has_context = len(context_texts) > 0 and any(t.strip() for t in context_texts)

    if not has_context:
        answer = "抱歉，我在当前知识库中没有找到与您问题相关的信息。建议您检查知识库是否已索引，或尝试更换关键词提问。"
    elif error:
        answer = f"[Mock LLM - API Error: {error}]\n\n根据检索到的上下文，我提供以下参考信息：\n\n"
        for i, ctx in enumerate(context_texts[:3], 1):
            answer += f"{i}. {ctx[:200]}...\n\n"
    else:
        answer = "[Mock LLM - No API Key]\n\n基于知识库检索结果，我提供以下参考：\n\n"
        for i, ctx in enumerate(context_texts[:3], 1):
            answer += f"{i}. {ctx[:300]}...\n\n"

    return {
        "content": answer,
        "model": config.deepseek_model + " (mock)",
        "latency_ms": 0,
    }
