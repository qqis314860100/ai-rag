import re
from .base import BaseParser, ParsedDocument


class TxtParser(BaseParser):
    def parse(self, file_path: str, document_id: str, metadata: dict | None = None) -> ParsedDocument:
        with open(file_path, encoding="utf-8") as f:
            content = f.read()

        sections = []
        # Detect headings like "一、xxx" or "1. xxx" or "第X节 xxx"
        heading_pattern = re.compile(
            r"^((?:[一二三四五六七八九十]+、)|(?:\d+\.\s)|(?:第[一二三四五六七八九十\d]+[章节条]))\s*(.+)"
        )

        section_path: list[str] = []
        for line in content.split("\n"):
            m = heading_pattern.match(line.strip())
            if m:
                title = line.strip()
                level = 1 if "、" in title else 2
                while len(section_path) >= level:
                    section_path.pop()
                section_path.append(title)
                sections.append({
                    "level": level,
                    "title": title,
                    "section_path": " / ".join(section_path),
                })

        return ParsedDocument(
            document_id=document_id,
            file_path=file_path,
            title=metadata.get("title") or sections[0]["title"] if sections else "",
            sections=sections,
            full_text=content,
            metadata=metadata or {},
        )
