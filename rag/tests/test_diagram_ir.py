from app.evaluation import build_placeholder_diagram_ir


def test_build_placeholder_diagram_ir_keeps_structure() -> None:
    ir = build_placeholder_diagram_ir(
        title="产线排查流程",
        steps=["确认现象", "定位设备", "验证恢复"],
        source_ids=["source-a", "source-b"],
    )

    assert ir.title == "产线排查流程"
    assert ir.diagram_type == "flowchart"
    assert ir.layout_hint == "top_to_bottom"
    assert [node.id for node in ir.nodes] == ["step-1", "step-2", "step-3"]
    assert [edge.relation for edge in ir.edges] == ["sequence", "sequence"]
    assert ir.metadata["step_count"] == 3
