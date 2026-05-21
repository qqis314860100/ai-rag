from .base import BaseParser, ParsedDocument


class PdfParser(BaseParser):
    def parse(self, file_path: str, document_id: str, metadata: dict | None = None) -> ParsedDocument:
        try:
            from pypdf import PdfReader
        except ImportError:
            raise ImportError("pypdf is required for PDF parsing. Install with: pip install pypdf")

        reader = PdfReader(file_path)
        full_text_parts: list[str] = []
        page_count = len(reader.pages)

        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text:
                full_text_parts.append(f"[Page {i + 1}]\n{text}")

        full_text = "\n\n".join(full_text_parts)

        return ParsedDocument(
            document_id=document_id,
            file_path=file_path,
            title=metadata.get("title", ""),
            sections=[],
            full_text=full_text,
            page_count=page_count,
            metadata=metadata or {},
        )
