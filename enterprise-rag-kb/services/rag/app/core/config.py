import os


class Config:
    chroma_persist_dir: str = os.getenv("CHROMA_PERSIST_DIR", "./data/chroma")
    chroma_collection: str = os.getenv(
        "CHROMA_COLLECTION", "battery_line_knowledge_v1"
    )
    embedding_model: str = os.getenv(
        "EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5"
    )
    embedding_batch_size: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))

    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "")
    deepseek_base_url: str = os.getenv(
        "DEEPSEEK_BASE_URL", "https://api.deepseek.com"
    )
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    rag_top_k: int = int(os.getenv("RAG_TOP_K", "5"))
    rag_temperature: float = float(os.getenv("RAG_TEMPERATURE", "0.2"))
    rag_max_context_chars: int = int(
        os.getenv("RAG_MAX_CONTEXT_CHARS", "12000")
    )


config = Config()
