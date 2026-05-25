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
    assert ir.excalidraw_scene["metadata"]["diagram_type"] == "flowchart"
    assert any(element["type"] == "arrow" for element in ir.excalidraw_scene["elements"])
    assert any(element["type"] == "text" and element["containerId"] == "node-step-1" for element in ir.excalidraw_scene["elements"])
    assert ir.metadata["artifact_payload"]["renderer"] == "excalidraw"
    assert ir.metadata["artifact_payload"]["element_count"] == len(ir.excalidraw_scene["elements"])
    assert all("layout" in node.metadata for node in ir.nodes)
    assert all("render" in node.metadata for node in ir.nodes)
    assert all("render" in edge.metadata for edge in ir.edges)


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

    assert ir.diagram_type == "mindmap"
    assert ir.layout_hint == "radial"
    assert ir.nodes[0].kind == "root"
    assert any(node.kind == "category" and node.label == "风险" for node in ir.nodes)
    assert any(node.kind == "keyword" and "温度窗口" in node.label for node in ir.nodes)
    assert any(node.kind == "evidence" and "安全注意事项" in node.label for node in ir.nodes)
    assert any(edge.relation == "supported_by" for edge in ir.edges)
    assert "risk" in ir.metadata["categories"]
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


def test_extract_diagram_keywords_prefers_repeated_domain_terms() -> None:
    keywords = extract_diagram_keywords("夹具状态异常，夹具复位后检查压力，压力异常继续报警。", limit=3)

    assert keywords[0] in {"夹具", "压力", "异常"}
