import os
import logging
import chromadb
from chromadb.config import Settings
from ..core.config import config
from ..core.source_metadata import build_source_metadata, infer_content_kind, infer_mime_type, normalize_source_format
from ..chunking.chunker import Chunk
from ..schemas.models import SourceMetadata

logger = logging.getLogger(__name__)

_client = None
_collection = None
CONTEXT_SNIPPET_CHARS = 400


def _get_collection():
    global _client, _collection
    if _collection is None:
        os.makedirs(config.chroma_persist_dir, exist_ok=True)
        _client = chromadb.PersistentClient(
            path=config.chroma_persist_dir,
            settings=Settings(anonymized_telemetry=False),
        )
        _collection = _client.get_or_create_collection(
            name=config.chroma_collection,
            metadata={"hnsw:space": "cosine"},
        )
        logger.info(f"ChromaDB collection '{config.chroma_collection}' ready, "
                     f"count={_collection.count()}")
    return _collection


def upsert_chunks(chunks: list[Chunk]) -> int:
    if not chunks:
        return 0

    col = _get_collection()
    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict] = []
    embeddings: list[list[float]] = []

    # Build embedding texts and compute embeddings
    from ..embedding.service import embed_texts, build_embedding_text

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
) -> list[dict]:
    col = _get_collection()

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
    document_context_cache: dict[str, dict[int, dict[str, str]]] = {}
    if results and results["ids"] and results["ids"][0]:
        for i, chunk_id in enumerate(results["ids"][0]):
            metadata = results["metadatas"][0][i] if results["metadatas"] else {}
            # Filter by status=active
            if metadata.get("status", "active") != "active":
                continue
            distance = results["distances"][0][i] if results["distances"] else 0
            score = 1.0 - distance  # cosine distance to similarity
            content = results["documents"][0][i] if results["documents"] else ""
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
                cache=document_context_cache,
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
            hits.append(normalized_hit)

    return hits[:top_k]


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


def delete_by_document(document_id: str) -> int:
    col = _get_collection()
    # Get all chunks for this document
    result = col.get(where={"document_id": document_id})
    if result and result["ids"]:
        col.delete(ids=result["ids"])
        return len(result["ids"])
    return 0


def get_collection_count() -> int:
    return _get_collection().count()
