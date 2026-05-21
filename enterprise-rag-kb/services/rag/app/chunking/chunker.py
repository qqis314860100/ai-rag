import re
import hashlib
from dataclasses import dataclass, field
from ..parsers.base import ParsedDocument


@dataclass
class Chunk:
    chunk_id: str
    document_id: str
    title: str
    section_path: str
    content: str
    page_number: int = 0
    chunk_index: int = 0
    token_count: int = 0
    metadata: dict = field(default_factory=dict)


DEFAULT_CHUNK_SIZE = 600
DEFAULT_CHUNK_OVERLAP = 120
MIN_CHUNK_SIZE = 120
MAX_CHUNK_SIZE = 1000


def chunk_document(
    parsed: ParsedDocument,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[Chunk]:
    chunks: list[Chunk] = []
    text = parsed.full_text
    if not text.strip():
        return chunks

    # Split text by paragraphs first
    paragraphs = re.split(r"\n\s*\n", text)

    current_chunk: list[str] = []
    current_len = 0
    current_section = ""
    current_section_path = ""

    for section in parsed.sections:
        section_text = _find_section_text(text, section["title"])
        if section_text:
            current_section = section["title"]
            current_section_path = section.get("section_path", section["title"])

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # Check if this paragraph starts a new section
        for section in parsed.sections:
            if para.startswith(section["title"]):
                # Flush current chunk if substantial
                if current_len >= MIN_CHUNK_SIZE:
                    chunks.append(_make_chunk(
                        current_chunk, current_len, parsed, current_section, current_section_path, len(chunks)
                    ))
                    # Keep overlap
                    overlap_text = " ".join(current_chunk[-2:]) if len(current_chunk) >= 2 else ""
                    current_chunk = [overlap_text] if overlap_text else []
                    current_len = len(overlap_text)

                current_section = section["title"]
                current_section_path = section.get("section_path", section["title"])
                break

        para_len = len(para)

        if current_len + para_len > MAX_CHUNK_SIZE and current_len >= MIN_CHUNK_SIZE:
            chunks.append(_make_chunk(
                current_chunk, current_len, parsed, current_section, current_section_path, len(chunks)
            ))
            overlap_text = " ".join(current_chunk[-2:]) if len(current_chunk) >= 2 else ""
            current_chunk = [overlap_text] if overlap_text else []
            current_len = len(overlap_text)

        current_chunk.append(para)
        current_len += para_len

        while current_len > chunk_size + chunk_overlap and len(current_chunk) > 1:
            chunks.append(_make_chunk(
                current_chunk[:-1], current_len - len(current_chunk[-1]),
                parsed, current_section, current_section_path, len(chunks)
            ))
            new_chunk = current_chunk[-2:]
            if len(new_chunk) == len(current_chunk):
                # Cannot reduce further, emit remainder and break
                chunks.append(_make_chunk(
                    new_chunk, sum(len(p) for p in new_chunk),
                    parsed, current_section, current_section_path, len(chunks)
                ))
                current_chunk = []
                current_len = 0
                break
            current_chunk = new_chunk
            current_len = sum(len(p) for p in current_chunk)

    # Final chunk
    if current_len >= MIN_CHUNK_SIZE:
        chunks.append(_make_chunk(
            current_chunk, current_len, parsed, current_section, current_section_path, len(chunks)
        ))

    # Add standalone table chunks
    for table in parsed.tables:
        table_text = table.get("markdown", "")
        if len(table_text) >= MIN_CHUNK_SIZE:
            chunks.append(Chunk(
                chunk_id=_gen_chunk_id(parsed.document_id, len(chunks)),
                document_id=parsed.document_id,
                title=parsed.title,
                section_path=table.get("section_path", ""),
                content=table_text,
                chunk_index=len(chunks),
                token_count=_estimate_tokens(table_text),
                metadata={
                    **parsed.metadata,
                    "chunk_type": "table",
                },
            ))

    return chunks


def _make_chunk(
    parts: list[str], total_len: int, parsed: ParsedDocument,
    section: str, section_path: str, idx: int,
) -> Chunk:
    content = "\n\n".join(p for p in parts if p.strip())
    return Chunk(
        chunk_id=_gen_chunk_id(parsed.document_id, idx),
        document_id=parsed.document_id,
        title=section or parsed.title,
        section_path=section_path or "",
        content=content,
        chunk_index=idx,
        token_count=_estimate_tokens(content),
        metadata={
            **parsed.metadata,
            "title": parsed.title,
            "section": section,
        },
    )


def _gen_chunk_id(document_id: str, index: int) -> str:
    raw = f"{document_id}_{index:04d}"
    return f"chunk_{hashlib.md5(raw.encode()).hexdigest()[:16]}"


def _estimate_tokens(text: str) -> int:
    # Rough estimate: 1 Chinese char ≈ 1 token, 1 English word ≈ 1.3 tokens
    chinese_chars = len(re.findall(r"[一-鿿]", text))
    other_chars = len(text) - chinese_chars
    return chinese_chars + int(other_chars / 3.5)


def _find_section_text(text: str, title: str) -> str:
    idx = text.find(title)
    if idx >= 0:
        return text[idx:idx + 500]
    return ""
