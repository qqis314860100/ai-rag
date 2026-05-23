import re
import unicodedata
from ..parsers.base import ParsedDocument

# Control chars to strip (keep common whitespace)
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")

# HTML tags
_HTML_RE = re.compile(r"<[^>]*>")

# Multiple blank lines → single blank line
_MULTI_NL_RE = re.compile(r"\n{3,}")

# Multiple spaces (not newlines)
_MULTI_SPACE_RE = re.compile(r"[^\S\n]{2,}")

# Lines that are only whitespace/punctuation (useless after parsing)
_EMPTY_LINE_RE = re.compile(r"^[\s\d\W_]+$")

# Full-width characters → half-width mapping for common punctuation
_FULLWIDTH_MAP = str.maketrans(
    "，。！？；：＂＇（）【】《》％＃＠＆＊＋－／＜＝＞",
    ",.!?;:\"'()[]<>%#@&*+-/<=>",
)


def clean_fullwidth(text: str) -> str:
    """Normalize full-width punctuation and digits to half-width."""
    result: list[str] = []
    for ch in text:
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:
            result.append(chr(code - 0xFEE0))
        elif code == 0x3000:  # full-width space
            result.append(" ")
        else:
            result.append(ch)
    return "".join(result)


def clean_text(text: str) -> str:
    """Apply all cleaning rules to a raw text string."""
    if not text:
        return ""

    # Strip HTML tags
    text = _HTML_RE.sub("", text)

    # Normalize Unicode (NFC)
    text = unicodedata.normalize("NFC", text)

    # Strip control characters
    text = _CONTROL_RE.sub("", text)

    # Normalize full-width characters
    text = clean_fullwidth(text)

    # Collapse multiple blank lines
    text = _MULTI_NL_RE.sub("\n\n", text)

    # Collapse multiple spaces (preserve newlines)
    text = _MULTI_SPACE_RE.sub(" ", text)

    # Strip leading/trailing whitespace per line
    lines = [line.strip() for line in text.split("\n")]
    # Collapse consecutive empty lines to single empty line
    result: list[str] = []
    prev_empty = False
    for line in lines:
        if line:
            result.append(line)
            prev_empty = False
        elif not prev_empty:
            result.append("")
            prev_empty = True
    text = "\n".join(result).strip()

    # Strip leading/trailing whitespace
    text = text.strip()

    return text


def clean_parsed_document(parsed: ParsedDocument) -> ParsedDocument:
    """Clean a parsed document's full_text and sections."""
    parsed.full_text = clean_text(parsed.full_text)

    # Clean section titles
    cleaned_sections = []
    for sec in parsed.sections:
        sec = dict(sec)
        sec["title"] = clean_text(sec.get("title", ""))
        sec["section_path"] = clean_text(sec.get("section_path", ""))
        if sec["title"]:  # skip sections with empty titles after cleaning
            cleaned_sections.append(sec)
    parsed.sections = cleaned_sections

    # Clean table markdown
    cleaned_tables = []
    for tbl in parsed.tables:
        tbl = dict(tbl)
        tbl["markdown"] = clean_text(tbl.get("markdown", ""))
        if tbl["markdown"]:
            cleaned_tables.append(tbl)
    parsed.tables = cleaned_tables

    return parsed
