"""混合候选生成（RRF 融合）纯函数测试。"""

from app.core.pipeline.retrieve import _rrf_fuse_candidates


def _hit(chunk_id: str, title: str, score: float) -> dict:
    return {
        "chunk_id": chunk_id,
        "document_title": title,
        "content": "",
        "score": score,
        "metadata": {},
    }


def test_rrf_merges_and_dedupes_by_chunk_id() -> None:
    vector = [_hit("a", "A", 0.9), _hit("b", "B", 0.8)]
    lexical = [_hit("b", "B", 0.7), _hit("c", "C", 0.6), _hit("d", "D", 0.5)]
    merged = _rrf_fuse_candidates(vector, lexical, top_k=4)
    # b: 1/61+1/62 > a:1/61 > c:1/62 > d:1/63
    assert [h["chunk_id"] for h in merged] == ["b", "a", "c", "d"]


def test_rrf_keeps_vector_hit_for_duplicate_chunk() -> None:
    vector_hit = _hit("b", "B", 0.8)
    lexical_hit = _hit("b", "B", 0.7)
    merged = _rrf_fuse_candidates([_hit("a", "A", 0.9), vector_hit], [lexical_hit], top_k=2)
    assert merged[0] is vector_hit


def test_rrf_respects_top_k() -> None:
    vector = [_hit("a", "A", 0.9), _hit("b", "B", 0.8)]
    lexical = [_hit("c", "C", 0.6), _hit("d", "D", 0.5)]
    merged = _rrf_fuse_candidates(vector, lexical, top_k=2)
    assert len(merged) == 2


def test_rrf_with_empty_lexical_returns_vector_head() -> None:
    vector = [_hit("a", "A", 0.9), _hit("b", "B", 0.8), _hit("c", "C", 0.7)]
    merged = _rrf_fuse_candidates(vector, [], top_k=2)
    assert [h["chunk_id"] for h in merged] == ["a", "b"]
