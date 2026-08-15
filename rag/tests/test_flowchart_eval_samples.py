import json

from app.artifacts import build_llm_diagram_ir
from evals.flowchart_eval_samples import (
    FLOWCHART_EVAL_SAMPLES,
    REQUIRED_FLOWCHART_EVAL_DIMENSIONS,
    build_flowchart_eval_content,
    source_ids_for,
)


def _build_sample_ir(sample):
    def fake_chat(messages, temperature=None, response_format=None):
        assert response_format == {"type": "json_object"}
        assert "flow_semantics" in messages[1]["content"]
        return {
            "model": f"eval-{sample['id']}",
            "content": json.dumps(sample["structured_output"], ensure_ascii=False),
        }

    return build_llm_diagram_ir(
        title=sample["title"],
        content=build_flowchart_eval_content(sample),
        source_ids=source_ids_for(sample),
        diagram_type="flowchart",
        llm_chat=fake_chat,
    )


def test_flowchart_eval_samples_cover_required_dimensions() -> None:
    covered_dimensions = {
        dimension
        for sample in FLOWCHART_EVAL_SAMPLES
        for dimension in sample["dimensions"]
    }
    sample_ids = [sample["id"] for sample in FLOWCHART_EVAL_SAMPLES]

    assert REQUIRED_FLOWCHART_EVAL_DIMENSIONS <= covered_dimensions
    assert len(sample_ids) == len(set(sample_ids))


def test_flowchart_eval_samples_pass_diagram_ir_quality_gates() -> None:
    for sample in FLOWCHART_EVAL_SAMPLES:
        ir = _build_sample_ir(sample)
        expectations = sample["expectations"]
        node_kinds = {node.kind for node in ir.nodes}
        edge_relations = {edge.relation for edge in ir.edges}
        edge_labels = {edge.label for edge in ir.edges if edge.label}

        assert ir.type == "flowchart", sample["id"]
        assert ir.can_generate is expectations["can_generate"], sample["id"]
        assert set(expectations["required_node_kinds"]) <= node_kinds, sample["id"]
        assert set(expectations["required_edge_relations"]) <= edge_relations, sample["id"]
        assert ir.metadata["generation_mode"] == "llm_structured", sample["id"]

        if expectations["can_generate"]:
            assert ir.validation is not None
            assert ir.validation.errors == [], sample["id"]
            assert ir.validation.missing_source_ids == [], sample["id"]
            assert ir.quality_score >= expectations["min_quality_score"], sample["id"]
            assert ir.excalidraw_scene is not None
            assert ir.excalidraw_scene["elements"], sample["id"]
            assert all(node.source_ids for node in ir.nodes), sample["id"]
            assert set(source_ids_for(sample)) <= set(ir.validation.covered_source_ids), sample["id"]
        else:
            assert ir.nodes == [], sample["id"]
            assert ir.edges == [], sample["id"]
            assert ir.metadata["structured_refusal"] is expectations["structured_refusal"]
            assert ir.excalidraw_scene is not None
            assert ir.excalidraw_scene["elements"] == []
            assert "不足" in ir.reason

        if "decision_labels" in expectations:
            assert set(expectations["decision_labels"]) <= edge_labels, sample["id"]
        if "loop_labels" in expectations:
            assert set(expectations["loop_labels"]) <= edge_labels, sample["id"]
        if "lanes" in expectations:
            assert tuple(lane.label for lane in ir.lanes) == expectations["lanes"], sample["id"]
            assert all(node.metadata.get("lane_id") for node in ir.nodes), sample["id"]
