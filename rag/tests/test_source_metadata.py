from app.llm.prompt_builder import extract_sources
from app.core.source_metadata import build_source_metadata
from app.core.pipeline import _build_ingest_metadata
from app.chunking.chunker import chunk_document
from app.parsers.html import HtmlParser
from app.retrieval.vector_store import _build_source_context
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
    assert metadata.document.file_type == "markdown"
    assert metadata.document.source_format == "markdown"
    assert metadata.document.available is True
    assert metadata.section.path == "第1章 / 1.1 总则"
    assert metadata.section.title == "总则"
    assert metadata.section.level == 2
    assert metadata.section.available is True
    assert metadata.chunk.id == "chunk_123"
    assert metadata.chunk.index == 4
    assert metadata.chunk.title == "总则"
    assert metadata.chunk.type == "table"
    assert metadata.chunk.available is True
    assert metadata.page.number == 7
    assert metadata.page.available is True
    assert metadata.offset.start == 18
    assert metadata.offset.end == 42
    assert metadata.offset.available is True
    assert metadata.format.name == "markdown"
    assert metadata.format.mime_type == "text/markdown"
    assert metadata.format.available is True
    assert metadata.snippet == "这是摘要内容"
    assert metadata.snippet_available is True


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
    assert sources[0]["source_metadata"]["document"]["available"] is True
    assert sources[0]["source_metadata"]["format"]["mime_type"] == "text/markdown"
    assert sources[0]["source_metadata"]["snippet_available"] is True


def test_extract_sources_includes_source_detail_context() -> None:
    source = {
        "chunk_id": "chunk_123",
        "document_id": "doc_1",
        "document_title": "工艺说明",
        "section_path": "第1章 / 1.1 总则",
        "page_number": 7,
        "offset_start": 18,
        "offset_end": 42,
        "content": "当前命中的完整段落",
        "context_before": "上一段上下文",
        "context_after": "下一段上下文",
        "metadata": {
            "title": "工艺说明",
            "source_format": "markdown",
        },
    }

    sources = extract_sources([source])

    assert sources[0]["source_context"]["content"] == "当前命中的完整段落"
    assert sources[0]["source_context"]["snippet"] == "当前命中的完整段落"
    assert sources[0]["source_context"]["before"] == "上一段上下文"
    assert sources[0]["source_context"]["after"] == "下一段上下文"
    assert sources[0]["source_context"]["page_number"] == 7
    assert sources[0]["source_context"]["offset_start"] == 18
    assert sources[0]["source_context"]["offset_end"] == 42
    assert sources[0]["context_before"] == "上一段上下文"
    assert sources[0]["context_after"] == "下一段上下文"
    assert "上一段上下文" in sources[0]["context_window"]
    assert "下一段上下文" in sources[0]["context_window"]


def test_retrieval_source_context_uses_neighbor_chunks() -> None:
    class FakeCollection:
        def get(self, where, include):
            assert where == {"document_id": "doc_1"}
            assert include == ["documents", "metadatas"]
            return {
                "ids": ["chunk_1", "chunk_2", "chunk_3"],
                "documents": ["上一段检索上下文", "当前段", "下一段检索上下文"],
                "metadatas": [
                    {"chunk_index": 0},
                    {"chunk_index": 1},
                    {"chunk_index": 2},
                ],
            }

    context = _build_source_context(
        col=FakeCollection(),
        document_id="doc_1",
        chunk_index=1,
        content="当前命中的完整段落",
        snippet="当前命中摘要",
        page_number=7,
        offset_start=18,
        offset_end=42,
        offset_unit="char",
        cache={},
    )

    assert context["content"] == "当前命中的完整段落"
    assert context["snippet"] == "当前命中摘要"
    assert context["before"] == "上一段检索上下文"
    assert context["after"] == "下一段检索上下文"
    assert "当前命中的完整段落" in context["window"]
    assert context["page_number"] == 7
    assert context["offset_start"] == 18
    assert context["offset_end"] == 42
    assert context["available"] is True


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
    assert metadata["format_available"] is True
    assert metadata["mime_type"] == "text/plain"
    assert metadata["snippet_available"] is True


def test_source_metadata_marks_missing_sections_as_unavailable() -> None:
    source = {
        "chunk_id": "chunk_789",
        "document_id": "doc_3",
        "document_title": "无章节材料",
        "content": "",
        "metadata": {},
    }

    metadata = SourceMetadata.from_source(source)

    assert metadata.document.available is True
    assert metadata.section.available is False
    assert metadata.chunk.available is True
    assert metadata.page.available is False
    assert metadata.offset.available is False
    assert metadata.format.available is False
    assert metadata.snippet_available is False


def test_ingest_metadata_records_preview_source_format_for_standard_formats() -> None:
    cases = [
        ("guide.md", "md", "markdown", "text/markdown", "markdown"),
        ("manual.pdf", "pdf", "pdf", "application/pdf", "pdf"),
        ("page.html", "html", "html", "text/html", "html"),
        ("snippet.ts", "ts", "ts", "text/typescript", "code"),
    ]

    for file_path, file_type, source_format, mime_type, content_kind in cases:
        metadata = _build_ingest_metadata(file_path, {})

        assert metadata["file_type"] == file_type
        assert metadata["source_format"] == source_format
        assert metadata["mime_type"] == mime_type
        assert metadata["content_kind"] == content_kind
        assert metadata["preview_format"] == content_kind


def test_html_parser_and_chunks_keep_source_format_metadata(tmp_path) -> None:
    html_file = tmp_path / "manual.html"
    html_file.write_text(
        "<!doctype html><html><head><title>工艺页面</title><style>body{}</style></head>"
        "<body><h1>安全规范</h1><p>设备上料前需要确认夹具状态。" * 8
        + "</p><script>alert(1)</script></body></html>",
        encoding="utf-8",
    )
    metadata = _build_ingest_metadata(str(html_file), {})

    parsed = HtmlParser().parse(str(html_file), "doc_html", metadata)
    chunks = chunk_document(parsed)

    assert parsed.title == "工艺页面"
    assert parsed.sections[0]["section_path"] == "安全规范"
    assert "alert" not in parsed.full_text
    assert chunks
    assert chunks[0].metadata["file_type"] == "html"
    assert chunks[0].metadata["source_format"] == "html"
    assert chunks[0].metadata["mime_type"] == "text/html"
    assert chunks[0].metadata["content_kind"] == "html"
