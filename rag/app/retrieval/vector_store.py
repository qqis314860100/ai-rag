import logging
import os
import re

import chromadb
from chromadb.config import Settings

from ..chunking.chunker import Chunk
from ..core.config import config
from ..core.source_metadata import (
    build_source_metadata,
    infer_content_kind,
    infer_mime_type,
    normalize_source_format,
)
from ..schemas.models import SourceMetadata

logger = logging.getLogger(__name__)

_client = None
# collection 缓存：以解析后的 collection 名为键，支持多语料命名空间各自缓存实例。
_collections: dict[str, object] = {}
CONTEXT_SNIPPET_CHARS = 400

# ep 等外部调用方 scope 维度（见 AI 能力服务契约），入库时折入 chunk metadata 便于检索过滤。
SCOPE_DIMENSION_KEYS: tuple[str, ...] = (
    "platformFamily",
    "platformVariant",
    "productLine",
    "base",
    "productionLine",
    "processSection",
)


def _normalize_namespace(namespace: str | None) -> str:
    return (namespace or "").strip().lower()


def resolve_collection_name(namespace: str | None) -> str:
    """把请求 namespace 解析为实际 Chroma collection 名。

    - 空值或电池别名（battery / 配置默认标签 / 默认 collection 名）→ config.chroma_collection，
      保证存量电池语料路径行为不变；
    - 其它 namespace 优先使用 RAG_NAMESPACE_COLLECTION_<大写NS> 显式映射，
      否则按 "ns_<净化后的namespace>" 规则自动生成独立 collection。
    """
    ns = _normalize_namespace(namespace)
    if not ns or ns in {
        "battery",
        config.rag_namespace_default,
        config.chroma_collection.lower(),
    }:
        return config.chroma_collection
    safe = re.sub(r"[^a-z0-9]+", "_", ns).strip("_")
    explicit_key = f"RAG_NAMESPACE_COLLECTION_{safe.upper()}"
    explicit = os.getenv(explicit_key, "").strip()
    if explicit:
        return explicit
    return f"ns_{safe}" if safe else config.chroma_collection


def _get_collection(namespace: str | None = None):
    global _client
    name = resolve_collection_name(namespace)
    if name in _collections:
        return _collections[name]
    if _client is None:
        os.makedirs(config.chroma_persist_dir, exist_ok=True)
        _client = chromadb.PersistentClient(
            path=config.chroma_persist_dir,
            settings=Settings(anonymized_telemetry=False),
        )
    collection = _client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )
    logger.info(f"ChromaDB collection '{name}' ready (namespace={namespace!r}), "
                f"count={collection.count()}")
    _collections[name] = collection
    return collection


def upsert_chunks(chunks: list[Chunk], namespace: str | None = None) -> int:
    if not chunks:
        return 0

    col = _get_collection(namespace)
    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict] = []
    embeddings: list[list[float]] = []

    # Build embedding texts and compute embeddings
    from ..embedding.service import build_embedding_text, embed_texts

    texts_to_embed: list[str] = []
    for c in chunks:
        chunk_dict = {
            "chunk_id": c.chunk_id,
            "document_id": c.document_id,
            "title": c.title,
            "section_path": c.section_path,
            "content": c.content,
            "metadata": c.metadata,
        }
        texts_to_embed.append(build_embedding_text(chunk_dict))

    embeddings = embed_texts(texts_to_embed)

    for i, c in enumerate(chunks):
        ids.append(c.chunk_id)
        documents.append(c.content)
        file_type = c.metadata.get("file_type") or c.metadata.get("source_format", "")
        source_format = normalize_source_format(c.metadata.get("source_format") or file_type)
        mime_type = c.metadata.get("mime_type") or infer_mime_type(file_type)
        content_kind = c.metadata.get("content_kind") or infer_content_kind(file_type, mime_type)
        md = {
            "document_id": c.document_id,
            "document_title": c.metadata.get("title") or c.title,
            "title": c.metadata.get("title") or c.title,
            "chunk_title": c.title,
            "section_path": c.section_path,
            "section_title": c.metadata.get("section", ""),
            "section_level": c.metadata.get("section_level", 0),
            "page_number": c.page_number,
            "chunk_index": i,
            "chunk_type": c.metadata.get("chunk_type", "text"),
            "status": c.metadata.get("status", "active"),
            "security_level": c.metadata.get("security_level", "internal"),
            "category": c.metadata.get("category", ""),
            "version": c.metadata.get("version", ""),
            "chapter_num": c.metadata.get("chapter_num"),
            "chapter_title": c.metadata.get("chapter_title", ""),
            "source_format": source_format,
            "file_type": file_type,
            "mime_type": mime_type,
            "document_type": source_format,
            "format": source_format,
            "content_kind": content_kind,
            "preview_format": c.metadata.get("preview_format") or content_kind,
            "offset_start": c.metadata.get("offset_start"),
            "offset_end": c.metadata.get("offset_end"),
            "offset_unit": c.metadata.get("offset_unit", "char"),
            "snippet": c.metadata.get("snippet") or c.content[:200],
        }
        # scope 维度（platformFamily/productLine/base 等）随 chunk 写入数组值，
        # 供检索 $contains（数组包含成员）做精确过滤
        for scope_key in SCOPE_DIMENSION_KEYS:
            scope_values = c.metadata.get(scope_key)
            if scope_values:
                md[scope_key] = list(scope_values)
        # ChromaDB doesn't support complex types in metadata
        tags = c.metadata.get("tags", [])
        if isinstance(tags, list):
            md["tags"] = ",".join(tags)
        elif isinstance(tags, str):
            md["tags"] = tags

        md = {k: v for k, v in md.items() if v is not None}
        metadatas.append(md)

    col.upsert(
        ids=ids,
        documents=documents,
        metadatas=metadatas,
        embeddings=embeddings,
    )

    return len(chunks)


def search(
    query_embedding: list[float],
    allowed_security_levels: list[str],
    top_k: int = 5,
    filters: dict | None = None,
    namespace: str | None = None,
    scopes: list[dict] | None = None,
) -> list[dict]:
    col = _get_collection(namespace)

    if col.count() == 0:
        return []

    where: dict = {}
    if allowed_security_levels:
        where["security_level"] = {"$in": allowed_security_levels}
    if filters:
        if filters.get("category"):
            where["category"] = filters["category"]
        if filters.get("document_id"):
            where["document_id"] = filters["document_id"]
        if filters.get("tags"):
            where["tags"] = {"$contains": filters["tags"]}

    scope_where = _scope_where(scopes)
    if scope_where:
        where = _merge_where(where, scope_where)

    if not where:
        where = {}

    n_results = top_k * 3 if where else top_k

    results = col.query(
        query_embeddings=[query_embedding],
        n_results=min(n_results, col.count()),
        where=where if where else None,
        include=["documents", "metadatas", "distances"],
    )

    hits: list[dict] = []
    if results and results["ids"] and results["ids"][0]:
        cache: dict[str, dict[int, dict[str, str]]] = {}
        for i, chunk_id in enumerate(results["ids"][0]):
            metadata = results["metadatas"][0][i] if results["metadatas"] else {}
            # Filter by status=active
            if metadata.get("status", "active") != "active":
                continue
            distance = results["distances"][0][i] if results["distances"] else 0
            score = 1.0 - distance  # cosine distance to similarity
            content = results["documents"][0][i] if results["documents"] else ""
            hits.append(_map_chunk_hit(col, cache, chunk_id, metadata, content, score))

    return hits[:top_k]


def _map_chunk_hit(col, cache, chunk_id: str, metadata: dict, content: str, score: float) -> dict:
    """把一条 Chroma 行映射为检索命中对象（向量路与词法候选路共用）。"""
    snippet = metadata.get("snippet") or content[:200]
    document_id = metadata.get("document_id", "")
    chunk_index = metadata.get("chunk_index", 0)
    source_context = _build_source_context(
        col=col,
        document_id=document_id,
        chunk_index=chunk_index,
        content=content,
        snippet=snippet,
        page_number=metadata.get("page_number", 0),
        offset_start=metadata.get("offset_start"),
        offset_end=metadata.get("offset_end"),
        offset_unit=metadata.get("offset_unit", "char"),
        cache=cache,
    )
    raw_hit = {
        "chunk_id": chunk_id,
        "document_id": document_id,
        "document_title": metadata.get("document_title") or metadata.get("title", ""),
        "section_path": metadata.get("section_path", ""),
        "page_number": metadata.get("page_number", 0),
        "chunk_index": chunk_index,
        "section_level": metadata.get("section_level", 0),
        "document_type": metadata.get("source_format") or metadata.get("document_type", ""),
        "source_format": metadata.get("source_format", ""),
        "file_type": metadata.get("file_type") or metadata.get("source_format", ""),
        "mime_type": metadata.get("mime_type", ""),
        "format": metadata.get("format") or metadata.get("source_format", ""),
        "content_kind": metadata.get("content_kind", ""),
        "category": metadata.get("category", ""),
        "version": metadata.get("version", ""),
        "offset_start": metadata.get("offset_start"),
        "offset_end": metadata.get("offset_end"),
        "snippet": snippet,
        "content": content,
        "score": round(score, 4),
        "source_context": source_context,
        "context_before": source_context["before"],
        "context_after": source_context["after"],
        "context_window": source_context["window"],
        "metadata": metadata,
    }
    normalized_hit = build_source_metadata(raw_hit)
    normalized_hit["source_metadata"] = SourceMetadata.from_source(normalized_hit).model_dump()
    return normalized_hit


def fetch_active_chunks(
    namespace: str | None = None,
    allowed_security_levels: list[str] | None = None,
) -> list[dict]:
    """整仓 active chunk 原始行（词法候选路用）；行含 chunk_id/content/metadata。"""
    col = _get_collection(namespace)
    if col.count() == 0:
        return []
    where = {}
    if allowed_security_levels:
        where["security_level"] = {"$in": allowed_security_levels}
    result = col.get(
        where=where or None,
        include=["documents", "metadatas"],
    )
    rows: list[dict] = []
    for chunk_id, doc, meta in zip(
        result["ids"], result["documents"], result["metadatas"]
    ):
        if meta.get("status", "active") != "active":
            continue
        rows.append({"chunk_id": chunk_id, "content": doc or "", "metadata": meta})
    return rows


def build_hits_from_rows(rows: list[dict], namespace: str | None = None) -> list[dict]:
    """把带 score 的原始行映射为检索命中对象（词法候选路用）。"""
    col = _get_collection(namespace)
    cache: dict[str, dict[int, dict[str, str]]] = {}
    hits: list[dict] = []
    for row in rows:
        metadata = row.get("metadata") or {}
        hits.append(
            _map_chunk_hit(
                col,
                cache,
                row["chunk_id"],
                metadata,
                row.get("content", ""),
                row.get("score", 0.0),
            )
        )
    return hits


def _scope_where(scopes: list[dict] | None) -> dict | None:
    """把请求 scopes 列表翻译成 Chroma where 子句。

    语义：空/全空对象视为不限（None）；文档命中任一非空 scope 对象即视为在
    范围内（$or），单个对象内所有非空维度都要与 chunk metadata 一致（$and）。
    入库时每个维度以数组值存储，$contains 在这里是“数组包含该成员”的精确
    匹配，单值与多值场景行为一致，无子串歧义。
    """
    groups: list[dict] = []
    for scope in scopes or []:
        if not isinstance(scope, dict):
            continue
        dims = {
            key: str(value).strip()
            for key, value in scope.items()
            if key in SCOPE_DIMENSION_KEYS
            and value is not None
            and str(value).strip()
        }
        if not dims:
            continue
        dim_conditions = [{key: {"$contains": value}} for key, value in sorted(dims.items())]
        if len(dim_conditions) == 1:
            groups.append(dim_conditions[0])
        else:
            groups.append({"$and": dim_conditions})
    if not groups:
        return None
    if len(groups) == 1:
        return groups[0]
    return {"$or": groups}


def _merge_where(base: dict, extra: dict) -> dict:
    """把 scope 子句与既有检索过滤（security/filters）合并为单个 where。"""
    if not base:
        return extra
    if not extra:
        return base
    return {"$and": [base, extra]}


def _build_source_context(
    col,
    document_id: str,
    chunk_index: int | str,
    content: str,
    snippet: str,
    page_number: int | str,
    offset_start: int | str | None,
    offset_end: int | str | None,
    offset_unit: str,
    cache: dict[str, dict[int, dict[str, str]]],
) -> dict:
    index = _coerce_int(chunk_index)
    neighbors = _load_document_context(col, document_id, cache) if document_id else {}
    before = _trim_context(neighbors.get(index - 1, {}).get("content", ""))
    after = _trim_context(neighbors.get(index + 1, {}).get("content", ""))
    window = "\n\n".join(part for part in (before, content, after) if part)

    return {
        "content": content,
        "snippet": snippet,
        "before": before,
        "after": after,
        "window": window,
        "page_number": _coerce_int(page_number),
        "offset_start": _coerce_optional_int(offset_start),
        "offset_end": _coerce_optional_int(offset_end),
        "offset_unit": offset_unit or "char",
        "available": bool(content or snippet or before or after),
    }


def _load_document_context(col, document_id: str, cache: dict[str, dict[int, dict[str, str]]]) -> dict[int, dict[str, str]]:
    if document_id in cache:
        return cache[document_id]

    result = col.get(
        where={"document_id": document_id},
        include=["documents", "metadatas"],
    )
    rows: dict[int, dict[str, str]] = {}
    if not result:
        cache[document_id] = rows
        return rows

    ids = result.get("ids") or []
    documents = result.get("documents") or []
    metadatas = result.get("metadatas") or []

    for i, chunk_id in enumerate(ids):
        metadata = metadatas[i] if i < len(metadatas) and isinstance(metadatas[i], dict) else {}
        index = _coerce_int(metadata.get("chunk_index", i))
        rows[index] = {
            "chunk_id": str(chunk_id),
            "content": documents[i] if i < len(documents) and isinstance(documents[i], str) else "",
        }

    cache[document_id] = rows
    return rows


def _trim_context(text: str, limit: int = CONTEXT_SNIPPET_CHARS) -> str:
    cleaned = text.strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip()


def _coerce_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _coerce_optional_int(value) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def delete_by_document(document_id: str, namespace: str | None = None) -> int:
    col = _get_collection(namespace)
    # Get all chunks for this document
    result = col.get(where={"document_id": document_id})
    if result and result["ids"]:
        col.delete(ids=result["ids"])
        return len(result["ids"])
    return 0


def get_collection_count(namespace: str | None = None) -> int:
    return _get_collection(namespace).count()
