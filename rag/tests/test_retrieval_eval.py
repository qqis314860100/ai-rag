"""retrieval_eval 评测 harness 纯函数与 golden 数据集校验。

只测外部可观测行为：指标计算正确性、golden 数据集结构与锚点合法性。
不启动真实检索（真实基线由 CLI 单独跑，见 rag/evals/retrieval_eval.py）。
"""

from evals.retrieval_eval import (
    GOLDEN_PATH,
    dedupe_titles,
    hit_at_k,
    load_golden,
    ndcg_at_k,
    recall_at_k,
    reciprocal_rank,
)

# 语料库 14 篇文档标题（knowledge/*.md），golden 锚点必须是其中之一。
KNOWN_DOC_TITLES = {
    "CCD AI视觉检测系统",
    "CTP技术演进",
    "MES制造执行系统",
    "Pack EOL测试与下线",
    "Pack总装工序",
    "产线安全与防护",
    "产线总览与工艺架构",
    "常见设备故障与维护",
    "电芯堆叠与精密涂胶",
    "电芯分选",
    "端板侧板激光焊接",
    "激光焊接设备详解",
    "极柱Busbar激光焊接",
    "模组EOL测试",
}


def test_hit_at_k_matches_expected_any() -> None:
    ranked = ["模组EOL测试", "Pack总装工序"]
    expected = {"Pack EOL测试与下线"}
    assert hit_at_k(ranked, expected, 5) == 0
    assert hit_at_k(["Pack EOL测试与下线", "模组EOL测试"], expected, 5) == 1


def test_recall_at_k_counts_fraction_of_expected_docs() -> None:
    ranked = ["端板侧板激光焊接", "产线安全与防护", "激光焊接设备详解"]
    expected = {"端板侧板激光焊接", "极柱Busbar激光焊接"}
    # top2 只命中 1/2；top3 仍 1/2（第三个不是期望文档）
    assert recall_at_k(ranked, expected, 2) == 0.5
    assert recall_at_k(["端板侧板激光焊接", "极柱Busbar激光焊接"], expected, 2) == 1.0


def test_reciprocal_rank_uses_first_expected_position() -> None:
    ranked = ["产线总览与工艺架构", "Pack总装工序", "模组EOL测试"]
    assert reciprocal_rank(ranked, {"Pack总装工序"}) == 0.5
    assert reciprocal_rank(ranked, {"模组EOL测试"}) == 1.0 / 3
    assert reciprocal_rank(ranked, {"CTP技术演进"}) == 0.0


def test_ndcg_at_k_rewards_earlier_relevant_docs() -> None:
    expected = {"A", "B"}
    early = ndcg_at_k(["A", "B", "C", "D"], expected, 4)
    late = ndcg_at_k(["C", "D", "A", "B"], expected, 4)
    assert early == 1.0
    assert late < 1.0


def test_ndcg_at_k_does_not_double_count_duplicate_docs() -> None:
    # 同一文档在结果里重复出现不重复计分；去重后排序与理想排序一致 => nDCG=1
    ranked = ["A", "B", "A", "B"]
    assert ndcg_at_k(ranked, {"A", "B"}, 4) == 1.0
    # 重复项占位会摊低增益：等价去重序列不是理想序列时 < 1
    assert ndcg_at_k(["A", "A", "B"], {"A", "B"}, 3) < 1.0


def test_dedupe_titles_preserves_order_and_drops_blanks() -> None:
    hits = [
        {"document_title": "模组EOL测试"},
        {"document_title": " "},
        {"document_title": "模组EOL测试"},
        {"document_title": "Pack总装工序"},
    ]
    assert dedupe_titles(hits) == ["模组EOL测试", "Pack总装工序"]


def test_golden_file_exists_and_loads() -> None:
    golden = load_golden(GOLDEN_PATH)
    assert len(golden) >= 30, "基线 golden 至少 30 条"


def test_golden_ids_unique_and_fields_non_empty() -> None:
    golden = load_golden(GOLDEN_PATH)
    ids = [item.id for item in golden]
    assert len(set(ids)) == len(ids)
    assert all(item.query.strip() for item in golden)
    assert all(item.expected for item in golden)


def test_golden_expected_anchors_are_known_doc_titles() -> None:
    golden = load_golden(GOLDEN_PATH)
    unknown = {
        title
        for item in golden
        for title in item.expected
        if title not in KNOWN_DOC_TITLES
    }
    assert not unknown, f"golden 锚点不是语料库文档标题: {unknown}"


def test_golden_covers_all_corpus_docs() -> None:
    golden = load_golden(GOLDEN_PATH)
    covered = {title for item in golden for title in item.expected}
    missing = KNOWN_DOC_TITLES - covered
    assert not missing, f"golden 未覆盖语料文档: {missing}"
