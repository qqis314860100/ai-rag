from app.evaluation import build_keyword_diagram_ir, extract_diagram_keywords


def test_build_keyword_diagram_ir_keeps_flow_structure() -> None:
    ir = build_keyword_diagram_ir(
        title="产线排查流程",
        content="1. 确认设备报警现象。2. 定位传感器和夹具状态。3. 如果压力异常则复位阀门。4. 验证恢复。",
        source_ids=["source-a", "source-b"],
        diagram_type="flowchart",
    )

    assert ir.title == "产线排查流程"
    assert ir.diagram_type == "flowchart"
    assert ir.layout_hint == "top_to_bottom"
    assert [node.id for node in ir.nodes][:3] == ["step-1", "step-2", "step-3"]
    assert any(node.kind == "decision" for node in ir.nodes)
    assert any(edge.relation == "condition" for edge in ir.edges)
    assert "设备报警现象" in ir.metadata["keywords"]


def test_build_keyword_diagram_ir_groups_mindmap_keywords() -> None:
    ir = build_keyword_diagram_ir(
        title="工艺风险整理",
        content="温度窗口需要保持稳定，压力控制异常会触发安全风险，设备夹具需要复核。",
        source_ids=["source-a"],
        diagram_type="mindmap",
    )

    assert ir.diagram_type == "mindmap"
    assert ir.layout_hint == "radial"
    assert ir.nodes[0].kind == "root"
    assert any(node.kind == "category" and node.label == "风险" for node in ir.nodes)
    assert any(node.kind == "keyword" and "温度窗口" in node.label for node in ir.nodes)
    assert "risk" in ir.metadata["categories"]


def test_extract_diagram_keywords_prefers_repeated_domain_terms() -> None:
    keywords = extract_diagram_keywords("夹具状态异常，夹具复位后检查压力，压力异常继续报警。", limit=3)

    assert keywords[0] in {"夹具", "压力", "异常"}
