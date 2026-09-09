"""语料入库辅助脚本（供检索评测 A/B 用）。

把语料目录下的文档灌入当前 embedding 模型对应的向量库。
- 通过 CHROMA_PERSIST_DIR 指向独立目录即可做 embedding 模型 A/B 隔离；
- 通过 EMBEDDING_MODEL 切换候选模型（Qwen3-Embedding 需同时设
  EMBEDDING_TRUST_REMOTE_CODE=1）。
- 不改动现网索引；默认 namespace 为空 = 电池语料 collection。

用法（rag/ 目录下）：
    CHROMA_PERSIST_DIR=/tmp/x EMBEDDING_MODEL=Qwen/Qwen3-Embedding-0.6B \
      EMBEDDING_TRUST_REMOTE_CODE=1 \
      ./.venv/bin/python -m evals.ingest_corpus --knowledge-dir ../knowledge
"""

from __future__ import annotations

import argparse
from pathlib import Path

DEFAULT_KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent.parent / "knowledge"


def ingest_knowledge_dir(knowledge_dir: Path, limit: int = 0) -> list[dict]:
    from app.core.pipeline import RagPipeline

    pipeline = RagPipeline()
    results: list[dict] = []
    files = sorted(p for p in knowledge_dir.glob("*.md") if p.is_file())
    if limit > 0:
        files = files[:limit]
    for file_path in files:
        document_id = file_path.stem
        result = pipeline.ingest_document(
            document_id=document_id,
            file_path=str(file_path),
            metadata={
                "title": document_id,
                "category": "",
                "tags": [],
                "security_level": "internal",
            },
        )
        results.append(result)
        print(f"ingested {document_id}: {result['chunk_count']} chunks")
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="语料入库（A/B 评测用）")
    parser.add_argument("--knowledge-dir", type=Path, default=DEFAULT_KNOWLEDGE_DIR)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    if not args.knowledge_dir.is_dir():
        raise SystemExit(f"knowledge dir not found: {args.knowledge_dir}")
    results = ingest_knowledge_dir(args.knowledge_dir, limit=args.limit)
    print(f"done: {len(results)} docs ingested")


if __name__ == "__main__":
    main()
