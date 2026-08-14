import re

from .base import BaseParser, ParsedDocument


class MarkdownParser(BaseParser):
    def parse(self, file_path: str, document_id: str, metadata: dict | None = None) -> ParsedDocument:
        with open(file_path, encoding="utf-8") as f:
            content = f.read()

        sections = []
        tables = []
        current_section = None
        section_path: list[str] = []
        table_lines: list[str] = []

        in_table = False
        for line in content.split("\n"):
            # Detect headings
            heading_match = re.match(r"^(#{1,6})\s+(.+)", line)
            if heading_match:
                level = len(heading_match.group(1))
                title = heading_match.group(2).strip()

                # Adjust section_path
                while len(section_path) >= level:
                    section_path.pop()
                section_path.append(title)

                sections.append({
                    "level": level,
                    "title": title,
                    "section_path": " / ".join(section_path),
                })
                current_section = title
                continue

            # Detect table rows
            if "|" in line and line.strip().startswith("|"):
                if not in_table:
                    in_table = True
                    table_lines = []
                table_lines.append(line.strip())
                continue
            elif in_table:
                # End of table
                in_table = False
                if len(table_lines) >= 2:
                    tables.append({
                        "section": current_section or "",
                        "section_path": " / ".join(section_path) if section_path else "",
                        "markdown": "\n".join(table_lines),
                    })
                table_lines = []

        # Catch trailing table
        if in_table and len(table_lines) >= 2:
            tables.append({
                "section": current_section or "",
                "section_path": " / ".join(section_path) if section_path else "",
                "markdown": "\n".join(table_lines),
            })

        # Extract YAML frontmatter
        frontmatter: dict = {}
        body = content
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                frontmatter = _parse_frontmatter(parts[1])
                body = parts[2]

        return ParsedDocument(
            document_id=document_id,
            file_path=file_path,
            title=metadata.get("title") or frontmatter.get("title", ""),
            sections=sections,
            tables=tables,
            full_text=body.strip(),
            metadata=metadata or {},
        )


def _parse_frontmatter(text: str) -> dict:
    result: dict = {}
    for line in text.strip().split("\n"):
        match = re.match(r"^(\w[\w_-]*)\s*:\s*(.*)", line)
        if match:
            key = match.group(1).strip()
            val = match.group(2).strip().strip("\"'")
            result[key] = val
    return result
