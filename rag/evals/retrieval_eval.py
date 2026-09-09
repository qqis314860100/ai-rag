"""电池语料检索基线评测 harness（P0）。

评测与实现解耦：runner 只负责把 query 变成"按序去重的文档标题列表"，
指标函数为纯函数；默认 runner 走本地 RagPipeline.search（真实 Chroma 索引），
将来替换 embedding/向量库/混合检索后以本 harness 跑 diff 作为回归门禁。

用法（在 rag/ 目录下）：
    ./.venv/bin/python -m evals.retrieval_eval --top-k 10
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

GOLDEN_PATH = Path(__file__).resolve().parent / "retrieval_golden_battery.jsonl"


@dataclass(frozen=True)
class GoldenItem:
    id: str
    query: str
    expected: tuple[str, ...]

    @classmethod
    def from_dict(cls, raw: dict) -> "GoldenItem":
        expected = raw.get("expected") or []
        if not raw.get("query", "").strip():
            raise ValueError(f"golden item {raw.get('id')!r} has empty query")
        if not expected:
            raise ValueError(f"golden item {raw.get('id')!r} has empty expected")
        return cls(
            id=str(raw.get("id") or ""),
            query=raw["query"].strip(),
            expected=tuple(str(e).strip() for e in expected),
        )


def load_golden(path: Path = GOLDEN_PATH) -> list[GoldenItem]:
    items: list[GoldenItem] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                item = GoldenItem.from_dict(json.loads(line))
            except (json.JSONDecodeError, ValueError) as exc:
                raise ValueError(f"{path}:{lineno}: {exc}") from exc
            if item.id in seen:
                raise ValueError(f"{path}: duplicate golden id {item.id!r}")
            seen.add(item.id)
            items.append(item)
    return items


# ---------------------------------------------------------------- 纯指标

def hit_at_k(ranked_titles: list[str], expected: set[str], k: int) -> int:
    """top-k 内是否至少命中一个期望文档。"""
    return int(any(title in expected for title in ranked_titles[:k]))


def recall_at_k(ranked_titles: list[str], expected: set[str], k: int) -> float:
    """top-k 内命中的期望文档数 / 期望文档总数。"""
    if not expected:
        return 0.0
    hit_count = sum(1 for title in ranked_titles[:k] if title in expected)
    return hit_count / len(expected)


def reciprocal_rank(ranked_titles: list[str], expected: set[str]) -> float:
    """第一个期望文档出现位置的倒数（未命中为 0）。"""
    for rank, title in enumerate(ranked_titles, start=1):
        if title in expected:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(ranked_titles: list[str], expected: set[str], k: int) -> float:
    """文档级二值 nDCG@k：每个期望文档在其首次出现处记 gain=1。"""
    top = ranked_titles[:k]
    dcg = 0.0
    seen: set[str] = set()
    for rank, title in enumerate(top, start=1):
        if title in expected and title not in seen:
            dcg += 1.0 / math.log2(rank + 1)
            seen.add(title)
    ideal_count = min(len(expected), len(top))
    idcg = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_count + 1))
    return dcg / idcg if idcg > 0 else 0.0


def dedupe_titles(hits: list[dict]) -> list[str]:
    """从 pipeline.search 结果里提取按序去重的文档标题。"""
    titles: list[str] = []
    for hit in hits:
        title = str(hit.get("document_title") or "").strip()
        if title and title not in titles:
            titles.append(title)
    return titles


# ---------------------------------------------------------------- 运行

def build_pipeline_runner(top_k: int):
    """默认 runner：走真实本地检索（namespace 为空 = 电池语料）。"""
    from app.core.pipeline import RagPipeline

    pipeline = RagPipeline()

    def run(query: str) -> list[str]:
        result = pipeline.search(
            query=query,
            top_k=top_k,
            allowed_security_levels=["public", "internal"],
        )
        return dedupe_titles(result["results"])

    return run


@dataclass
class QueryScore:
    id: str
    query: str
    expected: list[str]
    ranked: list[str]
    metrics: dict[str, float] = field(default_factory=dict)


@dataclass
class BaselineReport:
    top_k: int
    query_count: int
    metrics: dict[str, float]
    per_query: list[QueryScore] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "top_k": self.top_k,
            "query_count": self.query_count,
            "metrics": self.metrics,
            "queries": [
                {
                    "id": q.id,
                    "query": q.query,
                    "expected": q.expected,
                    "ranked": q.ranked,
                    "metrics": q.metrics,
                }
                for q in self.per_query
            ],
        }


def evaluate(golden: list[GoldenItem], runner, top_k: int) -> BaselineReport:
    per_query: list[QueryScore] = []
    keys = ("hit@5", "hit@10", "recall@5", "recall@10", "mrr@10", "ndcg@10")

    for item in golden:
        ranked = runner(item.query)
        expected = set(item.expected)
        metrics = {
            "hit@5": float(hit_at_k(ranked, expected, 5)),
            "hit@10": float(hit_at_k(ranked, expected, 10)),
            "recall@5": recall_at_k(ranked, expected, 5),
            "recall@10": recall_at_k(ranked, expected, 10),
            "mrr@10": reciprocal_rank(ranked, expected),
            "ndcg@10": ndcg_at_k(ranked, expected, 10),
        }
        per_query.append(
            QueryScore(
                id=item.id,
                query=item.query,
                expected=list(item.expected),
                ranked=ranked,
                metrics=metrics,
            )
        )

    means = {
        key: sum(q.metrics[key] for q in per_query) / len(per_query)
        for key in keys
    }
    return BaselineReport(top_k=top_k, query_count=len(per_query), metrics=means, per_query=per_query)


def main() -> None:
    parser = argparse.ArgumentParser(description="电池语料检索基线评测")
    parser.add_argument("--golden", type=Path, default=GOLDEN_PATH)
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 条（调试用）")
    parser.add_argument("--report", type=Path, default=None)
    args = parser.parse_args()

    golden = load_golden(args.golden)
    if args.limit > 0:
        golden = golden[: args.limit]

    runner = build_pipeline_runner(args.top_k)
    report = evaluate(golden, runner, top_k=args.top_k)

    print("=" * 60)
    print(f"电池语料检索基线 top_k={report.top_k} queries={report.query_count}")
    for key, value in report.metrics.items():
        print(f"  {key:<10} {value:.4f}")
    print("-" * 60)
    for q in report.per_query:
        if q.metrics["hit@10"] < 1.0:
            print(
                f"[MISS] {q.id} {q.query} | expected={q.expected} "
                f"| top={q.ranked[:3]}"
            )

    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"report -> {args.report}")


if __name__ == "__main__":
    main()
