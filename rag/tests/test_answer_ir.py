from app.core.pipeline.answer_verification import verify_answer_ir
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


def test_answer_verifier_flags_claims_not_supported_by_citations() -> None:
    source = {
        **_source(),
        "snippet": "绝缘电阻测试电压为500V DC，合格阈值不低于20MΩ。",
        "content": "绝缘电阻测试电压为500V DC，合格阈值不低于20MΩ。",
    }
    ir = AnswerIR.from_chat(
        answer="参数：绝缘电阻测试电压为1000V DC，合格阈值不低于20MΩ。[来源 1]",
        sources=[source],
        original_query="绝缘电阻测试参数是什么？",
        rewritten_query="绝缘电阻测试参数是什么？",
        confidence=0.84,
    )

    verified = verify_answer_ir(ir, sources=[source], hits=[source])
    warning_codes = [warning.code for warning in verified.warnings]

    assert "unsupported_claims" in warning_codes
    assert "verification_downgraded" in warning_codes
    assert verified.status == "insufficient_context"
    assert verified.confidence == 0
    assert verified.metadata["verification_decision"]["reason"] == "unsupported_claims"
    assert verified.metadata["answer_verification"]["claim_coverage_ratio"] == 0
    assert verified.metadata["answer_verification"]["unsupported_claims"][0]["claim_id"] == "claim-1"


def test_answer_verifier_downgrades_partial_when_some_claims_are_unsupported() -> None:
    source = {
        **_source(),
        "snippet": "绝缘电阻测试电压为500V DC，合格阈值不低于20MΩ。",
        "content": "绝缘电阻测试电压为500V DC，合格阈值不低于20MΩ。",
    }
    ir = AnswerIR.from_chat(
        answer="参数：绝缘电阻测试电压为500V DC。[来源 1] 风险：温度超过80℃必须停线。[来源 1]",
        sources=[source],
        original_query="绝缘电阻测试参数和温度限制是什么？",
        rewritten_query="绝缘电阻测试参数和温度限制是什么？",
        confidence=0.84,
    )

    verified = verify_answer_ir(ir, sources=[source], hits=[source])
    warning_codes = [warning.code for warning in verified.warnings]

    assert verified.status == "partial"
    assert verified.confidence == 0.59
    assert "unsupported_claims" in warning_codes
    assert "verification_downgraded" in warning_codes
    assert verified.metadata["verification_decision"]["reason"] == "partial_unsupported_claims"
    assert verified.metadata["answer_verification"]["claim_coverage_ratio"] == 0.5


def test_answer_verifier_flags_deprecated_expired_and_version_conflict_sources() -> None:
    old_source = {
        **_source(),
        "chunk_id": "chunk-old",
        "version": "v1",
        "status": "deprecated",
        "metadata": {"valid_until": "2025-01-01"},
        "snippet": "旧版要求夹具接地后再启动测试。",
        "content": "旧版要求夹具接地后再启动测试。",
    }
    new_source = {
        **_source(),
        "chunk_id": "chunk-new",
        "version": "v2",
        "snippet": "新版要求夹具接地后再启动测试。",
        "content": "新版要求夹具接地后再启动测试。",
    }
    ir = AnswerIR.from_chat(
        answer="步骤：夹具接地后再启动测试。[来源 1][来源 2]",
        sources=[old_source, new_source],
        original_query="夹具接地后怎么操作？",
        rewritten_query="夹具接地后怎么操作？",
        confidence=0.88,
    )

    verified = verify_answer_ir(ir, sources=[old_source, new_source], hits=[old_source, new_source])
    warning_codes = [warning.code for warning in verified.warnings]
    verification = verified.metadata["answer_verification"]

    assert verified.status == "partial"
    assert verified.confidence == 0.59
    assert "deprecated_sources" in warning_codes
    assert "expired_sources" in warning_codes
    assert "version_conflict" in warning_codes
    assert "verification_downgraded" in warning_codes
    assert verified.metadata["verification_decision"]["reason"] == "stale_sources"
    assert verification["deprecated_sources"][0]["citation_id"] == "chunk-old"
    assert verification["expired_sources"][0]["citation_id"] == "chunk-old"
    assert verification["version_conflicts"][0]["versions"] == {"v1": ["chunk-old"], "v2": ["chunk-new"]}


def test_answer_verifier_flags_contradictory_evidence_candidates() -> None:
    positive = {
        **_source(),
        "chunk_id": "chunk-a",
        "snippet": "绝缘测试夹具接地前必须检查接地线连续性。",
        "content": "绝缘测试夹具接地前必须检查接地线连续性。",
        "context_window": "绝缘测试夹具接地前必须检查接地线连续性。",
        "source_context": {"window": "绝缘测试夹具接地前必须检查接地线连续性。"},
    }
    negative = {
        **_source(),
        "chunk_id": "chunk-b",
        "snippet": "绝缘测试夹具接地前不需要检查接地线连续性。",
        "content": "绝缘测试夹具接地前不需要检查接地线连续性。",
        "context_window": "绝缘测试夹具接地前不需要检查接地线连续性。",
        "source_context": {"window": "绝缘测试夹具接地前不需要检查接地线连续性。"},
    }
    ir = AnswerIR.from_chat(
        answer="结论：资料对接地前是否检查接地线连续性存在差异。[来源 1][来源 2]",
        sources=[positive, negative],
        original_query="绝缘测试夹具接地前是否需要检查接地线连续性？",
        rewritten_query="绝缘测试夹具接地前是否需要检查接地线连续性？",
        confidence=0.78,
    )

    verified = verify_answer_ir(ir, sources=[positive, negative], hits=[positive, negative])
    warning_codes = [warning.code for warning in verified.warnings]

    assert "contradictory_evidence" in warning_codes
    assert verified.status == "partial"
    assert verified.confidence == 0.59
    assert "verification_downgraded" in warning_codes
    assert verified.metadata["verification_decision"]["reason"] == "contradictory_evidence"
    assert verified.metadata["answer_verification"]["contradictory_evidence"][0]["positive"]["citation_id"] == "chunk-a"
