from app.llm.prompt_builder import extract_sources
from app.core.source_metadata import build_source_metadata
from app.schemas.models import SourceMetadata


def test_source_metadata_from_source_preserves_legacy_fields() -> None:
    source = {
        "chunk_id": "chunk_123",
        "document_id": "doc_1",
        "document_title": "工艺说明",
        "section_path": "第1章 / 1.1 总则",
        "page_number": "7",
        "content": "这是摘要内容",
        "metadata": {
            "title": "工艺说明",
            "section": "总则",
            "section_path": "第1章 / 1.1 总则",
            "section_level": "2",
            "chunk_index": "4",
            "chunk_title": "总则",
            "chunk_type": "table",
            "source_format": "markdown",
            "offset_start": "18",
            "offset_end": "42",
            "category": "安全规范",
            "security_level": "internal",
            "version": "v2.0",
        },
    }

    metadata = SourceMetadata.from_source(source)

    assert metadata.document.id == "doc_1"
    assert metadata.document.title == "工艺说明"
    assert metadata.document.category == "安全规范"
    assert metadata.section.path == "第1章 / 1.1 总则"
    assert metadata.section.title == "总则"
    assert metadata.section.level == 2
    assert metadata.chunk.id == "chunk_123"
    assert metadata.chunk.index == 4
    assert metadata.chunk.title == "总则"
    assert metadata.chunk.type == "table"
    assert metadata.page.number == 7
    assert metadata.page.available is True
    assert metadata.offset.start == 18
    assert metadata.offset.end == 42
    assert metadata.offset.available is True
    assert metadata.format.name == "markdown"
    assert metadata.format.mime_type == "text/markdown"
    assert metadata.snippet == "这是摘要内容"


def test_extract_sources_includes_canonical_metadata() -> None:
    source = {
        "chunk_id": "chunk_123",
        "document_id": "doc_1",
        "document_title": "工艺说明",
        "section_path": "第1章 / 1.1 总则",
        "page_number": 7,
        "score": 0.91,
        "content": "这是摘要内容",
        "metadata": {
            "title": "工艺说明",
            "source_format": "markdown",
        },
    }

    sources = extract_sources([source])

    assert sources[0]["document_title"] == "工艺说明"
    assert sources[0]["source_metadata"]["document"]["id"] == "doc_1"
    assert sources[0]["source_metadata"]["format"]["mime_type"] == "text/markdown"


def test_build_source_metadata_marks_unavailable_ranges() -> None:
    source = {
        "chunk_id": "chunk_456",
        "document_id": "doc_2",
        "document_title": "纯文本说明",
        "content": "暂未记录页码和字符区间",
        "metadata": {"source_format": "text"},
    }

    metadata = build_source_metadata(source)

    assert metadata["page"]["available"] is False
    assert metadata["offset"]["available"] is False
    assert metadata["format"] == "text"
    assert metadata["mime_type"] == "text/plain"
