import os
import logging
import chromadb
from chromadb.config import Settings
from ..core.config import config
from ..core.source_metadata import build_source_metadata, infer_content_kind, infer_mime_type
from ..chunking.chunker import Chunk
from ..schemas.models import SourceMetadata

logger = logging.getLogger(__name__)

_client = None
_collection = None


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
        source_format = c.metadata.get("source_format", "")
        mime_type = c.metadata.get("mime_type") or infer_mime_type(source_format)
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
            "file_type": source_format,
            "mime_type": mime_type,
            "document_type": source_format,
            "format": source_format,
            "content_kind": c.metadata.get("content_kind") or infer_content_kind(source_format, mime_type),
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
    if results and results["ids"] and results["ids"][0]:
        for i, chunk_id in enumerate(results["ids"][0]):
            metadata = results["metadatas"][0][i] if results["metadatas"] else {}
            # Filter by status=active
            if metadata.get("status", "active") != "active":
                continue
            distance = results["distances"][0][i] if results["distances"] else 0
            score = 1.0 - distance  # cosine distance to similarity
            raw_hit = {
                "chunk_id": chunk_id,
                "document_id": metadata.get("document_id", ""),
                "document_title": metadata.get("document_title") or metadata.get("title", ""),
                "section_path": metadata.get("section_path", ""),
                "page_number": metadata.get("page_number", 0),
                "chunk_index": metadata.get("chunk_index", 0),
                "section_level": metadata.get("section_level", 0),
                "document_type": metadata.get("source_format") or metadata.get("document_type", ""),
                "source_format": metadata.get("source_format", ""),
                "file_type": metadata.get("file_type") or metadata.get("source_format", ""),
                "mime_type": metadata.get("mime_type", ""),
                "format": metadata.get("format") or metadata.get("source_format", ""),
                "category": metadata.get("category", ""),
                "version": metadata.get("version", ""),
                "offset_start": metadata.get("offset_start"),
                "offset_end": metadata.get("offset_end"),
                "snippet": metadata.get("snippet") or (results["documents"][0][i] if results["documents"] else "")[:200],
                "content": results["documents"][0][i] if results["documents"] else "",
                "score": round(score, 4),
                "metadata": metadata,
            }
            normalized_hit = build_source_metadata(raw_hit)
            normalized_hit["source_metadata"] = SourceMetadata.from_source(normalized_hit).model_dump()
            hits.append(normalized_hit)

    return hits[:top_k]


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
