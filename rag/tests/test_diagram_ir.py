from app.artifacts import (
    DiagramEdge,
    DiagramIR,
    DiagramNode,
    build_keyword_diagram_ir,
    build_llm_diagram_ir,
    extract_diagram_keywords,
    validate_diagram_ir,
)


def test_build_keyword_diagram_ir_keeps_flow_structure() -> None:
    ir = build_keyword_diagram_ir(
        title="产线排查流程",
        content="1. 确认设备报警现象。2. 定位传感器和夹具状态。3. 如果压力异常则复位阀门。4. 验证恢复。",
        source_ids=["source-a", "source-b"],
        diagram_type="flowchart",
    )

    assert ir.title == "产线排查流程"
    assert ir.type == "flowchart"
    assert ir.layout_hint == "top_to_bottom"
    assert ir.schema_version == "diagram-ir/v2"
    assert ir.can_generate is False
    assert ir.quality_score > 0
    assert ir.validation is not None
    assert ir.validation.can_generate is False
    assert ir.validation.layout_suggestion.direction == "top_to_bottom"
    assert [node.id for node in ir.nodes][:3] == ["step-1", "step-2", "step-3"]
    assert any(node.kind == "decision" for node in ir.nodes)
    assert any(node.kind == "action" for node in ir.nodes)
    assert any(edge.relation == "condition" for edge in ir.edges)
    assert any("设备报警现象" in keyword for keyword in ir.metadata["keywords"])
    assert ir.renderer == "excalidraw"
    assert ir.metadata["renderer"] == "excalidraw"
    assert ir.metadata["legacy_renderer"] == "positioned-svg"
    assert ir.confidence > 0
    assert "4 个步骤" in ir.reason
    assert ir.source_evidence == [{"source_id": "source-a", "title": "", "section": "", "snippet": ""}, {"source_id": "source-b", "title": "", "section": "", "snippet": ""}]
    assert ir.excalidraw_scene is not None
    assert ir.excalidraw_scene["type"] == "excalidraw"
    assert ir.excalidraw_scene["metadata"]["type"] == "flowchart"
    assert any(element["type"] == "arrow" for element in ir.excalidraw_scene["elements"])
    assert any(element["type"] == "text" and element["containerId"] == "node-step-1" for element in ir.excalidraw_scene["elements"])
    assert ir.metadata["artifact_payload"]["renderer"] == "excalidraw"
    assert ir.metadata["artifact_payload"]["can_generate"] is False
    assert ir.metadata["artifact_payload"]["quality_score"] == ir.quality_score
    assert ir.metadata["artifact_payload"]["citation_coverage"]["coverage_ratio"] == 1.0
    assert ir.metadata["artifact_payload"]["element_count"] == len(ir.excalidraw_scene["elements"])
    assert all("layout" in node.metadata for node in ir.nodes)
    assert all("render" in node.metadata for node in ir.nodes)
    assert all("render" in edge.metadata for edge in ir.edges)
    assert any(error.code == "decision_branch_outgoing_required" for error in ir.validation.errors)


def test_build_keyword_diagram_ir_groups_mindmap_keywords() -> None:
    ir = build_keyword_diagram_ir(
        title="工艺风险整理",
        content=(
            "回答正文：温度窗口需要保持稳定，压力控制异常会触发安全风险，设备夹具需要复核。\n\n"
            "[引用 1]\n"
            "文档：模组EOL测试\n"
            "章节：模组EOL测试 / 5. 安全注意事项\n"
            "片段：测试前确认夹具状态，压力异常时记录报警并复核设备。"
        ),
        source_ids=["source-a"],
        diagram_type="mindmap",
    )

    assert ir.type == "mindmap"
    assert ir.layout_hint == "radial"
    assert ir.can_generate is True
    assert ir.validation is not None
    assert ir.validation.missing_source_ids == []
    assert ir.validation.layout_suggestion.direction == "radial"
    assert ir.nodes[0].kind == "root"
    assert any(node.kind == "category" and node.label == "风险" for node in ir.nodes)
    assert any(node.kind == "keyword" and "压力" in node.label for node in ir.nodes)
    assert not any(node.kind == "evidence" for node in ir.nodes)
    assert not any(edge.relation == "supported_by" for edge in ir.edges)
    assert "risk" in ir.metadata["categories"]
    assert "安全注意事项" in str(ir.metadata["keyword_evidence"])
    assert ir.renderer == "excalidraw"
    assert ir.metadata["renderer"] == "excalidraw"
    assert ir.source_evidence[0]["source_id"] == "source-a"
    assert ir.source_evidence[0]["section"] == "模组EOL测试 / 5. 安全注意事项"
    assert "来源证据" in ir.reason
    assert ir.excalidraw_scene is not None
    assert any(element["type"] == "rectangle" for element in ir.excalidraw_scene["elements"])
    assert all("layout" in node.metadata for node in ir.nodes)
    assert all("render" in node.metadata for node in ir.nodes)
    assert all("render" in edge.metadata for edge in ir.edges)


def test_build_llm_diagram_ir_uses_structured_business_nodes_only() -> None:
    def fake_chat(messages, temperature=None, response_format=None):
        assert response_format == {"type": "json_object"}
        assert "DIAGRAM_IR_STRUCTURED_OUTPUT" in messages[0]["content"]
        return {
            "model": "fake-structured",
            "content": """
            {
              "title": "压力异常排查",
              "objective": "提炼排查步骤和判断点",
              "type": "flowchart",
              "layout_hint": "top_to_bottom",
              "nodes": [
                {"id": "start", "label": "确认压力报警", "kind": "step", "source_ids": ["source-a"]},
                {"id": "cite-1", "label": "引用 1", "kind": "evidence", "source_ids": ["source-a"]},
                {"id": "check-valve", "label": "检查阀门复位状态", "kind": "action", "source_ids": ["source-b"]},
                {"id": "decision", "label": "压力是否恢复", "kind": "decision", "source_ids": ["source-b"]}
              ],
              "edges": [
                {"source": "start", "target": "cite-1", "relation": "supported_by"},
                {"source": "start", "target": "check-valve", "relation": "sequence"},
                {"source": "check-valve", "target": "decision", "relation": "condition"}
              ],
              "notes": ["只保留业务节点"],
              "confidence": 0.82
            }
            """,
        }

    ir = build_llm_diagram_ir(
        title="压力异常排查",
        content="回答正文：1. 确认压力报警。2. 检查阀门复位状态。3. 判断压力是否恢复。",
        source_ids=["source-a", "source-b"],
        diagram_type="flowchart",
        llm_chat=fake_chat,
    )

    assert ir.metadata["generation_mode"] == "llm_structured"
    assert ir.metadata["model"] == "fake-structured"
    assert ir.type == "flowchart"
    assert [node.label for node in ir.nodes] == ["确认压力报警", "检查阀门复位状态", "压力是否恢复"]
    assert not any(node.kind == "evidence" for node in ir.nodes)
    assert not any(edge.relation == "supported_by" for edge in ir.edges)
    assert ir.validation is not None
    assert ir.validation.missing_source_ids == []
    assert ir.renderer == "excalidraw"
    assert ir.metadata["artifact_payload"]["renderer"] == "excalidraw"


def test_build_llm_diagram_ir_preserves_flowchart_semantics_and_legacy_relations() -> None:
    def fake_chat(messages, temperature=None, response_format=None):
        assert "角色、动作、判断、分支、循环和最终结果" in messages[0]["content"]
        assert "can_generate=false" in messages[0]["content"]
        assert "flow_semantics" in messages[1]["content"]
        assert "start|end|input|output|step|action|decision|subflow" in messages[1]["content"]
        assert "loop|fallback|flows_to" in messages[1]["content"]
        return {
            "model": "fake-flow-semantics",
            "content": """
            {
              "title": "返修闭环流程",
              "objective": "保留流程图节点和边语义",
              "type": "flowchart",
              "layout_hint": "top_to_bottom",
              "nodes": [
                {"id": "begin", "label": "开始接收异常", "kind": "start", "source_ids": ["source-a"]},
                {"id": "input-order", "label": "导入返修工单", "kind": "input", "source_ids": ["source-a"]},
                {"id": "inspect", "label": "执行外观复检", "kind": "action", "source_ids": ["source-a"]},
                {"id": "judge", "label": "是否复检通过", "kind": "decision", "source_ids": ["source-b"]},
                {"id": "repair", "label": "进入返修子流程", "kind": "subflow", "source_ids": ["source-b"]},
                {"id": "report", "label": "输出复检报告", "kind": "output", "source_ids": ["source-b"]},
                {"id": "done", "label": "结束归档", "kind": "end", "source_ids": ["source-b"]}
              ],
              "edges": [
                {"source": "begin", "target": "input-order", "relation": "sequence"},
                {"source": "input-order", "target": "inspect", "relation": "flows_to"},
                {"source": "inspect", "target": "judge", "relation": "condition", "label": "复检"},
                {"source": "judge", "target": "repair", "relation": "fallback", "label": "不通过"},
                {"source": "repair", "target": "inspect", "relation": "loop", "label": "返工后复检"},
                {"source": "judge", "target": "report", "relation": "condition", "label": "通过"},
                {"source": "report", "target": "done", "relation": "sequence"}
              ],
              "notes": ["覆盖新流程图语义"],
              "confidence": 0.88
            }
            """,
        }

    ir = build_llm_diagram_ir(
        title="返修闭环流程",
        content="回答正文：开始接收异常后导入返修工单，复检不通过则进入返修子流程并回流复检，通过后输出报告并归档。",
        source_ids=["source-a", "source-b"],
        diagram_type="flowchart",
        llm_chat=fake_chat,
    )

    assert [node.kind for node in ir.nodes] == ["start", "input", "action", "decision", "subflow", "output", "end"]
    assert {"sequence", "flows_to", "condition", "fallback", "loop"} <= {edge.relation for edge in ir.edges}
    assert ir.validation is not None
    assert not any(warning.code == "unknown_node_kind" for warning in ir.validation.warnings)
    assert not any(warning.code == "unknown_edge_relation" for warning in ir.validation.warnings)
    assert all("layout" in node.metadata for node in ir.nodes)
    assert all("render" in edge.metadata for edge in ir.edges)


def test_build_llm_diagram_ir_outputs_swimlane_metadata_for_multi_role_flow() -> None:
    def fake_chat(messages, temperature=None, response_format=None):
        assert "lanes" in messages[1]["content"]
        assert "lane_id" in messages[1]["content"]
        return {
            "model": "fake-swimlane",
            "content": """
            {
              "title": "多角色审核发布流程",
              "objective": "按角色归属生成泳道流程",
              "type": "flowchart",
              "layout_hint": "top_to_bottom",
              "flow_semantics": {
                "roles": ["操作员", "审核员", "MES"],
                "actions": ["提交记录", "审核记录", "发布归档"],
                "decisions": ["审核是否通过"],
                "branches": ["通过发布", "不通过返工"],
                "loops": ["不通过退回操作员补正"],
                "final_results": ["记录发布归档"]
              },
              "lanes": [
                {"id": "operator", "label": "操作员"},
                {"id": "reviewer", "label": "审核员"},
                {"id": "mes", "label": "MES"}
              ],
              "nodes": [
                {"id": "submit", "label": "提交生产记录", "kind": "start", "source_ids": ["source-a"], "lane_id": "operator"},
                {"id": "review", "label": "审核记录完整性", "kind": "decision", "source_ids": ["source-b"], "lane_id": "reviewer"},
                {"id": "fix", "label": "补正异常记录", "kind": "action", "source_ids": ["source-a"], "lane_id": "operator"},
                {"id": "publish", "label": "发布并归档记录", "kind": "end", "source_ids": ["source-b"], "lane_id": "mes"}
              ],
              "edges": [
                {"source": "submit", "target": "review", "relation": "sequence"},
                {"source": "review", "target": "publish", "relation": "condition", "label": "通过"},
                {"source": "review", "target": "fix", "relation": "fallback", "label": "不通过"},
                {"source": "fix", "target": "review", "relation": "loop", "label": "补正后复审"}
              ],
              "confidence": 0.86
            }
            """,
        }

    ir = build_llm_diagram_ir(
        title="多角色审核发布流程",
        content="回答正文：操作员提交记录，审核员审核是否通过，不通过退回补正，通过后 MES 发布归档。",
        source_ids=["source-a", "source-b"],
        diagram_type="flowchart",
        llm_chat=fake_chat,
    )

    assert [lane.label for lane in ir.lanes] == ["操作员", "审核员", "MES"]
    assert ir.metadata["layout_rule"] == "swimlane_flowchart_by_role"
    assert ir.metadata["artifact_payload"]["lanes"][0]["label"] == "操作员"
    assert {node.metadata.get("lane_id") for node in ir.nodes} == {"operator", "reviewer", "mes"}
    assert ir.validation is not None
    assert not ir.validation.errors


def test_build_llm_diagram_ir_respects_structured_refusal_without_keyword_fallback() -> None:
    def fake_chat(messages, temperature=None, response_format=None):
        assert response_format == {"type": "json_object"}
        return {
            "model": "fake-flow-refusal",
            "content": """
            {
              "title": "闲聊无法出流程",
              "objective": "判断是否可以生成流程图",
              "type": "flowchart",
              "layout_hint": "top_to_bottom",
              "can_generate": false,
              "reason": "回答和引用只有评价性描述，没有可排序的动作、判断分支或最终结果。",
              "flow_semantics": {
                "roles": [],
                "actions": [],
                "decisions": [],
                "branches": [],
                "loops": [],
                "final_results": []
              },
              "nodes": [],
              "edges": [],
              "notes": ["低信息拒绝生成"],
              "confidence": 0.2
            }
            """,
        }

    ir = build_llm_diagram_ir(
        title="闲聊无法出流程",
        content="回答正文：这个问题没有提供 SOP、异常处理或审批步骤，只能给出概念性说明。",
        source_ids=["source-a"],
        diagram_type="flowchart",
        llm_chat=fake_chat,
    )

    assert ir.can_generate is False
    assert ir.nodes == []
    assert ir.edges == []
    assert ir.metadata["generation_mode"] == "llm_structured"
    assert ir.metadata["structured_refusal"] is True
    assert "动作、判断分支或最终结果" in ir.reason
    assert ir.metadata["artifact_payload"]["can_generate"] is False
    assert ir.excalidraw_scene is not None
    assert ir.excalidraw_scene["elements"] == []


def test_build_llm_diagram_ir_falls_back_when_structured_output_is_invalid() -> None:
    def fake_chat(messages, temperature=None, response_format=None):
        return {"model": "fake-bad", "content": "无法生成 JSON"}

    ir = build_llm_diagram_ir(
        title="工艺风险整理",
        content="回答正文：温度窗口需要保持稳定，压力控制异常会触发安全风险。",
        source_ids=["source-a"],
        diagram_type="mindmap",
        llm_chat=fake_chat,
    )

    assert ir.metadata["generation_mode"] == "keyword_fallback"
    assert ir.type == "mindmap"
    assert not any(node.kind == "evidence" for node in ir.nodes)


def test_extract_diagram_keywords_prefers_repeated_domain_terms() -> None:
    keywords = extract_diagram_keywords("夹具状态异常，夹具复位后检查压力，压力异常继续报警。", limit=3)

    assert keywords[0] in {"夹具", "压力", "异常"}


def test_validate_diagram_ir_rejects_invalid_edges_and_tracks_source_coverage() -> None:
    ir = DiagramIR(
        title="无效图解",
        type="flowchart",
        nodes=[DiagramNode(id="step-1", label="确认夹具状态", source_ids=["source-a"])],
        edges=[DiagramEdge(source="step-1", target="missing", relation="sequence")],
    )

    result = validate_diagram_ir(ir, ["source-a", "source-b"])

    assert result.can_generate is False
    assert result.quality_score < 0.72
    assert result.required_source_ids == ["source-a", "source-b"]
    assert result.covered_source_ids == ["source-a"]
    assert result.missing_source_ids == ["source-b"]
    assert result.citation_coverage_ratio == 0.5
    assert result.layout_suggestion.direction == "top_to_bottom"
    assert any(error.code == "edge_endpoint_missing" for error in result.errors)
    assert any(warning.code == "missing_source_coverage" for warning in result.warnings)


def test_validate_diagram_ir_enforces_flowchart_quality_gates() -> None:
    ir = DiagramIR(
        title="返工流程",
        type="flowchart",
        nodes=[
            DiagramNode(id="start", label="开始接收异常", kind="start", source_ids=["source-a"]),
            DiagramNode(id="judge", label="是否复检通过", kind="decision", source_ids=[]),
            DiagramNode(id="repair", label="进入返修", kind="subflow", source_ids=["source-a"]),
            DiagramNode(id="done", label="结束归档", kind="end", source_ids=["source-a"]),
        ],
        edges=[
            DiagramEdge(source="start", target="judge", relation="sequence"),
            DiagramEdge(source="judge", target="repair", relation="fallback", label="不通过"),
            DiagramEdge(source="repair", target="judge", relation="loop"),
            DiagramEdge(source="judge", target="done", relation="condition"),
        ],
        metadata={"requested_node_limit": 3},
    )

    result = validate_diagram_ir(ir, ["source-a"])
    error_codes = {error.code for error in result.errors}

    assert result.can_generate is False
    assert "decision_branch_outgoing_required" in error_codes
    assert "loop_edge_missing_label" in error_codes
    assert "business_node_missing_source" in error_codes
    assert "flowchart_node_limit_exceeded" in error_codes


def test_build_llm_diagram_ir_records_node_limit_split_hint() -> None:
    def fake_chat(messages, temperature=None, response_format=None):
        return {
            "model": "fake-node-limit",
            "content": """
            {
              "title": "长流程",
              "objective": "测试节点上限提示",
              "type": "flowchart",
              "layout_hint": "top_to_bottom",
              "nodes": [
                {"id": "start", "label": "开始接收工单", "kind": "start", "source_ids": ["source-a"]},
                {"id": "check", "label": "检查夹具状态", "kind": "action", "source_ids": ["source-a"]},
                {"id": "repair", "label": "进入返修子流程", "kind": "subflow", "source_ids": ["source-a"]},
                {"id": "done", "label": "结束归档", "kind": "end", "source_ids": ["source-a"]}
              ],
              "edges": [
                {"source": "start", "target": "check", "relation": "sequence"}
              ],
              "confidence": 0.8
            }
            """,
        }

    ir = build_llm_diagram_ir(
        title="长流程",
        content="回答正文：开始接收工单后检查夹具状态，再进入返修子流程并结束归档。",
        source_ids=["source-a"],
        diagram_type="flowchart",
        max_steps=2,
        llm_chat=fake_chat,
    )

    assert len(ir.nodes) == 2
    assert ir.metadata["requested_node_limit"] == 2
    assert ir.metadata["original_node_count"] == 4
    assert ir.metadata["node_limit_exceeded"] is True
    assert any("拆分为子流程" in note for note in ir.notes)
    assert ir.validation is not None
    assert any(warning.code == "flowchart_node_limit_exceeded" for warning in ir.validation.warnings)
