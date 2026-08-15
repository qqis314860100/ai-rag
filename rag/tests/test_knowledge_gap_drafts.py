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


def test_build_knowledge_gap_cluster_drafts_accepts_notes_and_high_confidence_answers() -> None:
    request = KnowledgeGapClusterRequest(
        min_frequency=2,
        failed_questions=[
            FailedQuestionSignal(
                id="fq-eol",
                question="模组 EOL 测试为什么一直拒答？",
                event_type="refusal",
                query_understanding=[{"candidate_terms": [{"term": "EOL"}, {"term": "终检测试"}]}],
            ),
        ],
        manual_notes=[
            {
                "id": "note-eol",
                "content": "现场工程师补充：模组 EOL 也叫终检测试，安全注意事项需要引用高压测试 SOP。",
                "query_understanding": [{"terms": ["EOL", "终检测试", "高压测试"]}],
            }
        ],
        high_confidence_answers=[
            {
                "id": "answer-eol",
                "question": "EOL 测试有哪些安全注意事项？",
                "answer": "EOL 测试前需要确认高压互锁、绝缘防护和急停状态。",
                "confidence": 0.88,
                "retrieval_evidence": [{"chunk_id": "eol-safe", "title": "EOL 安全 SOP", "score": 0.9}],
            }
        ],
    )

    result = build_knowledge_gap_cluster_drafts(request)

    assert result.metadata["failed_question_count"] == 1
    assert result.metadata["manual_note_count"] == 1
    assert result.metadata["high_confidence_answer_count"] == 1
    assert result.clusters[0].frequency_count == 3
    assert result.clusters[0].term_candidates[0].canonical_term == "EOL"
    assert result.clusters[0].retrieval_evidence[0]["chunk_id"] == "eol-safe"
