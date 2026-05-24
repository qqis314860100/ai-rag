from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DiagramNode(BaseModel):
    id: str
    label: str
    kind: str = "topic"
    description: str = ""
    source_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DiagramEdge(BaseModel):
    source: str
    target: str
    relation: str = "flows_to"
    label: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class DiagramIR(BaseModel):
    title: str
    objective: str = ""
    diagram_type: str = "graph"
    layout_hint: str = "auto"
    nodes: list[DiagramNode] = Field(default_factory=list)
    edges: list[DiagramEdge] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


def build_placeholder_diagram_ir(
    title: str,
    steps: list[str],
    source_ids: list[str] | None = None,
    diagram_type: str = "flowchart",
) -> DiagramIR:
    source_ids = source_ids or []
    nodes: list[DiagramNode] = []
    edges: list[DiagramEdge] = []

    previous_id = ""
    for index, step in enumerate(steps, 1):
        node_id = f"step-{index}"
        nodes.append(
            DiagramNode(
                id=node_id,
                label=step,
                kind="step",
                source_ids=source_ids,
            )
        )
        if previous_id:
            edges.append(
                DiagramEdge(
                    source=previous_id,
                    target=node_id,
                    relation="sequence",
                )
            )
        previous_id = node_id

    return DiagramIR(
        title=title,
        objective="结构化中间表示，供后续渲染为思维导图或流程图。",
        diagram_type=diagram_type,
        layout_hint="top_to_bottom",
        nodes=nodes,
        edges=edges,
        notes=[
            "先输出结构化 IR，再决定前端图库。",
            "布局和样式由消费端选择，不在这里绑定。",
        ],
        metadata={
            "source_count": len(source_ids),
            "step_count": len(steps),
        },
    )
