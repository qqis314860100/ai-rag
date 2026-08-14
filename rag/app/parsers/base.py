from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import ClassVar


@dataclass
class ParsedDocument:
    document_id: str
    file_path: str
    title: str = ""
    sections: list[dict] = field(default_factory=list)
    tables: list[dict] = field(default_factory=list)
    full_text: str = ""
    page_count: int = 0
    metadata: dict = field(default_factory=dict)


class BaseParser(ABC):
    @abstractmethod
    def parse(self, file_path: str, document_id: str, metadata: dict | None = None) -> ParsedDocument:
        ...


class ParserRegistry:
    _parsers: ClassVar[dict[str, BaseParser]] = {}

    @classmethod
    def register(cls, extension: str, parser: BaseParser):
        cls._parsers[extension] = parser

    @classmethod
    def get(cls, file_path: str) -> BaseParser:
        import os
        ext = os.path.splitext(file_path)[1].lower()
        parser = cls._parsers.get(ext)
        if not parser:
            raise ValueError(f"No parser registered for extension: {ext}")
        return parser
