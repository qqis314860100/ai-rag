import hashlib
import logging
import time

from ..core.config import config

logger = logging.getLogger(__name__)

_embedding_model = None
_use_fallback = False
EMBEDDING_DIM = 384


def _get_model():
    global _embedding_model, _use_fallback
    if _embedding_model is None and not _use_fallback:
        if config.embedding_model == "fallback":
            logger.info("Fallback embedding mode configured, skipping model load")
            _use_fallback = True
            return None
        try:
            from sentence_transformers import SentenceTransformer
            logger.info(f"Loading embedding model: {config.embedding_model}")
            _embedding_model = SentenceTransformer(config.embedding_model)
            logger.info("Embedding model loaded successfully")
        except Exception as e:  # noqa: BLE001 - any model failure must fall back
            logger.warning(f"Failed to load model: {e}. Using fallback embeddings.")
            _use_fallback = True
    return _embedding_model


def _fallback_embed(text: str) -> list[float]:
    vec = [0.0] * EMBEDDING_DIM
    for i in range(len(text) - 1):
        bigram = text[i:i + 2].encode("utf-8", errors="ignore")
        h = int(hashlib.md5(bigram).hexdigest()[:8], 16)
        vec[h % EMBEDDING_DIM] += 0.01
    norm = sum(v * v for v in vec) ** 0.5
    return [v / norm for v in vec] if norm > 0 else vec


def embed_texts(texts: list[str], batch_size: int | None = None) -> list[list[float]]:
    global _use_fallback
    if not texts:
        return []
    if _use_fallback:
        return [_fallback_embed(t) for t in texts]

    bs = batch_size or config.embedding_batch_size
    model = _get_model()
    if model is None:
        _use_fallback = True
        return [_fallback_embed(t) for t in texts]

    try:
        embeddings: list[list[float]] = []
        for i in range(0, len(texts), bs):
            batch = texts[i:i + bs]
            start = time.time()
            result = model.encode(batch, normalize_embeddings=True)
            elapsed = (time.time() - start) * 1000
            logger.debug(f"Embedded batch {i // bs + 1}, {len(batch)} texts, {elapsed:.0f}ms")
            for vec in result:
                embeddings.append(vec.tolist())
        return embeddings
    except Exception as e:  # noqa: BLE001 - any embed failure must fall back
        logger.warning(f"Embed failed: {e}, switching to fallback")
        _use_fallback = True
        return [_fallback_embed(t) for t in texts]


def embed_query(query: str) -> list[float]:
    global _use_fallback
    if _use_fallback:
        return _fallback_embed(query)
    try:
        model = _get_model()
        if model is None:
            _use_fallback = True
            return _fallback_embed(query)
        return model.encode([query], normalize_embeddings=True)[0].tolist()
    except Exception as e:  # noqa: BLE001 - any embed failure must fall back
        logger.warning(f"Query embed failed: {e}, using fallback")
        _use_fallback = True
        return _fallback_embed(query)


def build_embedding_text(chunk: dict) -> str:
    parts = []
    if chunk.get("title"):
        parts.append(f"标题：{chunk['title']}")
    if chunk.get("section_path"):
        parts.append(f"章节：{chunk['section_path']}")
    metadata = chunk.get("metadata", {})
    if metadata.get("category"):
        parts.append(f"分类：{metadata['category']}")
    parts.append(f"正文：{chunk.get('content', '')}")
    return "\n".join(parts)
