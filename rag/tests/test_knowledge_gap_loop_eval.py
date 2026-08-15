from evals.knowledge_gap_loop_eval import FailedQuestionEvalCase, evaluate_failed_question_learning_loop


def test_failed_question_loop_eval_measures_recall_and_false_refusal_improvement() -> None:
    cases = (
        FailedQuestionEvalCase(
            id="fq-eol",
            question="模组 EOL 测试需要注意哪些安全事项？",
            expected_terms=("EOL", "终检测试", "安全事项"),
            expected_asset_ids=("term-eol",),
        ),
        FailedQuestionEvalCase(
            id="fq-dcr",
            question="DCR 偏差超出范围时怎么排查？",
            expected_terms=("DCR", "直流内阻", "偏差排查"),
            expected_asset_ids=("faq-dcr", "card-dcr"),
        ),
    )
    before_assets = (
        {"id": "draft-eol", "status": "ai_draft", "title": "EOL 草稿", "related_terms": ["EOL"], "source_ids": ["chunk-eol"]},
    )
    after_assets = (
        {
            "id": "term-eol",
            "asset_type": "term",
            "status": "published",
            "title": "EOL",
            "summary": "模组下线终检测试。",
            "aliases": ["终检测试", "模组EOL"],
            "related_terms": ["安全事项"],
            "source_ids": ["chunk-eol"],
        },
        {
            "id": "faq-dcr",
            "asset_type": "faq",
            "status": "published",
            "title": "DCR 偏差排查",
            "summary": "先复核探针接触力，再检查夹具定位和线缆连接。",
            "related_terms": ["DCR", "直流内阻", "偏差排查"],
            "source_ids": ["chunk-dcr"],
        },
    )

    report = evaluate_failed_question_learning_loop(cases, before_assets=before_assets, after_assets=after_assets)

    assert report.before.recall_rate == 0
    assert report.before.false_refusal_rate == 1
    assert report.after.recall_rate == 1
    assert report.after.false_refusal_rate == 0
    assert report.after.expected_asset_hit_rate == 1
    assert report.recall_delta == 1
    assert report.false_refusal_delta == -1
    assert report.improved is True


def test_failed_question_loop_eval_requires_published_source_backed_assets() -> None:
    case = FailedQuestionEvalCase(
        id="fq-ocv",
        question="OCV 异常复测怎么处理？",
        expected_terms=("OCV", "开路电压"),
        expected_asset_ids=("asset-ocv",),
    )
    assets = (
        {"id": "asset-ocv", "status": "published", "title": "OCV 异常", "related_terms": ["OCV"]},
        {"id": "asset-draft", "status": "ai_draft", "title": "开路电压", "related_terms": ["开路电压"], "source_ids": ["chunk-ocv"]},
    )

    report = evaluate_failed_question_learning_loop((case,), after_assets=assets)

    assert report.after.recall_rate == 0
    assert report.after.false_refusal_rate == 1
    assert report.after.expected_asset_hit_rate == 0
