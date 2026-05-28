from app.artifacts.knowledge_gap_drafts import (
    FailedQuestionSignal,
    KnowledgeGapClusterRequest,
    build_knowledge_gap_cluster_drafts,
)


def test_build_knowledge_gap_cluster_drafts_generates_review_candidates() -> None:
    request = KnowledgeGapClusterRequest(
        min_frequency=2,
        failed_questions=[
            FailedQuestionSignal(
                id="fq-1",
                question="OCV 异常怎么处理？",
                event_type="refusal",
                confidence=0.1,
                query_understanding=[{"candidate_terms": [{"term": "OCV"}, {"term": "开路电压"}]}],
                retrieval_evidence=[{"chunk_id": "c1", "document_id": "d1", "title": "OCV SOP", "score": 0.42}],
            ),
            FailedQuestionSignal(
                id="fq-2",
                question="开路电压异常如何排查？",
                event_type="low_confidence",
                confidence=0.35,
                query_understanding=[{"candidate_terms": [{"term": "OCV"}, {"term": "开路电压"}]}],
            ),
            FailedQuestionSignal(
                id="fq-3",
                question="Busbar 焊接温升标准是什么？",
                event_type="refusal",
                query_understanding=[{"candidate_terms": [{"term": "Busbar"}]}],
            ),
        ],
    )

    result = build_knowledge_gap_cluster_drafts(request)

    assert result.schema_version == "knowledge-gap-cluster/v1"
    assert result.ignored_count == 1
    assert len(result.clusters) == 1

    cluster = result.clusters[0]
    assert cluster.gap_type == "mixed"
    assert cluster.frequency_count == 2
    assert cluster.sample_failed_question_ids == ["fq-1", "fq-2"]
    assert cluster.term_candidates[0].canonical_term == "OCV"
    assert cluster.alias_candidates[0].alias == "开路电压"
    assert cluster.faq_drafts[0].question == "OCV 异常怎么处理"
    assert cluster.knowledge_card_drafts[0].missing_evidence
    assert cluster.document_supplement_suggestions[0].suggested_sections
