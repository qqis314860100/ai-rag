"""Cross-encoder 重排器（bge-reranker 系，本地推理，不触网）。

懒加载模型、进程内缓存；任何失败返回 None，由调用方（retrieve.rerank_hits）
回退到本地混合重排，保证重排链路永不因模型问题中断。
"""

import logging

from ..core.config import config

logger = logging.getLogger(__name__)

_model = None
MAX_PAIR_CHARS = 1000


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import CrossEncoder

        logger.info("Loading cross-encoder reranker: %s", config.rag_rerank_cross_model)
        _model = CrossEncoder(
            config.rag_rerank_cross_model,
            device=config.rag_rerank_cross_device,
            max_length=512,
        )
        logger.info("Cross-encoder reranker loaded")
    return _model


def cross_rerank_scores(query: str, hits: list[dict], batch_size: int = 16) -> list[float] | None:
    """返回与 hits 等长的相关度分数；模型不可用或调用失败时返回 None。"""
    if not hits:
        return []
    try:
        model = _get_model()
    except Exception as exc:  # noqa: BLE001 - 模型加载失败必须可回退
        logger.warning("Cross-encoder load failed, rerank falls back to local: %s", exc)
        return None
    try:
        pairs = [(query, (hit.get("content") or "")[:MAX_PAIR_CHARS]) for hit in hits]
        return [float(score) for score in model.predict(pairs, batch_size=batch_size, show_progress_bar=False)]
    except Exception as exc:  # noqa: BLE001 - 推理失败必须可回退
        logger.warning("Cross-encoder rerank failed, falls back to local: %s", exc)
        return None
