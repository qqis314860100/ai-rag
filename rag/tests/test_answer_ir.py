from app.schemas.models import AnswerIR, ChatResult


def _source() -> dict:
    return {
        "chunk_id": "chunk-1",
        "document_id": "doc-1",
        "document_title": "模组EOL测试",
        "section_path": "5. 安全注意事项",
        "page_number": 12,
        "offset_start": 30,
        "offset_end": 80,
        "score": 0.82,
        "snippet": "绝缘电阻测试前需要确认夹具、线缆和安全防护。",
        "content": "绝缘电阻测试前需要确认夹具、线缆和安全防护。",
    }


def test_answer_ir_maps_chat_fields_to_structured_contract() -> None:
    ir = AnswerIR.from_chat(
        answer="结论：绝缘电阻测试前需要确认夹具、线缆和安全防护。",
        sources=[_source()],
        original_query="第五章安全注意事项是什么？",
        rewritten_query="第五章安全注意事项是什么？ 第5章",
        confidence=0.82,
    )

    assert ir.schema_version == "answer-ir/v1"
    assert ir.status == "answered"
    assert ir.confidence == 0.82
    assert ir.query_rewrite.changed is True
    assert ir.query_rewrite.strategy == "chapter_number_expansion"
    assert ir.claims[0].text.startswith("结论")
    assert ir.claims[0].citation_ids == ["chunk-1"]
    assert ir.citations[0].document_title == "模组EOL测试"
    assert ir.citations[0].section_path == "5. 安全注意事项"
    assert ir.warnings == []


def test_answer_ir_extracts_granular_claim_kinds_with_citations() -> None:
    ir = AnswerIR.from_chat(
        answer=(
            "结论：绝缘电阻测试应按EOL规范执行。[来源 1]"
            "参数：测试电压为500V DC，合格阈值不低于20MΩ。[来源 1]"
            "步骤：先确认夹具和线缆，再记录并上传结果。[来源 1]"
            "风险：低于阈值需要判定为不合格并转入复核。[来源 1]"
            "限制：知识库未提供区分泄漏电流类型的具体算法。[来源 1]"
        ),
        sources=[_source()],
        original_query="绝缘电阻测试怎么执行？",
        rewritten_query="绝缘电阻测试怎么执行？",
        confidence=0.86,
    )

    claims_by_kind = {claim.kind: claim for claim in ir.claims}

    assert set(claims_by_kind) == {"conclusion", "parameter", "step", "risk", "limitation"}
    assert claims_by_kind["parameter"].citation_ids == ["chunk-1"]
    assert claims_by_kind["step"].text.startswith("步骤")
    assert all(claim.citation_ids for claim in ir.claims)


def test_answer_ir_matches_claims_to_relevant_citations_without_markers() -> None:
    parameter_source = {
        **_source(),
        "chunk_id": "chunk-parameter",
        "snippet": "测试电压为500V DC，合格阈值不低于20MΩ。",
    }
    risk_source = {
        **_source(),
        "chunk_id": "chunk-risk",
        "snippet": "低于阈值需要判定为不合格，并转入异常复核。",
    }
    ir = AnswerIR.from_chat(
        answer="参数：测试电压为500V DC，合格阈值不低于20MΩ。风险：低于阈值需要判定为不合格并转入复核。",
        sources=[parameter_source, risk_source],
        original_query="绝缘测试阈值和风险是什么？",
        rewritten_query="绝缘测试阈值和风险是什么？",
        confidence=0.83,
    )

    claims_by_kind = {claim.kind: claim for claim in ir.claims}

    assert claims_by_kind["parameter"].citation_ids == ["chunk-parameter"]
    assert claims_by_kind["risk"].citation_ids == ["chunk-risk"]


def test_answer_ir_marks_missing_citations_as_insufficient_context() -> None:
    ir = AnswerIR.from_chat(
        answer="根据当前知识库信息，我暂时无法确认该问题。",
        sources=[],
        original_query="不存在的问题",
        rewritten_query="不存在的问题",
        confidence=0,
    )

    assert ir.status == "insufficient_context"
    assert ir.claims == []
    assert ir.warnings[0].code == "no_citations"


def test_answer_ir_refusal_phrase_zeroes_answer_confidence_with_sources() -> None:
    ir = AnswerIR.from_chat(
        answer="根据当前知识库信息，我暂时无法确认该问题。",
        sources=[_source()],
        original_query="EOL测试",
        rewritten_query="EOL测试",
        confidence=0.82,
    )

    assert ir.status == "insufficient_context"
    assert ir.confidence == 0
    assert ir.claims == []
    assert len(ir.citations) == 1


def test_answer_ir_keeps_partial_answer_when_only_some_details_are_missing() -> None:
    ir = AnswerIR.from_chat(
        answer="知识库可确认 Pack 级绝缘与耐压测试包含 Y 电容，直流耐压测试更适合。知识库未提供区分泄漏电流类型的具体算法。",
        sources=[_source()],
        original_query="如何区分 Y 电容泄漏电流与绝缘缺陷泄漏电流？",
        rewritten_query="如何区分 Y 电容泄漏电流与绝缘缺陷泄漏电流？",
        confidence=0.72,
    )

    assert ir.status == "answered"
    assert ir.confidence == 0.72
    assert ir.claims


def test_chat_result_keeps_legacy_payload_compatible_without_answer_ir() -> None:
    result = ChatResult(
        answer="旧客户端仍然只读取 answer/sources/confidence。",
        sources=[],
        confidence=0.7,
    )

    payload = result.model_dump()
    assert payload["answer"] == "旧客户端仍然只读取 answer/sources/confidence。"
    assert payload["sources"] == []
    assert payload["confidence"] == 0.7
    assert payload["answer_ir"] is None
