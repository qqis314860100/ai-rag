from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import AliasChoices, BaseModel, Field


class DiagramQualityWarning(BaseModel):
    code: str
    message: str
    severity: str = "warning"
    node_ids: list[str] = Field(default_factory=list)
    edge_ids: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)


class DiagramLayoutSuggestion(BaseModel):
    layout_hint: str = "auto"
    direction: str = "auto"
    node_spacing: int = 140
    rank_spacing: int = 168
    viewport: dict[str, int] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


class DiagramValidationResult(BaseModel):
    can_generate: bool = True
    quality_score: float = Field(default=0.0, ge=0.0, le=1.0)
    warnings: list[DiagramQualityWarning] = Field(default_factory=list)
    errors: list[DiagramQualityWarning] = Field(default_factory=list)
    layout_suggestion: DiagramLayoutSuggestion = Field(default_factory=DiagramLayoutSuggestion)
    required_source_ids: list[str] = Field(default_factory=list)
    covered_source_ids: list[str] = Field(default_factory=list)
    missing_source_ids: list[str] = Field(default_factory=list)
    citation_coverage_ratio: float = Field(default=1.0, ge=0.0, le=1.0)
    node_count: int = 0
    edge_count: int = 0


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


class DiagramLane(BaseModel):
    id: str
    label: str
    order: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class DiagramIR(BaseModel):
    schema_version: str = "diagram-ir/v2"
    title: str
    objective: str = ""
    type: str = Field(default="graph", validation_alias=AliasChoices("type", "diagram_type"))
    layout_hint: str = "auto"
    can_generate: bool = True
    nodes: list[DiagramNode] = Field(default_factory=list)
    edges: list[DiagramEdge] = Field(default_factory=list)
    lanes: list[DiagramLane] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    renderer: str = "diagram-ir"
    reason: str = ""
    confidence: float = 0.0
    quality_score: float = Field(default=0.0, ge=0.0, le=1.0)
    quality_warnings: list[DiagramQualityWarning] = Field(default_factory=list)
    validation: DiagramValidationResult | None = None
    source_evidence: list[dict[str, Any]] = Field(default_factory=list)
    excalidraw_scene: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @property
    def diagram_type(self) -> str:
        return self.type


class StructuredDiagramNode(BaseModel):
    id: str = ""
    label: str
    kind: str = "topic"
    description: str = ""
    source_ids: list[str] = Field(default_factory=list)
    lane_id: str = ""
    lane_label: str = ""


class StructuredDiagramEdge(BaseModel):
    source: str
    target: str
    relation: str = "relates_to"
    label: str = ""


class StructuredDiagramLane(BaseModel):
    id: str = ""
    label: str


class StructuredFlowSemantics(BaseModel):
    roles: list[str] = Field(default_factory=list)
    actions: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    branches: list[str] = Field(default_factory=list)
    loops: list[str] = Field(default_factory=list)
    final_results: list[str] = Field(default_factory=list)


class StructuredDiagramOutput(BaseModel):
    title: str = ""
    objective: str = ""
    type: str = Field(default="mindmap", validation_alias=AliasChoices("type", "diagram_type"))
    layout_hint: str = "auto"
    can_generate: bool = True
    reason: str = ""
    flow_semantics: StructuredFlowSemantics = Field(default_factory=StructuredFlowSemantics)
    lanes: list[StructuredDiagramLane] = Field(default_factory=list)
    nodes: list[StructuredDiagramNode] = Field(default_factory=list)
    edges: list[StructuredDiagramEdge] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    @property
    def diagram_type(self) -> str:
        return self.type


StructuredDiagramChat = Callable[..., dict[str, Any]]
