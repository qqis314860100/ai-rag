from __future__ import annotations

from typing import Any

from .diagram_constants import (
    ALLOWED_DIAGRAM_TYPES,
    ALLOWED_EDGE_RELATIONS,
    ALLOWED_NODE_KINDS,
    FLOWCHART_EVIDENCE_NODE_KINDS,
    FLOWCHART_NODE_KINDS,
)
from .diagram_models import DiagramIR, DiagramLayoutSuggestion, DiagramQualityWarning, DiagramValidationResult


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else None
    return None


def _diagram_warning(
    code: str,
    message: str,
    *,
    severity: str = "warning",
    node_ids: list[str] | None = None,
    edge_ids: list[str] | None = None,
    source_ids: list[str] | None = None,
) -> DiagramQualityWarning:
    return DiagramQualityWarning(
        code=code,
        message=message,
        severity=severity,
        node_ids=node_ids or [],
        edge_ids=edge_ids or [],
        source_ids=source_ids or [],
    )


def _layout_suggestion_for(ir: DiagramIR) -> DiagramLayoutSuggestion:
    viewport = ir.metadata.get("viewport") if isinstance(ir.metadata.get("viewport"), dict) else {}
    normalized_viewport = {
        key: int(value)
        for key, value in viewport.items()
        if key in {"width", "height"} and isinstance(value, (int, float))
    }
    if ir.type == "flowchart":
        return DiagramLayoutSuggestion(
            layout_hint=ir.layout_hint or "top_to_bottom",
            direction="top_to_bottom",
            node_spacing=120,
            rank_spacing=168,
            viewport=normalized_viewport,
            notes=["流程图建议保持单主线自上而下布局，decision 节点用于承载判断条件。"],
        )
    if ir.type == "mindmap":
        return DiagramLayoutSuggestion(
            layout_hint=ir.layout_hint or "radial",
            direction="radial",
            node_spacing=150,
            rank_spacing=220,
            viewport=normalized_viewport,
            notes=["思维导图建议只展示主题、分类和关键词节点，引用证据保留在元数据中。"],
        )
    return DiagramLayoutSuggestion(
        layout_hint=ir.layout_hint or "auto",
        direction="auto",
        viewport=normalized_viewport,
        notes=["未知图解类型建议前端按通用有向图兜底渲染。"],
    )


def validate_diagram_ir(ir: DiagramIR, required_source_ids: list[str] | None = None) -> DiagramValidationResult:
    required_sources = set(required_source_ids or [])
    if not required_sources:
        required_sources = {
            str(item.get("source_id"))
            for item in ir.source_evidence
            if isinstance(item, dict) and str(item.get("source_id") or "").strip()
        }

    warnings: list[DiagramQualityWarning] = []
    errors: list[DiagramQualityWarning] = []
    node_ids: set[str] = set()
    duplicate_node_ids: set[str] = set()
    covered_sources: set[str] = set()
    business_nodes_without_evidence: list[str] = []
    lane_ids: set[str] = set()
    duplicate_lane_ids: set[str] = set()
    for lane in ir.lanes:
        lane_id = lane.id.strip()
        if not lane_id:
            errors.append(_diagram_warning("blank_lane_id", "泳道 id 不能为空。", severity="error"))
            continue
        if lane_id in lane_ids:
            duplicate_lane_ids.add(lane_id)
        lane_ids.add(lane_id)
        if not lane.label.strip():
            errors.append(_diagram_warning("blank_lane_label", "泳道 label 不能为空。", severity="error"))

    if duplicate_lane_ids:
        errors.append(_diagram_warning(
            "duplicate_lane_id",
            "泳道 id 必须唯一。",
            severity="error",
        ))

    for node in ir.nodes:
        node_id = node.id.strip()
        if not node_id:
            errors.append(_diagram_warning("blank_node_id", "节点 id 不能为空。", severity="error"))
            continue
        if node_id in node_ids:
            duplicate_node_ids.add(node_id)
        node_ids.add(node_id)
        if not node.label.strip():
            errors.append(_diagram_warning("blank_node_label", "节点 label 不能为空。", severity="error", node_ids=[node.id]))
        if node.kind not in ALLOWED_NODE_KINDS:
            warnings.append(_diagram_warning("unknown_node_kind", "未知节点类型会触发默认样式兜底。", node_ids=[node.id]))
        covered_sources.update(source_id for source_id in node.source_ids if source_id)
        if (
            ir.type == "flowchart"
            and required_sources
            and node.kind in FLOWCHART_EVIDENCE_NODE_KINDS
            and not (set(node.source_ids) & required_sources)
        ):
            business_nodes_without_evidence.append(node.id)
        if ir.type == "flowchart" and lane_ids and node.kind in FLOWCHART_NODE_KINDS:
            lane_id = str(node.metadata.get("lane_id") or "").strip()
            if not lane_id:
                errors.append(_diagram_warning(
                    "flowchart_node_missing_lane",
                    "带泳道的流程图中，每个业务节点必须声明 metadata.lane_id。",
                    severity="error",
                    node_ids=[node.id],
                ))
            elif lane_id not in lane_ids:
                errors.append(_diagram_warning(
                    "flowchart_node_unknown_lane",
                    "节点 metadata.lane_id 必须引用已声明的泳道。",
                    severity="error",
                    node_ids=[node.id],
                ))

    if duplicate_node_ids:
        errors.append(_diagram_warning(
            "duplicate_node_id",
            "节点 id 必须唯一。",
            severity="error",
            node_ids=sorted(duplicate_node_ids),
        ))

    seen_edges: set[tuple[str, str, str]] = set()
    duplicate_edges: set[str] = set()
    outgoing_edges: dict[str, list[tuple[Any, str]]] = {}
    loop_edges_without_label: list[str] = []
    for index, edge in enumerate(ir.edges):
        edge_id = f"{edge.source}->{edge.target}:{edge.relation}:{index}"
        if not edge.source.strip() or not edge.target.strip():
            errors.append(_diagram_warning("blank_edge_endpoint", "连线端点不能为空。", severity="error", edge_ids=[edge_id]))
            continue
        missing = [node_id for node_id in (edge.source, edge.target) if node_id not in node_ids]
        if missing:
            errors.append(_diagram_warning(
                "edge_endpoint_missing",
                "连线端点必须引用已存在的节点。",
                severity="error",
                edge_ids=[edge_id],
                node_ids=missing,
            ))
        if edge.source == edge.target:
            warnings.append(_diagram_warning("self_edge", "连线不应指向自身。", edge_ids=[edge_id], node_ids=[edge.source]))
        if edge.relation not in ALLOWED_EDGE_RELATIONS:
            warnings.append(_diagram_warning("unknown_edge_relation", "未知连线关系会触发默认连线样式兜底。", edge_ids=[edge_id]))
        outgoing_edges.setdefault(edge.source, []).append((edge, edge_id))
        if ir.type == "flowchart" and edge.relation == "loop" and not edge.label.strip():
            loop_edges_without_label.append(edge_id)
        edge_key = (edge.source, edge.target, edge.relation)
        if edge_key in seen_edges:
            duplicate_edges.add(edge_id)
        seen_edges.add(edge_key)

    if duplicate_edges:
        warnings.append(_diagram_warning("duplicate_edge", "存在重复连线，建议生成前去重。", edge_ids=sorted(duplicate_edges)))
    if not ir.nodes:
        errors.append(_diagram_warning("empty_nodes", "图解至少需要一个节点。", severity="error"))
    if ir.type not in ALLOWED_DIAGRAM_TYPES:
        warnings.append(_diagram_warning("unknown_diagram_type", "未知图解类型会触发前端通用图兜底渲染。"))
    if ir.type == "flowchart" and len(ir.nodes) > 1 and not ir.edges:
        warnings.append(_diagram_warning("flowchart_without_edges", "流程图有多个节点但没有连线，流程关系不完整。"))
    if ir.type == "mindmap" and not any(node.kind == "root" for node in ir.nodes):
        warnings.append(_diagram_warning("mindmap_without_root", "思维导图缺少 root 节点，布局稳定性会下降。"))
    if ir.type == "flowchart":
        if len(ir.lanes) == 1:
            warnings.append(_diagram_warning("single_swimlane", "只有一个泳道时可退化为普通流程图。"))
        decision_branch_errors: list[str] = []
        decision_branch_edge_ids: list[str] = []
        for node in ir.nodes:
            if node.kind != "decision":
                continue
            branches = outgoing_edges.get(node.id, [])
            labeled_branches = [(edge, edge_id) for edge, edge_id in branches if edge.label.strip()]
            if len(labeled_branches) < 2:
                decision_branch_errors.append(node.id)
                decision_branch_edge_ids.extend(edge_id for _edge, edge_id in branches)
        if decision_branch_errors:
            warnings.append(_diagram_warning(
                "decision_branch_outgoing_required",
                "decision 节点建议至少有两条带标签出边；单分支时仍可展示，但需要在后续提炼中补齐是/否或异常/正常路径。",
                severity="warning",
                node_ids=decision_branch_errors,
                edge_ids=decision_branch_edge_ids,
            ))
        if loop_edges_without_label:
            errors.append(_diagram_warning(
                "loop_edge_missing_label",
                "loop 连线必须显式标注回流、返工、重试或复检条件。",
                severity="error",
                edge_ids=loop_edges_without_label,
            ))
        if business_nodes_without_evidence:
            errors.append(_diagram_warning(
                "business_node_missing_source",
                "流程图业务节点必须绑定至少一条可用来源证据 source_id。",
                severity="error",
                node_ids=business_nodes_without_evidence,
            ))
        requested_node_limit = _positive_int(ir.metadata.get("requested_node_limit"))
        original_node_count = _positive_int(ir.metadata.get("original_node_count"))
        if requested_node_limit and (len(ir.nodes) > requested_node_limit or (original_node_count or 0) > requested_node_limit):
            severity = "error" if len(ir.nodes) > requested_node_limit else "warning"
            target = errors if severity == "error" else warnings
            target.append(_diagram_warning(
                "flowchart_node_limit_exceeded",
                "流程图节点数量超过上限，建议拆分为子流程或 subflow 后再生成。",
                severity=severity,
            ))

    covered_required_sources = covered_sources & required_sources if required_sources else covered_sources
    missing_sources = sorted(required_sources - covered_sources)
    citation_coverage_ratio = 1.0 if not required_sources else round(len(covered_required_sources) / len(required_sources), 2)
    if missing_sources:
        warnings.append(_diagram_warning(
            "missing_source_coverage",
            "部分引用未覆盖到图解节点，质量门槛应谨慎放行。",
            source_ids=missing_sources,
        ))

    severity_penalty = {"critical": 0.4, "error": 0.35, "warning": 0.1, "info": 0.04}
    penalty = sum(severity_penalty.get(item.severity, 0.1) for item in errors + warnings)
    structure_bonus = 0.12 if ir.nodes and (ir.type == "mindmap" or ir.edges) else 0.0
    coverage_bonus = 0.12 if required_sources and not missing_sources else 0.0
    quality_score = round(max(0.0, min(1.0, 0.72 + structure_bonus + coverage_bonus - penalty)), 2)
    can_generate = not errors and quality_score >= 0.45

    return DiagramValidationResult(
        can_generate=can_generate,
        quality_score=quality_score,
        warnings=warnings,
        errors=errors,
        layout_suggestion=_layout_suggestion_for(ir),
        required_source_ids=sorted(required_sources),
        covered_source_ids=sorted(covered_required_sources),
        missing_source_ids=missing_sources,
        citation_coverage_ratio=citation_coverage_ratio,
        node_count=len(ir.nodes),
        edge_count=len(ir.edges),
    )
