"""cross-encoder 重排模式测试（模型不可用时可回退，不加载真实模型）。"""

import app.core.pipeline.retrieve as retrieve_module


def _hit(chunk_id: str, title: str, content: str, score: float = 0.5) -> dict:
    return {
        "chunk_id": chunk_id,
        "document_title": title,
        "content": content,
        "score": score,
        "metadata": {},
    }


def test_cross_mode_reorders_by_reranker_scores(monkeypatch) -> None:
    def fake_scores(query, hits, batch_size=16):
        order = {"a": 0.9, "b": 0.2, "c": 0.6}
        return [order[h["chunk_id"]] for h in hits]

    monkeypatch.setattr(
        "app.llm.cross_reranker.cross_rerank_scores", fake_scores
    )
    hits = [_hit("a", "A", "aa"), _hit("b", "B", "bb"), _hit("c", "C", "cc")]
    result = retrieve_module.rerank_hits("q", hits, mode="cross", top_k=3)
    assert [h["chunk_id"] for h in result["results"]] == ["a", "c", "b"]
    assert result["trace"]["mode"] == "cross"
    assert result["results"][0]["metadata"]["ranking"]["cross_score"] == 0.9


def test_cross_mode_falls_back_to_local_when_unavailable(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.llm.cross_reranker.cross_rerank_scores",
        lambda *args, **kwargs: None,
    )
    hits = [
        _hit("a", "常见设备故障与维护", "绝缘电阻测试标准", 0.6),
        _hit("b", "Pack总装工序", "设备维护周期和日常点检", 0.5),
    ]
    result = retrieve_module.rerank_hits(
        "绝缘电阻测试标准", hits, mode="cross", top_k=2
    )
    assert result["trace"]["mode"] == "local"
    assert result["trace"]["fallback_reason"] == "cross_unavailable"
    assert len(result["results"]) == 2
