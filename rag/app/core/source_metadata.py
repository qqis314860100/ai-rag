from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping


FILE_TYPE_TO_MIME: dict[str, str] = {
    "md": "text/markdown",
    "markdown": "text/markdown",
    "txt": "text/plain",
    "text": "text/plain",
    "pdf": "application/pdf",
    "html": "text/html",
    "htm": "text/html",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "json": "application/json",
    "js": "text/javascript",
    "jsx": "text/javascript",
    "ts": "text/typescript",
    "tsx": "text/typescript",
    "css": "text/css",
    "csv": "text/csv",
    "xml": "application/xml",
    "yaml": "application/yaml",
    "yml": "application/yaml",
    "py": "text/x-python",
    "sh": "application/x-sh",
    "sql": "application/sql",
}

MIME_TO_FILE_TYPE: dict[str, str] = {
    "text/markdown": "md",
    "text/x-markdown": "md",
    "text/plain": "txt",
    "application/pdf": "pdf",
    "text/html": "html",
    "application/xhtml+xml": "html",
    "application/json": "json",
    "text/javascript": "js",
    "application/javascript": "js",
    "text/typescript": "ts",
    "text/css": "css",
    "text/csv": "csv",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/yaml": "yaml",
    "text/yaml": "yaml",
    "application/x-sh": "sh",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}


def _trimmed_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _first_int(*values: Any, default: int = 0) -> int:
    for value in values:
        coerced = _coerce_int(value)
        if coerced is not None:
            return coerced
    return default


def infer_file_type(*values: Any, file_path: str | None = None) -> str:
    for value in values:
        candidate = _trimmed_string(value).lower().lstrip(".")
        if not candidate:
            continue
        if "/" in candidate:
            mapped = MIME_TO_FILE_TYPE.get(candidate)
            if mapped:
                return mapped
            continue
        return candidate

    if file_path:
        suffix = Path(file_path).suffix.lower().lstrip(".")
        if suffix:
            return suffix

    return "unknown"


def infer_mime_type(file_type: str, fallback: str | None = None) -> str:
    normalized = _trimmed_string(file_type).lower().lstrip(".")
    if not normalized:
        return fallback or "application/octet-stream"
    return FILE_TYPE_TO_MIME.get(normalized, fallback or "application/octet-stream")


def infer_content_kind(file_type: str, mime_type: str) -> str:
    normalized = _trimmed_string(file_type).lower().lstrip(".")
    normalized_mime = _trimmed_string(mime_type).lower()

    if normalized in {"md", "markdown"} or normalized_mime == "text/markdown":
        return "markdown"
    if normalized in {"txt", "text"} or normalized_mime == "text/plain":
        return "text"
    if normalized == "pdf" or normalized_mime == "application/pdf":
        return "pdf"
    if normalized in {"html", "htm"} or normalized_mime in {"text/html", "application/xhtml+xml"}:
        return "html"
    if normalized == "docx" or normalized_mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return "docx"
    if normalized in {"json", "js", "jsx", "ts", "tsx", "css", "csv", "xml", "yaml", "yml", "py", "sh", "sql"}:
        return "code"
    if normalized_mime.startswith("text/"):
        return "text"
    if normalized_mime in {"application/json"} or "xml" in normalized_mime:
        return "code"
    if normalized == "unknown":
        return "unknown"
    return "binary"


def build_source_metadata(payload: Mapping[str, Any]) -> dict[str, Any]:
    metadata = dict(payload.get("metadata") or {})

    document = dict(payload.get("document") or {})
    section = dict(payload.get("section") or {})
    chunk = dict(payload.get("chunk") or {})
    page = dict(payload.get("page") or {})
    offset = dict(payload.get("offset") or {})

    file_type = infer_file_type(
        payload.get("source_format"),
        payload.get("file_type"),
        payload.get("document_type"),
        payload.get("format"),
        metadata.get("source_format"),
        metadata.get("file_type"),
        metadata.get("document_type"),
        metadata.get("format"),
        metadata.get("source_type"),
        document.get("file_type"),
        document.get("mime_type"),
        file_path=payload.get("file_path") if isinstance(payload.get("file_path"), str) else None,
    )
    mime_type = _trimmed_string(payload.get("mime_type")) or _trimmed_string(metadata.get("mime_type")) or infer_mime_type(file_type)
    content_kind = _trimmed_string(payload.get("content_kind")) or _trimmed_string(metadata.get("content_kind")) or infer_content_kind(file_type, mime_type)

    page_number = _first_int(payload.get("page_number"), page.get("number"), metadata.get("page_number"))
    page_available = bool(page.get("available")) or page_number > 0

    offset_start = _first_int(offset.get("start"), metadata.get("offset_start"))
    offset_end = _first_int(offset.get("end"), metadata.get("offset_end"))
    offset_available = bool(offset.get("available")) or offset_end > offset_start

    snippet = _trimmed_string(payload.get("snippet")) or _trimmed_string(metadata.get("snippet")) or _trimmed_string(payload.get("content"))[:200]
    content = _trimmed_string(payload.get("content"))

    document_id = _trimmed_string(payload.get("document_id")) or _trimmed_string(document.get("id"))
    document_title = _trimmed_string(payload.get("document_title")) or _trimmed_string(document.get("title"))
    document_available = bool(document_id or document_title)
    section_path = _trimmed_string(payload.get("section_path")) or _trimmed_string(section.get("path")) or _trimmed_string(metadata.get("section_path"))
    section_title = _trimmed_string(section.get("title")) or _trimmed_string(metadata.get("section")) or section_path
    section_level = _first_int(section.get("level"), metadata.get("section_level"))
    section_available = bool(section_path or section_title)

    chunk_id = _trimmed_string(payload.get("chunk_id")) or _trimmed_string(chunk.get("id"))
    chunk_index = _first_int(chunk.get("index"), metadata.get("chunk_index"))
    chunk_title = _trimmed_string(chunk.get("title")) or _trimmed_string(metadata.get("chunk_title")) or document_title
    chunk_type = _trimmed_string(chunk.get("type")) or _trimmed_string(metadata.get("chunk_type")) or "text"
    token_count = _first_int(chunk.get("token_count"), metadata.get("token_count"))
    chunk_available = bool(chunk_id or chunk_title or chunk_index > 0)
    format_available = file_type != "unknown" or mime_type != "application/octet-stream"
    snippet_available = bool(snippet)

    document = {
        "id": document_id,
        "title": document_title,
        "category": _trimmed_string(document.get("category")) or _trimmed_string(metadata.get("category")),
        "process": _trimmed_string(document.get("process")) or _trimmed_string(metadata.get("process")),
        "station": _trimmed_string(document.get("station")) or _trimmed_string(metadata.get("station")),
        "version": _trimmed_string(document.get("version")) or _trimmed_string(metadata.get("version")),
        "security_level": _trimmed_string(document.get("security_level")) or _trimmed_string(metadata.get("security_level")),
        "status": _trimmed_string(document.get("status")) or _trimmed_string(metadata.get("status")),
        "file_type": file_type,
        "mime_type": mime_type,
        "available": document_available,
    }

    section = {
        "path": section_path,
        "title": section_title,
        "level": section_level,
        "available": section_available,
    }

    chunk = {
        "id": chunk_id,
        "index": chunk_index,
        "title": chunk_title,
        "type": chunk_type,
        "token_count": token_count,
        "available": chunk_available,
    }

    page = {
        "number": page_number,
        "available": page_available,
    }

    offset = {
        "start": offset_start,
        "end": offset_end,
        "unit": _trimmed_string(offset.get("unit")) or _trimmed_string(metadata.get("offset_unit")) or "char",
        "available": offset_available,
    }

    normalized_metadata = {
        **metadata,
        "file_type": file_type,
        "mime_type": mime_type,
        "format": file_type,
        "document_type": file_type,
        "content_kind": content_kind,
        "format_available": format_available,
        "page_number": page_number,
        "page": page,
        "offset": offset,
        "snippet": snippet,
        "snippet_available": snippet_available,
        "document": document,
        "section": section,
        "chunk": chunk,
    }

    normalized = dict(payload)
    normalized.update(
        {
            "document_id": document_id,
            "document_title": document_title,
            "section_path": section_path,
            "page_number": page_number,
            "chunk_index": chunk_index,
            "section_level": section_level,
            "offset_start": offset_start,
            "offset_end": offset_end,
            "snippet": snippet,
            "content": content,
            "format": file_type,
            "file_type": file_type,
            "mime_type": mime_type,
            "document_type": file_type,
            "content_kind": content_kind,
            "format_available": format_available,
            "page": page,
            "offset": offset,
            "document": document,
            "section": section,
            "chunk": chunk,
            "snippet_available": snippet_available,
            "metadata": normalized_metadata,
        }
    )

    return normalized
