import re
from html.parser import HTMLParser

from .base import BaseParser, ParsedDocument


class _HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.sections: list[dict] = []
        self.section_path: list[str] = []
        self._skip_depth = 0
        self._current_heading_level: int | None = None
        self._current_heading_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        normalized = tag.lower()
        if normalized in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if re.fullmatch(r"h[1-6]", normalized):
            self._current_heading_level = int(normalized[1])
            self._current_heading_parts = []
        if normalized in {"p", "div", "section", "article", "br", "li", "tr", "table", "pre"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        normalized = tag.lower()
        if normalized in {"script", "style", "noscript"}:
            self._skip_depth = max(self._skip_depth - 1, 0)
            return
        if self._skip_depth:
            return
        if re.fullmatch(r"h[1-6]", normalized) and self._current_heading_level:
            title = " ".join("".join(self._current_heading_parts).split())
            if title:
                level = self._current_heading_level
                while len(self.section_path) >= level:
                    self.section_path.pop()
                self.section_path.append(title)
                self.sections.append({
                    "level": level,
                    "title": title,
                    "section_path": " / ".join(self.section_path),
                })
                self.parts.append(f"\n\n{title}\n\n")
            self._current_heading_level = None
            self._current_heading_parts = []
        if normalized in {"p", "div", "section", "article", "li", "tr", "table", "pre"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._current_heading_level:
            self._current_heading_parts.append(data)
            return
        text = " ".join(data.split())
        if text:
            self.parts.append(text)
            self.parts.append(" ")

    def text(self) -> str:
        lines = [line.strip() for line in "".join(self.parts).splitlines()]
        return "\n\n".join(line for line in lines if line)


class HtmlParser(BaseParser):
    def parse(self, file_path: str, document_id: str, metadata: dict | None = None) -> ParsedDocument:
        with open(file_path, encoding="utf-8") as f:
            content = f.read()

        extractor = _HtmlTextExtractor()
        extractor.feed(content)

        return ParsedDocument(
            document_id=document_id,
            file_path=file_path,
            title=(metadata or {}).get("title") or _extract_title(content),
            sections=extractor.sections,
            full_text=extractor.text(),
            metadata=metadata or {},
        )


def _extract_title(content: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", content, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    return " ".join(match.group(1).split())
