from app.core import pipeline as pipeline_module
from app.core.pipeline import RagPipeline, REFUSAL_ANSWER, _estimate_confidence, _rewrite_query_with_trace
from app.evaluation import DiagramIR, build_llm_diagram_ir, plan_visual_artifacts, validate_diagram_ir
from app.schemas.models import AnswerIR


def _hit(score: float, content: str, chunk_id: str = "chunk-1", section: str = "工艺要求") -> dict:
    return {
        "chunk_id": chunk_id,
        "document_id": "doc-1",
        "document_title": "模组EOL测试规范",
        "section_path": section,
        "page_number": 8,
        "score": score,
        "snippet": content[:120],
        "content": content,
        "context_window": content,
        "source_context": {
            "content": content,
            "snippet": content[:120],
            "window": content,
            "available": bool(content),
        },
    }


def test_quality_eval_parameter_answer_confidence_and_answer_ir() -> None:
    query = "绝缘电阻测试的合格阈值是多少？"
    sources = [
        _hit(
            0.91,
            "绝缘电阻测试使用500V DC，测试结果应不低于20MΩ，低于阈值需要判定为不合格。",
            section="绝缘电阻 / 参数阈值",
        )
    ]

    confidence = _estimate_confidence(query, sources, {"document_id": "doc-1"})
    ir = AnswerIR.from_chat(
        answer="结论：绝缘电阻测试使用500V DC，合格阈值是不低于20MΩ。[来源 1]",
        sources=sources,
        original_query=query,
        rewritten_query=query,
        confidence=confidence,
    )

    assert confidence >= 0.72
    assert ir.status == "answered"
    assert ir.claims[0].citation_ids == ["chunk-1"]
    assert ir.citations[0].section_path == "绝缘电阻 / 参数阈值"


def test_quality_eval_flow_answer_diagram_has_top_down_sequence() -> None:
    def fake_chat(messages, temperature=None, response_format=None):
        return {
            "model": "quality-suite",
            "content": """
            {
              "title": "EOL测试流程",
              "objective": "提炼测试执行顺序",
              "diagram_type": "flowchart",
              "layout_hint": "top_to_bottom",
              "nodes": [
                {"id": "select", "label": "选择待测模组", "kind": "step", "source_ids": ["source-a"]},
                {"id": "connect", "label": "连接测试夹具", "kind": "action", "source_ids": ["source-a"]},
                {"id": "judge", "label": "测试结果是否合格", "kind": "decision", "source_ids": ["source-b"]},
                {"id": "record", "label": "记录并上传结果", "kind": "action", "source_ids": ["source-b"]}
              ],
              "edges": [
                {"source": "select", "target": "connect", "relation": "sequence"},
                {"source": "connect", "target": "judge", "relation": "condition"},
                {"source": "judge", "target": "record", "relation": "sequence"}
              ],
              "notes": ["保留流程主干"],
              "confidence": 0.86
            }
            """,
        }

    ir = build_llm_diagram_ir(
        title="EOL测试流程",
        content="回答正文：先选择待测模组，再连接测试夹具，如果测试结果合格则记录并上传结果。",
        source_ids=["source-a", "source-b"],
        diagram_type="flowchart",
        llm_chat=fake_chat,
    )

    assert ir.can_generate is True
    assert ir.quality_score >= 0.8
    assert ir.validation is not None
    assert ir.validation.layout_suggestion.direction == "top_to_bottom"
    assert [edge.source for edge in ir.edges] == ["select", "connect", "judge"]
    assert any(node.kind == "decision" for node in ir.nodes)
    assert ir.excalidraw_scene is not None
    assert ir.excalidraw_scene["type"] == "excalidraw"


def test_quality_eval_troubleshooting_answer_keeps_actionable_sources(monkeypatch) -> None:
    def fake_search(self, query, top_k, allowed_security_levels, filters=None):
        return {
            "latency_ms": 3,
            "results": [
                _hit(0.88, "DCR偏差超出±5%时，先检查探针接触力，再复核夹具定位和线缆连接。", "chunk-dcr", "异常排查 / DCR"),
                _hit(0.81, "复测仍异常时记录报警代码，并通知设备工程师检查采集模块。", "chunk-alarm", "异常排查 / 报警处理"),
            ],
        }

    def fake_llm_chat(messages, temperature=0.2):
        return {
            "content": "结论：先检查探针接触力，再复核夹具定位和线缆连接；复测仍异常时记录报警代码并通知设备工程师。[来源 1][来源 2]",
            "latency_ms": 4,
        }

    monkeypatch.setattr(RagPipeline, "search", fake_search)
    monkeypatch.setattr(pipeline_module, "llm_chat", fake_llm_chat)

    result = RagPipeline().chat(
        query="DCR偏差超出±5%通常有哪些排查步骤？",
        top_k=2,
        allowed_security_levels=["internal"],
    )

    assert result["confidence"] >= 0.7
    assert result["answer_ir"]["status"] == "answered"
    assert len(result["sources"]) == 2
    assert result["answer_ir"]["citations"][0]["section_path"] == "异常排查 / DCR"


def test_quality_eval_refusal_for_low_information_query(monkeypatch) -> None:
    def fake_search(self, query, top_k, allowed_security_levels, filters=None):
        return {"latency_ms": 2, "results": []}

    def fail_llm_chat(messages, temperature=0.2):
        raise AssertionError("低信息问题不应进入 LLM 回答")

    monkeypatch.setattr(RagPipeline, "search", fake_search)
    monkeypatch.setattr(pipeline_module, "llm_chat", fail_llm_chat)

    result = RagPipeline().chat(
        query="？？？",
        top_k=3,
        allowed_security_levels=["internal"],
    )

    assert result["answer"] == REFUSAL_ANSWER
    assert result["confidence"] == 0
    assert result["answer_ir"]["status"] == "insufficient_context"
    assert "low_information" in result["answer_ir"]["metadata"]["refusal_reasons"]


def test_quality_eval_pronoun_followup_rewrite_keeps_trace() -> None:
    rewrite = _rewrite_query_with_trace(
        "它异常时怎么处理？",
        history=[
            {"role": "user", "content": "绝缘电阻测试合格阈值是多少？"},
            {"role": "assistant", "content": "绝缘电阻测试阈值是不低于20MΩ。"},
        ],
    )

    assert rewrite.changed is True
    assert rewrite.strategy == "history_pronoun_resolution"
    assert rewrite.rewritten_query == "绝缘电阻测试合格阈值异常时怎么处理？"
    assert rewrite.signals == ["history_topic", "pronoun"]


def test_quality_eval_diagram_topology_rejects_broken_edges_and_missing_coverage() -> None:
    ir = DiagramIR.model_validate({
        "title": "断裂图解",
        "diagram_type": "flowchart",
        "nodes": [
            {"id": "step-1", "label": "选择待测模组", "source_ids": ["source-a"]},
            {"id": "step-2", "label": "执行绝缘测试", "source_ids": ["source-a"]},
        ],
        "edges": [
            {"source": "step-1", "target": "step-2", "relation": "sequence"},
            {"source": "step-2", "target": "missing", "relation": "sequence"},
        ],
    })

    result = validate_diagram_ir(ir, ["source-a", "source-b"])

    assert result.can_generate is False
    assert result.missing_source_ids == ["source-b"]
    assert any(error.code == "edge_endpoint_missing" for error in result.errors)


def test_quality_eval_visual_planner_auto_selects_primary_flowchart() -> None:
    plan = plan_visual_artifacts(
        question="DCR异常的排查流程是什么？",
        answer="先检查探针接触力，然后复核夹具定位。如果复测仍异常，记录报警并通知设备工程师。",
        sources=[_hit(0.88, "DCR异常时先检查探针接触力，再复核夹具定位。", "chunk-flow")],
        confidence=0.82,
    )

    assert plan.can_generate is True
    assert plan.artifacts[0].artifact_type == "flowchart"
    assert plan.artifacts[0].auto_generate is True
    assert plan.artifacts[0].source_ids == ["chunk-flow"]


def test_quality_eval_visual_planner_refuses_low_evidence() -> None:
    plan = plan_visual_artifacts(
        question="这个画个图？",
        answer=REFUSAL_ANSWER,
        sources=[],
        confidence=0,
        answer_status="insufficient_context",
    )

    assert plan.can_generate is False
    assert plan.artifacts == []
    assert plan.warnings[0].code == "visual_plan_not_ready"
