import hashlib
import re
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
    offset_start: int = 0
    offset_end: int = 0
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

    # Split text by normalized paragraphs first so we can carry coarse offsets.
    paragraphs = _split_paragraphs(text)

    current_chunk: list[dict[str, int | str]] = []
    current_len = 0
    current_section = ""
    current_section_path = ""
    current_section_level = 0

    for section in parsed.sections:
        section_text = _find_section_text(text, section["title"])
        if section_text:
            current_section = section["title"]
            current_section_path = section.get("section_path", section["title"])
            current_section_level = section.get("level", 0)

    for para in paragraphs:
        para_text = str(para["text"]).strip()
        if not para_text:
            continue

        # Check if this paragraph starts a new section
        for section in parsed.sections:
            if para_text.startswith(section["title"]):
                # Flush current chunk if substantial
                if current_len >= MIN_CHUNK_SIZE:
                    chunks.append(_make_chunk(
                        current_chunk, current_len, parsed, current_section, current_section_path, current_section_level, len(chunks)
                    ))
                    # Keep overlap
                    overlap_chunk = current_chunk[-2:] if len(current_chunk) >= 2 else []
                    current_chunk = overlap_chunk.copy()
                    current_len = sum(len(str(p["text"])) for p in current_chunk)

                current_section = section["title"]
                current_section_path = section.get("section_path", section["title"])
                current_section_level = section.get("level", 0)
                break

        para_len = len(para_text)

        if current_len + para_len > MAX_CHUNK_SIZE and current_len >= MIN_CHUNK_SIZE:
            chunks.append(_make_chunk(
                current_chunk, current_len, parsed, current_section, current_section_path, current_section_level, len(chunks)
            ))
            overlap_chunk = current_chunk[-2:] if len(current_chunk) >= 2 else []
            current_chunk = overlap_chunk.copy()
            current_len = sum(len(str(p["text"])) for p in current_chunk)

        current_chunk.append(para)
        current_len += para_len

        while current_len > chunk_size + chunk_overlap and len(current_chunk) > 1:
            chunks.append(_make_chunk(
                current_chunk[:-1], current_len - len(str(current_chunk[-1]["text"])),
                parsed, current_section, current_section_path, current_section_level, len(chunks)
            ))
            new_chunk = current_chunk[-2:]
            if len(new_chunk) == len(current_chunk):
                # Cannot reduce further, emit remainder and break
                chunks.append(_make_chunk(
                    new_chunk, sum(len(str(p["text"])) for p in new_chunk),
                    parsed, current_section, current_section_path, current_section_level, len(chunks)
                ))
                current_chunk = []
                current_len = 0
                break
            current_chunk = new_chunk
            current_len = sum(len(str(p["text"])) for p in current_chunk)

    # Final chunk
    if current_len >= MIN_CHUNK_SIZE:
        chunks.append(_make_chunk(
            current_chunk, current_len, parsed, current_section, current_section_path, current_section_level, len(chunks)
        ))

    # Add standalone table chunks
    for table in parsed.tables:
        table_text = table.get("markdown", "")
        if len(table_text) >= MIN_CHUNK_SIZE:
            table_page_number = table.get("page_number", 0)
            chunks.append(Chunk(
                chunk_id=_gen_chunk_id(parsed.document_id, len(chunks)),
                document_id=parsed.document_id,
                title=parsed.title,
                section_path=table.get("section_path", ""),
                content=table_text,
                page_number=table_page_number if isinstance(table_page_number, int) else 0,
                chunk_index=len(chunks),
                token_count=_estimate_tokens(table_text),
                offset_start=0,
                offset_end=len(table_text),
                metadata={
                    **parsed.metadata,
                    "chunk_type": "table",
                    "section_level": 0,
                    "page_number": table_page_number if isinstance(table_page_number, int) else 0,
                    "offset_start": 0,
                    "offset_end": len(table_text),
                    "snippet": table_text[:200],
                },
            ))

    return chunks


def _extract_chapter_info(section_path: str) -> dict:
    """Extract chapter number and title from section path for metadata."""
    info: dict = {}
    parts = [p.strip() for p in section_path.split("/") if p.strip()]
    for part in parts:
        # Match patterns like "5. 安全注意事项", "第5章 安全", "5 安全注意事项"
        m = re.match(r"^第?(\d+)[章节\.\s、]?\s*(.*)", part)
        if m:
            info["chapter_num"] = int(m.group(1))
            info["chapter_title"] = m.group(2) or part
            break
    return info


def _make_chunk(
    parts: list[dict[str, int | str]], total_len: int, parsed: ParsedDocument,
    section: str, section_path: str, section_level: int, idx: int,
) -> Chunk:
    texts = [str(p["text"]).strip() for p in parts if str(p["text"]).strip()]
    content = "\n\n".join(texts)
    chapter_info = _extract_chapter_info(section_path)
    page_numbers = [int(p.get("page_number", 0)) for p in parts if int(p.get("page_number", 0)) > 0]
    offset_start = int(parts[0].get("start", 0)) if parts else 0
    offset_end = int(parts[-1].get("end", total_len)) if parts else total_len
    return Chunk(
        chunk_id=_gen_chunk_id(parsed.document_id, idx),
        document_id=parsed.document_id,
        title=section or parsed.title,
        section_path=section_path or "",
        content=content,
        page_number=page_numbers[0] if page_numbers else 0,
        chunk_index=idx,
        token_count=_estimate_tokens(content),
        offset_start=offset_start,
        offset_end=offset_end,
        metadata={
            **parsed.metadata,
            "title": parsed.title,
            "section": section,
            "section_path": section_path,
            "section_level": section_level,
            "page_number": page_numbers[0] if page_numbers else 0,
            "offset_start": offset_start,
            "offset_end": offset_end,
            "offset_unit": "char",
            "snippet": content[:200],
            "chapter_num": chapter_info.get("chapter_num"),
            "chapter_title": chapter_info.get("chapter_title"),
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


def _split_paragraphs(text: str) -> list[dict[str, int | str]]:
    paragraphs: list[dict[str, int | str]] = []
    current_offset = 0
    current_page = 0

    for raw in re.split(r"\n\s*\n", text):
        para = raw.strip()
        if not para:
            continue

        page_number, cleaned = _extract_page_number(para, current_page)
        if page_number > 0:
            current_page = page_number
        para_text = cleaned.strip() or para
        start = current_offset
        end = start + len(para_text)
        paragraphs.append({
            "text": para_text,
            "start": start,
            "end": end,
            "page_number": current_page,
        })
        current_offset = end + 2

    return paragraphs


def _extract_page_number(text: str, fallback: int) -> tuple[int, str]:
    m = re.match(r"^\[Page\s+(\d+)\]\s*(.*)$", text, flags=re.IGNORECASE | re.DOTALL)
    if not m:
        return fallback, text
    page_number = int(m.group(1))
    remainder = m.group(2).strip()
    return page_number, remainder
