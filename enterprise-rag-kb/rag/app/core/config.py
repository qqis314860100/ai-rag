import os
import sqlite3
import logging
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (enterprise-rag-kb/) — has priority over local .env
_root = Path(__file__).resolve().parent.parent.parent.parent.parent
load_dotenv(_root / ".env")
# Also load local .env (services/rag/) for overrides
load_dotenv()

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("APP_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data", "app.db"))


def _read_db_setting(key: str, default: str = "") -> str:
    """Read a setting from the SQLite settings table, fall back to env var, then default."""
    # 1. Try env var (explicit override)
    env_val = os.getenv(key.upper())
    if env_val is not None:
        return env_val

    # 2. Try SQLite settings table
    try:
        db = sqlite3.connect(DB_PATH)
        row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        db.close()
        if row:
            logger.info(f"Loaded {key}={row[0]} from DB settings")
            return row[0]
    except Exception as e:
        logger.debug(f"Could not read {key} from DB: {e}")

    return default


def _read_db_setting_int(key: str, default: int) -> int:
    try:
        return int(_read_db_setting(key, str(default)))
    except (ValueError, TypeError):
        return default


def _read_db_setting_float(key: str, default: float) -> float:
    try:
        return float(_read_db_setting(key, str(default)))
    except (ValueError, TypeError):
        return default


class Config:
    chroma_persist_dir: str = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
    chroma_collection: str = os.getenv("CHROMA_COLLECTION", "battery_line_knowledge_v1")

    embedding_model: str = _read_db_setting("embedding_model", os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5"))
    embedding_batch_size: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))

    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    deepseek_base_url: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    rag_top_k: int = _read_db_setting_int("rag_top_k", int(os.getenv("RAG_TOP_K", "5")))
    rag_temperature: float = _read_db_setting_float("rag_temperature", float(os.getenv("RAG_TEMPERATURE", "0.2")))
    rag_max_context_chars: int = _read_db_setting_int("rag_max_context_chars", int(os.getenv("RAG_MAX_CONTEXT_CHARS", "12000")))


config = Config()
