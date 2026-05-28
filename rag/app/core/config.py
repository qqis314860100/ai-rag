import os
import sqlite3
import logging
from pathlib import Path
from dotenv import load_dotenv

# 从项目根目录加载 .env，便于 rag 服务单独启动时也能读取统一配置。
_root = Path(__file__).resolve().parent.parent.parent.parent
load_dotenv(_root / ".env")
load_dotenv()

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("APP_DB_PATH", os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data", "app.db"))


def _read_db_setting(key: str, default: str = "") -> str:
    """优先读取环境变量，其次读取 SQLite settings 表，最后回退默认值。"""
    # 环境变量作为显式覆盖，优先级最高。
    env_val = os.getenv(key.upper())
    if env_val is not None:
        return env_val

    # 数据库配置允许后台管理页动态调整 RAG 参数。
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


def _read_env_int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, str(default)))
    except (ValueError, TypeError):
        return default


def _read_env_bool(key: str, default: bool = False) -> bool:
    value = os.getenv(key)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    project_root: str = str(_root)

    chroma_persist_dir: str = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
    chroma_collection: str = os.getenv("CHROMA_COLLECTION", "battery_line_knowledge_v1")

    embedding_model: str = _read_db_setting("embedding_model", os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5"))
    embedding_batch_size: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))

    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    deepseek_base_url: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    llm_provider: str = os.getenv("LLM_PROVIDER", "deepseek").strip().lower()
    image_gen_enabled: bool = _read_env_bool("IMAGE_GEN_ENABLED", False)
    telemetry_enabled: bool = _read_env_bool("TELEMETRY_ENABLED", False)

    rag_top_k: int = _read_db_setting_int("rag_top_k", int(os.getenv("RAG_TOP_K", "5")))
    rag_temperature: float = _read_db_setting_float("rag_temperature", float(os.getenv("RAG_TEMPERATURE", "0.2")))
    rag_max_context_chars: int = _read_db_setting_int("rag_max_context_chars", int(os.getenv("RAG_MAX_CONTEXT_CHARS", "12000")))
    rag_rerank_mode: str = _read_db_setting("rag_rerank_mode", os.getenv("RAG_RERANK_MODE", "local")).strip().lower()
    rag_rerank_llm_candidate_limit: int = _read_env_int("RAG_RERANK_LLM_CANDIDATE_LIMIT", 12)

    llm_usage_log_path: str = os.getenv("LLM_USAGE_LOG_PATH", "./data/llm_usage.jsonl")
    llm_max_input_chars_per_request: int = _read_env_int("LLM_MAX_INPUT_CHARS_PER_REQUEST", 25000)
    llm_daily_request_limit: int = _read_env_int("LLM_DAILY_REQUEST_LIMIT", 50)
    llm_daily_input_char_limit: int = _read_env_int("LLM_DAILY_INPUT_CHAR_LIMIT", 300000)
    llm_daily_request_limit_per_user: int = _read_env_int("LLM_DAILY_REQUEST_LIMIT_PER_USER", 50)
    llm_hourly_request_limit_per_user: int = _read_env_int("LLM_HOURLY_REQUEST_LIMIT_PER_USER", 20)


config = Config()
