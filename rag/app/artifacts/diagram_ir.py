from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from typing import Any

from pydantic import ValidationError

from .diagram_constants import (
    ALLOWED_EDGE_RELATIONS,
    ALLOWED_NODE_KINDS,
    FLOWCHART_NODE_KINDS,
    STRUCTURED_OUTPUT_FORMAT,
)
from .diagram_extraction import (
    ACTION_PATTERN as _ACTION_PATTERN,
)
from .diagram_extraction import (
    CATEGORY_ORDER as _CATEGORY_ORDER,
)
from .diagram_extraction import (
    DECISION_PATTERN as _DECISION_PATTERN,
)
from .diagram_extraction import (
    MAX_KEYWORDS_PER_CATEGORY as _MAX_KEYWORDS_PER_CATEGORY,
)
from .diagram_extraction import (
    MAX_MINDMAP_CATEGORIES as _MAX_MINDMAP_CATEGORIES,
)
from .diagram_extraction import (
    category_for_keyword as _category_for_keyword,
)
from .diagram_extraction import (
    clean_text as _clean_text,
)
from .diagram_extraction import (
    extract_diagram_steps,
)
from .diagram_extraction import (
    extract_weighted_keywords as _extract_weighted_keywords,
)
from .diagram_extraction import (
    step_kind as _step_kind,
)
from .diagram_extraction import extract_evidence_blocks as _extract_evidence_blocks
from .diagram_models import (
    DiagramEdge,
    DiagramIR,
    DiagramLane,
    DiagramNode,
    StructuredDiagramChat,
    StructuredDiagramNode,
    StructuredDiagramOutput,
    StructuredFlowSemantics,
)
from .diagram_validation import validate_diagram_ir


def _children_by_source(edges: list[DiagramEdge]) -> dict[str, list[str]]:
    children: dict[str, list[str]] = {}
    for edge in edges:
        children.setdefault(edge.source, []).append(edge.target)
    return children


def _node_by_id(nodes: list[DiagramNode]) -> dict[str, DiagramNode]:
    return {node.id: node for node in nodes}


_NODE_RENDER_STYLES: dict[str, dict[str, Any]] = {
    "root": {
        "shape": "rounded",
        "fill": "#EEF2FF",
        "stroke": "#4F46E5",
        "text": "#3730A3",
        "radius": 18,
        "fontSize": 15,
        "fontWeight": 700,
        "labelMaxLength": 18,
        "maxLines": 2,
    },
    "category": {
        "shape": "rounded",
        "fill": "#FFFFFF",
        "stroke": "#818CF8",
        "text": "#1F2937",
        "radius": 14,
        "fontSize": 13,
        "fontWeight": 700,
        "labelMaxLength": 16,
        "maxLines": 2,
    },
    "equipment": {
        "shape": "rounded",
        "fill": "#F8FAFC",
        "stroke": "#64748B",
        "text": "#334155",
        "radius": 14,
        "fontSize": 12,
        "fontWeight": 600,
        "labelMaxLength": 18,
        "maxLines": 2,
    },
    "step": {
        "shape": "rounded",
        "fill": "#F0FDF4",
        "stroke": "#22C55E",
        "text": "#166534",
        "radius": 14,
        "fontSize": 12,
        "fontWeight": 600,
        "labelMaxLength": 20,
        "maxLines": 2,
    },
    "start": {
        "shape": "rounded",
        "fill": "#ECFDF5",
        "stroke": "#059669",
        "text": "#065F46",
        "radius": 24,
        "fontSize": 12,
        "fontWeight": 700,
        "labelMaxLength": 18,
        "maxLines": 2,
    },
    "end": {
        "shape": "rounded",
        "fill": "#F8FAFC",
        "stroke": "#475569",
        "text": "#334155",
        "radius": 24,
        "fontSize": 12,
        "fontWeight": 700,
        "labelMaxLength": 18,
        "maxLines": 2,
    },
    "input": {
        "shape": "rounded",
        "fill": "#EFF6FF",
        "stroke": "#2563EB",
        "text": "#1E3A8A",
        "radius": 12,
        "fontSize": 12,
        "fontWeight": 600,
        "labelMaxLength": 20,
        "maxLines": 2,
    },
    "output": {
        "shape": "rounded",
        "fill": "#F5F3FF",
        "stroke": "#7C3AED",
        "text": "#5B21B6",
        "radius": 12,
        "fontSize": 12,
        "fontWeight": 600,
        "labelMaxLength": 20,
        "maxLines": 2,
    },
    "parameter": {
        "shape": "rounded",
        "fill": "#ECFEFF",
        "stroke": "#06B6D4",
        "text": "#155E75",
        "radius": 14,
        "fontSize": 12,
        "fontWeight": 600,
        "labelMaxLength": 18,
        "maxLines": 2,
    },
    "risk": {
        "shape": "rounded",
        "fill": "#FFF7ED",
        "stroke": "#F97316",
        "text": "#9A3412",
        "radius": 14,
        "fontSize": 12,
        "fontWeight": 700,
        "labelMaxLength": 18,
        "maxLines": 2,
    },
    "action": {
        "shape": "rounded",
        "fill": "#F0FDF4",
        "stroke": "#16A34A",
        "text": "#166534",
        "radius": 14,
        "fontSize": 12,
        "fontWeight": 700,
        "labelMaxLength": 20,
        "maxLines": 2,
    },
    "decision": {
        "shape": "diamond",
        "fill": "#FFFBEB",
        "stroke": "#D97706",
        "text": "#92400E",
        "radius": 0,
        "fontSize": 12,
        "fontWeight": 700,
        "labelMaxLength": 18,
        "maxLines": 2,
    },
    "subflow": {
        "shape": "rounded",
        "fill": "#F0FDFA",
        "stroke": "#0D9488",
        "text": "#115E59",
        "radius": 10,
        "fontSize": 12,
        "fontWeight": 700,
        "labelMaxLength": 20,
        "maxLines": 2,
    },
    "evidence": {
        "shape": "rounded",
        "fill": "#F8FAFC",
        "stroke": "#CBD5E1",
        "text": "#64748B",
        "radius": 10,
        "fontSize": 10,
        "fontWeight": 500,
        "labelMaxLength": 16,
        "maxLines": 2,
    },
    "keyword": {
        "shape": "rounded",
        "fill": "#FFFFFF",
        "stroke": "#CBD5E1",
        "text": "#334155",
        "radius": 14,
        "fontSize": 12,
        "fontWeight": 600,
        "labelMaxLength": 18,
        "maxLines": 2,
    },
}

_EDGE_RENDER_STYLES: dict[str, dict[str, Any]] = {
    "contains": {"stroke": "#94A3B8", "strokeWidth": 1.8, "curve": "horizontal", "arrow": False},
    "supported_by": {"stroke": "#CBD5E1", "strokeWidth": 1.2, "strokeDasharray": "5 6", "curve": "horizontal", "arrow": False},
    "sequence": {"stroke": "#64748B", "strokeWidth": 2.0, "curve": "vertical", "arrow": True},
    "condition": {"stroke": "#D97706", "strokeWidth": 1.8, "curve": "vertical", "arrow": True},
    "loop": {"stroke": "#2563EB", "strokeWidth": 1.8, "strokeDasharray": "4 5", "curve": "vertical", "arrow": True},
    "fallback": {"stroke": "#DC2626", "strokeWidth": 1.8, "strokeDasharray": "6 5", "curve": "vertical", "arrow": True},
    "flows_to": {"stroke": "#64748B", "strokeWidth": 2.0, "curve": "vertical", "arrow": True},
    "relates_to": {"stroke": "#94A3B8", "strokeWidth": 1.4, "curve": "vertical", "arrow": True},
}


def _render_style(tone: str) -> dict[str, Any]:
    return dict(_NODE_RENDER_STYLES.get(tone) or _NODE_RENDER_STYLES["keyword"])


def _set_layout(node: DiagramNode, x: int, y: int, width: int, height: int, tone: str = "") -> None:
    resolved_tone = tone or node.metadata.get("category") or node.kind
    node.metadata["layout"] = {"x": x, "y": y, "width": width, "height": height}
    node.metadata["tone"] = resolved_tone
    node.metadata["render"] = _render_style(str(resolved_tone))


def _apply_edge_render(edges: list[DiagramEdge]) -> None:
    for edge in edges:
        edge.metadata["render"] = dict(_EDGE_RENDER_STYLES.get(edge.relation) or _EDGE_RENDER_STYLES["contains"])


def _dedupe_edges(edges: list[DiagramEdge]) -> list[DiagramEdge]:
    result: list[DiagramEdge] = []
    seen: set[tuple[str, str, str]] = set()
    for edge in edges:
        if not edge.source or not edge.target or edge.source == edge.target:
            continue
        key = (edge.source, edge.target, edge.relation)
        if key in seen:
            continue
        seen.add(key)
        result.append(edge)
    return result


def _normalize_mindmap_edges(ir: DiagramIR, root: DiagramNode, children: dict[str, list[str]]) -> None:
    nodes = _node_by_id(ir.nodes)
    categories = [node for node in ir.nodes if node.kind == "category"]
    category_ids = {node.id for node in categories}
    rebuilt: list[DiagramEdge] = []
    connected: set[str] = {root.id}

    if categories:
        for category in categories:
            rebuilt.append(DiagramEdge(source=root.id, target=category.id, relation="contains", metadata={"normalized_by": "mindmap_hierarchy"}))
            connected.add(category.id)

            for target_id in children.get(category.id, []):
                target = nodes.get(target_id)
                if not target or target.kind in {"root", "category"}:
                    continue
                rebuilt.append(DiagramEdge(source=category.id, target=target.id, relation="contains", metadata={"normalized_by": "mindmap_hierarchy"}))
                connected.add(target.id)

        # 没有明确分类归属的节点只作为一级节点，避免同层串线和反向箭头。
        for node in ir.nodes:
            if node.id not in connected and node.kind != "evidence":
                rebuilt.append(DiagramEdge(source=root.id, target=node.id, relation="contains", metadata={"normalized_by": "mindmap_hierarchy", "fallback_parent": True}))
                connected.add(node.id)
    else:
        for node in ir.nodes:
            if node.id != root.id and node.kind != "evidence":
                rebuilt.append(DiagramEdge(source=root.id, target=node.id, relation="contains", metadata={"normalized_by": "mindmap_hierarchy"}))
                connected.add(node.id)

    for edge in ir.edges:
        source = nodes.get(edge.source)
        target = nodes.get(edge.target)
        if not source or not target or target.kind != "evidence":
            continue
        parent = source.id if source.kind != "root" else (next(iter(category_ids), root.id))
        rebuilt.append(DiagramEdge(source=parent, target=target.id, relation="supported_by", metadata={"normalized_by": "mindmap_hierarchy"}))
        connected.add(target.id)

    ir.edges = _dedupe_edges(rebuilt)


def _apply_mindmap_layout(ir: DiagramIR) -> DiagramIR:
    nodes = _node_by_id(ir.nodes)
    children = _children_by_source(ir.edges)
    root = next((node for node in ir.nodes if node.kind == "root"), ir.nodes[0] if ir.nodes else None)
    if not root:
        return ir

    _normalize_mindmap_edges(ir, root, children)
    children = _children_by_source(ir.edges)

    categories = [nodes[node_id] for node_id in children.get(root.id, []) if node_id in nodes]
    category_blocks: list[tuple[DiagramNode, list[str], int, int]] = []
    for index, category in enumerate(categories):
        keyword_ids = [
            node_id
            for node_id in children.get(category.id, [])
            if nodes.get(node_id) and nodes[node_id].kind != "evidence"
        ]
        block_height = max(118, len(keyword_ids) * 56 + 34)
        side = 1 if index % 2 == 0 else -1
        category_blocks.append((category, keyword_ids, block_height, side))

    left_height = sum(block_height for _, _, block_height, side in category_blocks if side < 0)
    right_height = sum(block_height for _, _, block_height, side in category_blocks if side > 0)
    viewport_height = max(620, max(left_height, right_height) + 180)
    viewport_width = 1280
    center_x = viewport_width // 2
    center_y = viewport_height // 2
    _set_layout(root, center_x - 110, center_y - 34, 220, 68, "root")

    cursors = {
        1: max(70, (viewport_height - right_height) // 2),
        -1: max(70, (viewport_height - left_height) // 2),
    }
    for category, keyword_ids, block_height, side in category_blocks:
        y = cursors[side] + block_height // 2
        cursors[side] += block_height
        branch_distance = 285 + min(180, int(abs(y - center_y) * 0.22))
        category_x = center_x + side * branch_distance
        _set_layout(category, category_x - 100, y - 27, 200, 54, "category")

        for keyword_index, keyword_id in enumerate(keyword_ids):
            keyword = nodes[keyword_id]
            keyword_y = y + (keyword_index - (len(keyword_ids) - 1) / 2) * 56
            keyword_x = category_x + side * 220
            _set_layout(keyword, int(keyword_x - 86), int(keyword_y - 22), 172, 44, keyword.metadata.get("category", "keyword"))

            evidence_ids = [node_id for node_id in children.get(keyword.id, []) if nodes.get(node_id) and nodes[node_id].kind == "evidence"]
            for evidence_index, evidence_id in enumerate(evidence_ids[:2]):
                evidence = nodes[evidence_id]
                evidence_x = keyword_x + side * 150
                evidence_y = keyword_y + (evidence_index * 30) - 15
                _set_layout(evidence, int(evidence_x - 46), int(evidence_y - 14), 92, 28, "evidence")

    _apply_edge_render(ir.edges)
    ir.metadata["viewport"] = {"width": viewport_width, "height": viewport_height}
    ir.metadata["renderer"] = "positioned-svg"
    return ir


def _apply_flowchart_layout(ir: DiagramIR) -> DiagramIR:
    flow_nodes = [node for node in ir.nodes if node.kind in FLOWCHART_NODE_KINDS]
    lane_ids = {lane.id for lane in ir.lanes}
    has_lanes = len(lane_ids) >= 2
    viewport_width = max(980, len(ir.lanes) * 360 + 160) if has_lanes else 980
    viewport_height = max(620, len(flow_nodes) * 168 + 140)
    center_x = viewport_width // 2
    lane_width = 360
    lane_left = max(80, (viewport_width - len(ir.lanes) * lane_width) // 2) if has_lanes else 0
    lane_center_by_id = {
        lane.id: lane_left + lane.order * lane_width + lane_width // 2
        for lane in ir.lanes
    }

    for index, node in enumerate(flow_nodes):
        y = 86 + index * 168
        node_center_x = lane_center_by_id.get(str(node.metadata.get("lane_id")), center_x)
        if node.kind == "decision":
            _set_layout(node, node_center_x - 150, y - 58, 300, 116, "decision")
        elif node.kind in {"start", "end"}:
            _set_layout(node, node_center_x - 140, y - 34, 280, 68, node.kind)
        elif node.kind in {"input", "output", "subflow"}:
            _set_layout(node, node_center_x - 160, y - 38, 320, 76, node.kind)
        elif node.kind == "action":
            _set_layout(node, node_center_x - 160, y - 38, 320, 76, "action")
        else:
            _set_layout(node, node_center_x - 160, y - 38, 320, 76, "step")

    _apply_edge_render(ir.edges)
    ir.metadata["viewport"] = {"width": viewport_width, "height": viewport_height}
    ir.metadata["renderer"] = "positioned-svg"
    ir.metadata["lanes"] = [lane.model_dump() for lane in ir.lanes]
    ir.metadata["layout_rule"] = "swimlane_flowchart_by_role" if has_lanes else "top_down_process_rectangles_decision_diamonds"
    return ir


def _stable_int(value: str, minimum: int = 1, maximum: int = 2_000_000_000) -> int:
    digest = hashlib.sha1(value.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % (maximum - minimum) + minimum


def _node_layout(node: DiagramNode, index: int) -> dict[str, int]:
    layout = node.metadata.get("layout")
    if isinstance(layout, dict):
        return {
            "x": int(layout.get("x", 80 + index * 30)),
            "y": int(layout.get("y", 80 + index * 30)),
            "width": int(layout.get("width", 160)),
            "height": int(layout.get("height", 56)),
        }
    return {"x": 80 + index * 30, "y": 80 + index * 30, "width": 160, "height": 56}


def _element_base(element_id: str, element_type: str, x: float, y: float, width: float, height: float) -> dict[str, Any]:
    return {
        "id": element_id,
        "type": element_type,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "angle": 0,
        "strokeColor": "#334155",
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 1,
        "strokeStyle": "solid",
        "roughness": 0,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": None,
        "seed": _stable_int(element_id),
        "version": 1,
        "versionNonce": _stable_int(f"{element_id}:nonce"),
        "isDeleted": False,
        "boundElements": None,
        "updated": 1,
        "link": None,
        "locked": True,
    }


def _excalidraw_node_elements(node: DiagramNode, index: int) -> list[dict[str, Any]]:
    layout = _node_layout(node, index)
    render = node.metadata.get("render") if isinstance(node.metadata.get("render"), dict) else {}
    shape = str(render.get("shape") or "rounded")
    element_type = "diamond" if shape == "diamond" else "rectangle"
    node_element_id = f"node-{node.id}"
    text_element_id = f"text-{node.id}"

    node_element = _element_base(
        node_element_id,
        element_type,
        layout["x"],
        layout["y"],
        layout["width"],
        layout["height"],
    )
    node_element.update(
        {
            "strokeColor": render.get("stroke", "#64748B"),
            "backgroundColor": render.get("fill", "#FFFFFF"),
            "strokeWidth": 2,
            "roundness": None if element_type == "diamond" else {"type": 3, "value": int(render.get("radius", 12))},
            "boundElements": [{"type": "text", "id": text_element_id}],
            "customData": {
                "diagram_node_id": node.id,
                "kind": node.kind,
                "source_ids": node.source_ids,
                "description": node.description,
            },
        }
    )

    text_element = _element_base(
        text_element_id,
        "text",
        layout["x"] + 8,
        layout["y"] + 6,
        max(layout["width"] - 16, 40),
        max(layout["height"] - 12, 24),
    )
    text_element.update(
        {
            "strokeColor": render.get("text", "#1F2937"),
            "backgroundColor": "transparent",
            "strokeWidth": 0,
            "fontSize": int(render.get("fontSize", 12)),
            "fontFamily": 5,
            "text": node.label,
            "rawText": node.label,
            "originalText": node.label,
            "textAlign": "center",
            "verticalAlign": "middle",
            "containerId": node_element_id,
            "lineHeight": 1.25,
            "boundElements": [],
            "customData": {"diagram_node_id": node.id, "kind": node.kind},
        }
    )
    return [node_element, text_element]


def _layout_center(layout: dict[str, int]) -> tuple[float, float]:
    return layout["x"] + layout["width"] / 2, layout["y"] + layout["height"] / 2


def _edge_anchor(layout: dict[str, int], toward: tuple[float, float], gap: int = 14) -> tuple[float, float]:
    center_x, center_y = _layout_center(layout)
    dx = toward[0] - center_x
    dy = toward[1] - center_y
    if dx == 0 and dy == 0:
        return center_x, center_y

    half_width = layout["width"] / 2
    half_height = layout["height"] / 2
    scale = min(
        half_width / abs(dx) if dx else float("inf"),
        half_height / abs(dy) if dy else float("inf"),
    )
    edge_x = center_x + dx * scale
    edge_y = center_y + dy * scale
    length = max((dx * dx + dy * dy) ** 0.5, 1)
    return edge_x + dx / length * gap, edge_y + dy / length * gap


def _side_anchor(layout: dict[str, int], side: str, gap: int = 14) -> tuple[float, float]:
    center_x, center_y = _layout_center(layout)
    direction = 1 if side == "right" else -1
    return center_x + direction * (layout["width"] / 2 + gap), center_y


def _edge_points(
    source: DiagramNode,
    target: DiagramNode,
    source_index: int,
    target_index: int,
    curve: str = "",
) -> tuple[float, float, float, float, list[list[float]]]:
    source_layout = _node_layout(source, source_index)
    target_layout = _node_layout(target, target_index)
    source_center = _layout_center(source_layout)
    target_center = _layout_center(target_layout)
    if curve == "horizontal":
        target_on_right = target_center[0] >= source_center[0]
        start_x, start_y = _side_anchor(source_layout, "right" if target_on_right else "left", 12)
        end_x, end_y = _side_anchor(target_layout, "left" if target_on_right else "right", 12)
        width = end_x - start_x
        height = end_y - start_y
        # 思维导图只表达父子归属，使用独立侧边连线，避免形成总线或流程感。
        return start_x, start_y, end_x, end_y, [[0, 0], [width, height]]

    start_x, start_y = _edge_anchor(source_layout, target_center)
    end_x, end_y = _edge_anchor(target_layout, source_center)
    return start_x, start_y, end_x, end_y, [[0, 0], [end_x - start_x, end_y - start_y]]


def _excalidraw_edge_element(
    edge: DiagramEdge,
    source: DiagramNode,
    target: DiagramNode,
    source_index: int,
    target_index: int,
    index: int,
) -> dict[str, Any]:
    element_id = f"edge-{edge.source}-{edge.target}-{index}"
    render = edge.metadata.get("render") if isinstance(edge.metadata.get("render"), dict) else {}
    start_x, start_y, end_x, end_y, points = _edge_points(
        source,
        target,
        source_index,
        target_index,
        str(render.get("curve") or ""),
    )
    element = _element_base(element_id, "arrow", start_x, start_y, end_x - start_x, end_y - start_y)
    element.update(
        {
            "strokeColor": render.get("stroke", "#64748B"),
            "strokeWidth": int(float(render.get("strokeWidth", 2))),
            "strokeStyle": "dashed" if render.get("strokeDasharray") else "solid",
            "points": points,
            "startBinding": None,
            "endBinding": None,
            "startArrowhead": None,
            "endArrowhead": "arrow" if render.get("arrow", True) else None,
            "elbowed": False,
            "customData": {
                "diagram_edge": {
                    "source": edge.source,
                    "target": edge.target,
                    "relation": edge.relation,
                    "label": edge.label,
                }
            },
        }
    )
    return element


def _build_source_evidence(content: str, source_ids: list[str]) -> list[dict[str, Any]]:
    blocks = _extract_evidence_blocks(content, source_ids)
    if blocks:
        return [
            {
                "source_id": block["source_id"],
                "title": block["title"],
                "section": block["section"],
                "snippet": block["snippet"],
            }
            for block in blocks
        ]
    return [{"source_id": source_id, "title": "", "section": "", "snippet": ""} for source_id in source_ids]


def _estimate_diagram_confidence(ir: DiagramIR, evidence: list[dict[str, Any]]) -> float:
    meaningful_evidence = [
        item
        for item in evidence
        if any(str(item.get(field) or "").strip() for field in ("title", "section", "snippet"))
    ]
    node_score = min(len(ir.nodes), 10) * 0.02
    edge_score = min(len(ir.edges), 8) * 0.015
    evidence_score = min(len(meaningful_evidence), 4) * 0.09
    structure_score = 0.12 if ir.nodes and (ir.type == "mindmap" or ir.edges) else 0.0
    confidence = 0.28 + node_score + edge_score + evidence_score + structure_score
    if not meaningful_evidence:
        confidence = min(confidence, 0.48)
    return round(min(confidence, 0.9), 2)


def _build_generation_reason(ir: DiagramIR, evidence: list[dict[str, Any]]) -> str:
    if not ir.can_generate and not ir.nodes:
        refusal_reason = _clean_text(str(ir.metadata.get("refusal_reason") or ""), 180)
        return refusal_reason or "回答和引用证据不足以形成明确流程，本次不生成流程图。"
    if ir.type == "mindmap":
        keyword_count = int(ir.metadata.get("keyword_count") or len([node for node in ir.nodes if node.kind == "keyword"]))
        category_count = len(ir.metadata.get("categories", [])) if isinstance(ir.metadata.get("categories"), list) else 0
        return f"基于回答正文提取 {keyword_count} 个关键词，并结合 {len(evidence)} 条来源证据归类为 {category_count} 组思维导图节点。"
    step_count = int(ir.metadata.get("step_count") or len(ir.nodes))
    decision_count = len([node for node in ir.nodes if node.kind == "decision"])
    return f"基于回答中的 {step_count} 个步骤和 {len(evidence)} 条来源证据生成流程图，并标记 {decision_count} 个条件判断节点。"


def _build_excalidraw_scene(ir: DiagramIR) -> dict[str, Any]:
    node_indexes = {node.id: index for index, node in enumerate(ir.nodes)}
    nodes = _node_by_id(ir.nodes)
    edge_elements: list[dict[str, Any]] = []
    for index, edge in enumerate(ir.edges):
        source = nodes.get(edge.source)
        target = nodes.get(edge.target)
        if not source or not target:
            continue
        edge_elements.append(
            _excalidraw_edge_element(
                edge,
                source,
                target,
                node_indexes.get(source.id, 0),
                node_indexes.get(target.id, 0),
                index,
            )
        )
    node_elements: list[dict[str, Any]] = []
    for index, node in enumerate(ir.nodes):
        node_elements.extend(_excalidraw_node_elements(node, index))

    viewport = ir.metadata.get("viewport") if isinstance(ir.metadata.get("viewport"), dict) else {}
    return {
        "type": "excalidraw",
        "version": 2,
        "source": "ai-rag/rag/diagram_ir",
        "elements": [*edge_elements, *node_elements],
        "appState": {
            "viewBackgroundColor": "#FFFFFF",
            "gridSize": None,
            "theme": "light",
            "scrollX": 0,
            "scrollY": 0,
            "zoom": {"value": 1},
        },
        "files": {},
        "metadata": {
            "type": ir.type,
            "layout_hint": ir.layout_hint,
            "viewport": viewport,
        },
    }


def _attach_artifact_payload(ir: DiagramIR, content: str, source_ids: list[str]) -> DiagramIR:
    evidence = _build_source_evidence(content, source_ids)
    reason = _build_generation_reason(ir, evidence)

    ir.renderer = "excalidraw"
    ir.reason = reason
    ir.source_evidence = evidence
    ir.validation = validate_diagram_ir(ir, source_ids)
    ir.can_generate = ir.validation.can_generate
    ir.quality_score = ir.validation.quality_score
    ir.quality_warnings = [*ir.validation.errors, *ir.validation.warnings]
    confidence = min(_estimate_diagram_confidence(ir, evidence), max(ir.quality_score, 0.2))
    scene = _build_excalidraw_scene(ir)
    ir.confidence = confidence
    ir.excalidraw_scene = scene
    ir.metadata["renderer"] = "excalidraw"
    ir.metadata["legacy_renderer"] = "positioned-svg"
    ir.metadata["can_generate"] = ir.can_generate
    ir.metadata["quality_score"] = ir.quality_score
    ir.metadata["quality_warnings"] = [warning.model_dump() for warning in ir.quality_warnings]
    ir.metadata["validation"] = ir.validation.model_dump()
    ir.metadata["citation_coverage"] = {
        "required_source_ids": ir.validation.required_source_ids,
        "covered_source_ids": ir.validation.covered_source_ids,
        "missing_source_ids": ir.validation.missing_source_ids,
        "coverage_ratio": ir.validation.citation_coverage_ratio,
    }
    ir.metadata["layout_suggestion"] = ir.validation.layout_suggestion.model_dump()
    ir.metadata["artifact_payload"] = {
        "type": ir.type,
        "renderer": "excalidraw",
        "scene_format": "excalidraw",
            "scene_version": scene["version"],
            "element_count": len(scene["elements"]),
        "reason": reason,
        "confidence": confidence,
        "can_generate": ir.can_generate,
        "quality_score": ir.quality_score,
        "quality_warnings": [warning.model_dump() for warning in ir.quality_warnings],
        "citation_coverage": ir.metadata["citation_coverage"],
        "source_evidence": evidence,
        "lanes": [lane.model_dump() for lane in ir.lanes],
    }
    return ir


def _diagram_source_map(source_ids: list[str]) -> str:
    if not source_ids:
        return "无可用 source_id，节点 source_ids 必须返回空数组。"
    return "\n".join(f"- 引用 {index + 1}: {source_id}" for index, source_id in enumerate(source_ids))


def _build_structured_diagram_messages(
    title: str,
    content: str,
    source_ids: list[str],
    diagram_type: str,
    max_steps: int,
) -> list[dict[str, str]]:
    schema = {
        "title": "string",
        "objective": "string",
        "type": "mindmap|flowchart",
        "layout_hint": "radial|top_to_bottom|left_to_right|auto",
        "can_generate": True,
        "reason": "short reason; required when can_generate is false",
        "flow_semantics": {
            "roles": ["operators, systems, reviewers or equipment owners mentioned by evidence"],
            "actions": ["ordered evidence-backed actions"],
            "decisions": ["explicit yes/no or pass/fail questions"],
            "branches": ["main, pass, fail or exception branch summaries"],
            "loops": ["retry, rework or fallback return paths"],
            "final_results": ["business outcomes or terminal states"],
        },
        "lanes": [
            {
                "id": "stable role id, required when the flow has multiple roles",
                "label": "operator, system, reviewer, equipment owner or other evidence-backed role",
            }
        ],
        "nodes": [
            {
                "id": "stable kebab-case id",
                "label": "short business label",
                "kind": "root|category|keyword|topic|start|end|input|output|step|action|decision|subflow|equipment|parameter|risk",
                "description": "one short evidence-backed explanation",
                "source_ids": ["one or more source ids from the provided mapping"],
                "lane_id": "role lane id when this is a flowchart with multiple roles",
                "lane_label": "role lane label when lane_id is not available",
            }
        ],
        "edges": [
            {
                "source": "source node id",
                "target": "target node id",
                "relation": "contains|sequence|condition|loop|fallback|flows_to|relates_to",
                "label": "optional short label",
            }
        ],
        "notes": ["short generation notes"],
        "confidence": 0.0,
    }
    system = (
        "DIAGRAM_IR_STRUCTURED_OUTPUT\n"
        "你是企业电池产线 RAG 回答的图解结构化抽取器，只能基于回答正文和引用片段生成 DiagramIR JSON。\n"
        "硬性规则：\n"
        "1. 只输出一个 JSON object，不要输出 Markdown、解释或代码块。\n"
        "2. 先在 flow_semantics 中抽取角色、动作、判断、分支、循环和最终结果，再据此生成 nodes/edges。\n"
        "3. 节点必须是回答中的业务概念、步骤、参数、风险或动作，禁止创建 evidence/source/citation/引用 节点。\n"
        "4. 引用只能写入节点 source_ids，source_ids 只能来自用户提供的映射。\n"
        "5. 图要精简，节点数量不超过用户要求，标签短而具体，不要复述整段证据。\n"
        "6. mindmap 需要一个 root 节点，并用 contains 连接分类或主题。\n"
        "7. flowchart 必须先确认存在明确流程；优先使用 start/end/input/output/step/action/decision/subflow 节点；sequence 表达主线，condition 表达判断分支，loop 表达回流重试，fallback 表达异常或失败兜底，flows_to 仅用于旧结构兼容。\n"
        "8. flowchart 的 decision 节点 label 必须是明确问题，分支边 label 要写“是/否/通过/不通过/异常/失败”等业务结果；最终结果要落到 end/output/action 节点。\n"
        "9. flowchart 的每个业务节点都必须绑定 source_ids；每个 decision 至少两条带标签出边；每条 loop 边必须标注回流、返工、重试或复检条件。\n"
        "10. flowchart 如果涉及两个或更多角色、系统、岗位或设备责任方，必须输出 lanes，并为每个业务节点填写 lane_id 或 lane_label；不要把无证据的角色编造成泳道。\n"
        "11. 如果流程超过最大节点数，优先合并为 subflow；仍无法表达时返回 can_generate=false，并在 reason 说明需要拆分子流程。\n"
        "12. 如果无法从回答和引用中形成角色、动作、判断/分支或最终结果，返回 can_generate=false、reason、空 nodes 和空 edges，不要编造流程。"
    )
    user = (
        f"目标标题：{title}\n"
        f"目标图类型：{diagram_type}\n"
        f"最大节点数：{max_steps}\n"
        f"source_id 映射：\n{_diagram_source_map(source_ids)}\n\n"
        f"必须符合这个 JSON 结构：\n{json.dumps(schema, ensure_ascii=False, indent=2)}\n\n"
        f"待整理内容：\n{content[:10000]}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _parse_json_object(content: str) -> dict[str, Any]:
    text = content.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fenced:
        text = fenced.group(1)
    elif not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("diagram response must be a JSON object")
    return parsed


def _safe_node_id(value: str, fallback: str, used_ids: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip().lower()).strip("-_")
    if not base:
        base = fallback
    node_id = base[:48]
    suffix = 2
    while node_id in used_ids:
        trimmed = base[:42] or fallback
        node_id = f"{trimmed}-{suffix}"
        suffix += 1
    used_ids.add(node_id)
    return node_id


def _normalize_llm_node_kind(kind: str, label: str, diagram_type: str) -> str:
    normalized = kind.strip().lower().replace("-", "_")
    aliases = {
        "begin": "start",
        "entry": "start",
        "terminal_start": "start",
        "finish": "end",
        "done": "end",
        "terminal_end": "end",
        "io": "input",
        "data": "input",
        "result": "output",
        "outcome": "output",
        "process": "step",
        "subprocess": "subflow",
        "sub_process": "subflow",
        "sub_flow": "subflow",
        "source": "evidence",
        "citation": "evidence",
        "reference": "evidence",
        "concept": "topic",
        "condition": "decision",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized == "evidence":
        return "evidence"
    if diagram_type == "flowchart":
        if normalized in FLOWCHART_NODE_KINDS:
            return normalized
        if re.search(r"开始|启动|入口|发起", label):
            return "start"
        if re.search(r"结束|完成|关闭|归档", label):
            return "end"
        if re.search(r"输入|导入|接收|提交|上传", label):
            return "input"
        if re.search(r"输出|生成|产出|发布|回显", label):
            return "output"
        if re.search(r"子流程|子任务|并行处理|复用流程", label):
            return "subflow"
        if normalized == "decision" or re.search(_DECISION_PATTERN, label):
            return "decision"
        if normalized == "action" or re.search(_ACTION_PATTERN, label):
            return "action"
        return "step"
    if normalized in ALLOWED_NODE_KINDS:
        return normalized
    category, _label = _category_for_keyword(label)
    return category if category in ALLOWED_NODE_KINDS else "topic"


def _normalize_llm_edge_relation(relation: str, diagram_type: str) -> str:
    normalized = relation.strip().lower().replace("-", "_")
    aliases = {
        "next": "sequence",
        "then": "sequence",
        "main": "sequence",
        "depends_on": "condition",
        "branch": "condition",
        "if": "condition",
        "yes": "condition",
        "no": "condition",
        "retry": "loop",
        "repeat": "loop",
        "back": "loop",
        "fallback_path": "fallback",
        "exception": "fallback",
        "error": "fallback",
        "failure": "fallback",
        "fail": "fallback",
        "supports": "supported_by",
        "support": "supported_by",
        "includes": "contains",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized == "supported_by":
        return ""
    if normalized in ALLOWED_EDGE_RELATIONS:
        return normalized
    return "contains" if diagram_type == "mindmap" else "flows_to"


def _filtered_source_ids(values: list[str], allowed_source_ids: list[str]) -> list[str]:
    allowed = set(allowed_source_ids)
    result: list[str] = []
    for value in values:
        source_id = str(value).strip()
        if source_id and source_id in allowed and source_id not in result:
            result.append(source_id)
    return result


def _flow_semantics_metadata(flow_semantics: StructuredFlowSemantics) -> dict[str, list[str]]:
    normalized: dict[str, list[str]] = {}
    for key, values in flow_semantics.model_dump().items():
        cleaned_values: list[str] = []
        for value in values:
            cleaned = _clean_text(str(value), 96)
            if cleaned:
                cleaned_values.append(cleaned)
        if cleaned_values:
            normalized[key] = cleaned_values
    return normalized


def _structured_lanes(output: StructuredDiagramOutput, diagram_type: str) -> tuple[list[DiagramLane], dict[str, str]]:
    if diagram_type != "flowchart":
        return [], {}

    used_ids: set[str] = set()
    lanes: list[DiagramLane] = []
    alias_to_lane_id: dict[str, str] = {}

    def add_lane(raw_id: str, raw_label: str, source: str) -> str:
        label = _clean_text(raw_label or raw_id, 36)
        if not label:
            return ""
        existing = alias_to_lane_id.get(raw_id) or alias_to_lane_id.get(label)
        if existing:
            return existing
        lane_id = _safe_node_id(raw_id or label, f"lane-{len(lanes) + 1}", used_ids)
        lane = DiagramLane(id=lane_id, label=label, order=len(lanes), metadata={"source": source})
        lanes.append(lane)
        alias_to_lane_id[raw_id] = lane_id
        alias_to_lane_id[label] = lane_id
        alias_to_lane_id[lane_id] = lane_id
        return lane_id

    for lane in output.lanes:
        add_lane(lane.id, lane.label, "llm_lane")
    for role in output.flow_semantics.roles:
        add_lane(role, role, "flow_semantics_role")
    for node in output.nodes:
        add_lane(node.lane_id, node.lane_label or node.lane_id, "node_lane")

    return lanes[:6], alias_to_lane_id


def _resolve_node_lane(
    node: StructuredDiagramNode,
    lanes: list[DiagramLane],
    alias_to_lane_id: dict[str, str],
) -> DiagramLane | None:
    if not lanes:
        return None
    explicit = alias_to_lane_id.get(node.lane_id) or alias_to_lane_id.get(node.lane_label)
    if explicit:
        return next((lane for lane in lanes if lane.id == explicit), None)

    text = f"{node.label} {node.description}".lower()
    for lane in lanes:
        if lane.label.lower() and lane.label.lower() in text:
            return lane
    if len(lanes) == 1:
        return lanes[0]
    return None


def _structured_output_to_diagram_ir(
    output: StructuredDiagramOutput,
    title: str,
    content: str,
    source_ids: list[str],
    diagram_type: str,
    max_steps: int,
    model: str = "",
) -> DiagramIR:
    max_nodes = min(max(max_steps, 2), 12)
    semantic_extraction = _flow_semantics_metadata(output.flow_semantics)
    lanes, lane_aliases = _structured_lanes(output, diagram_type)
    original_node_count = 0
    for node in output.nodes:
        label = _clean_text(node.label, 56)
        if label and _normalize_llm_node_kind(node.kind, label, diagram_type) != "evidence":
            original_node_count += 1
    node_limit_exceeded = original_node_count > max_nodes
    if output.can_generate is False:
        refusal_reason = _clean_text(output.reason, 180)
        if not refusal_reason:
            refusal_reason = next((_clean_text(note, 180) for note in output.notes if _clean_text(note, 180)), "")
        if not refusal_reason:
            refusal_reason = "回答和引用证据不足以形成明确流程，本次不生成流程图。"
        ir = DiagramIR(
            title=_clean_text(output.title or title, 64) or title,
            objective=_clean_text(output.objective, 140) or "基于回答和引用证据判断是否可以生成结构化 Diagram IR。",
            type=diagram_type,
            layout_hint=output.layout_hint.strip() or ("radial" if diagram_type == "mindmap" else "top_to_bottom"),
            can_generate=False,
            nodes=[],
            edges=[],
            notes=[
                *[_clean_text(note, 120) for note in output.notes if _clean_text(note, 120)],
                "LLM 判断当前内容无法形成可靠流程图，未生成业务节点。",
            ],
            confidence=output.confidence,
            metadata={
                "generation_mode": "llm_structured",
                "model": model,
                "source_count": len(source_ids),
                "requested_node_limit": max_nodes,
                "original_node_count": original_node_count,
                "node_limit_exceeded": node_limit_exceeded,
                "structured_refusal": True,
                "refusal_reason": refusal_reason,
                "semantic_extraction": semantic_extraction,
                "lanes": [lane.model_dump() for lane in lanes],
            },
        )
        return _attach_artifact_payload(ir, content, source_ids)

    used_ids: set[str] = set()
    id_map: dict[str, str] = {}
    nodes: list[DiagramNode] = []

    for index, node in enumerate(output.nodes):
        label = _clean_text(node.label, 56)
        if not label:
            continue
        kind = _normalize_llm_node_kind(node.kind, label, diagram_type)
        if kind == "evidence":
            continue
        if len(nodes) >= max_nodes:
            break
        fallback = "root" if diagram_type == "mindmap" and not nodes else f"node-{index + 1}"
        node_id = _safe_node_id(node.id or label, fallback, used_ids)
        if node.id:
            id_map[node.id] = node_id
        id_map[label] = node_id
        lane = _resolve_node_lane(node, lanes, lane_aliases)
        node_metadata: dict[str, Any] = {"generated_by": "llm_structured"}
        if lane:
            node_metadata["lane_id"] = lane.id
            node_metadata["lane_label"] = lane.label
        nodes.append(
            DiagramNode(
                id=node_id,
                label=label,
                kind=kind,
                description=_clean_text(node.description, 140),
                source_ids=_filtered_source_ids(node.source_ids, source_ids),
                metadata=node_metadata,
            )
        )

    if diagram_type == "mindmap" and not any(node.kind == "root" for node in nodes):
        root_id = _safe_node_id("root", "root", used_ids)
        nodes.insert(
            0,
            DiagramNode(
                id=root_id,
                label=_clean_text(output.title or title, 44) or title,
                kind="root",
                source_ids=[],
                metadata={"generated_by": "llm_structured", "synthetic": True},
            ),
        )

    node_ids = {node.id for node in nodes}
    edges: list[DiagramEdge] = []
    seen_edges: set[tuple[str, str, str]] = set()
    for edge in output.edges:
        source = id_map.get(edge.source, edge.source)
        target = id_map.get(edge.target, edge.target)
        relation = _normalize_llm_edge_relation(edge.relation, diagram_type)
        if not relation or source not in node_ids or target not in node_ids or source == target:
            continue
        edge_key = (source, target, relation)
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        edges.append(
            DiagramEdge(
                source=source,
                target=target,
                relation=relation,
                label=_clean_text(edge.label, 36),
                metadata={"generated_by": "llm_structured"},
            )
        )

    if diagram_type == "mindmap":
        root = next((node for node in nodes if node.kind == "root"), nodes[0] if nodes else None)
        if root:
            connected = {edge.target for edge in edges if edge.source == root.id}
            for node in nodes:
                if node.id != root.id and node.id not in connected:
                    edges.append(DiagramEdge(source=root.id, target=node.id, relation="contains", metadata={"generated_by": "llm_structured", "synthetic": True}))
    elif not edges and len(nodes) > 1:
        for source, target in zip(nodes, nodes[1:]):
            relation = "condition" if target.kind == "decision" else "sequence"
            edges.append(DiagramEdge(source=source.id, target=target.id, relation=relation, metadata={"generated_by": "llm_structured", "synthetic": True}))

    if not nodes:
        raise ValueError("LLM structured diagram contains no usable business nodes")

    layout_hint = output.layout_hint.strip() or ("radial" if diagram_type == "mindmap" else "top_to_bottom")
    ir = DiagramIR(
        title=_clean_text(output.title or title, 64) or title,
        objective=_clean_text(output.objective, 140) or "基于回答和引用证据提炼精简业务节点，生成结构化 Diagram IR。",
        type=diagram_type,
        layout_hint=layout_hint,
        nodes=nodes,
        edges=edges,
        lanes=lanes,
        notes=[
            *[_clean_text(note, 120) for note in output.notes if _clean_text(note, 120)],
            "LLM 仅输出业务节点，引用证据保留在节点 source_ids 和 source_evidence 中。",
            *(
                ["结构化节点数量超过上限，已截断；建议拆分为子流程或使用 subflow 表达。"]
                if node_limit_exceeded
                else []
            ),
        ],
        confidence=output.confidence,
        metadata={
            "generation_mode": "llm_structured",
            "model": model,
            "source_count": len(source_ids),
            "requested_node_limit": max_nodes,
            "original_node_count": original_node_count,
            "node_limit_exceeded": node_limit_exceeded,
            "semantic_extraction": semantic_extraction,
            "lanes": [lane.model_dump() for lane in lanes],
        },
    )
    if diagram_type == "mindmap":
        ir = _apply_mindmap_layout(ir)
    else:
        ir = _apply_flowchart_layout(ir)
    return _attach_artifact_payload(ir, content, source_ids)


def build_llm_diagram_ir(
    title: str,
    content: str,
    source_ids: list[str] | None = None,
    diagram_type: str = "flowchart",
    max_steps: int = 8,
    llm_chat: StructuredDiagramChat | None = None,
) -> DiagramIR:
    source_ids = source_ids or []
    normalized_diagram_type = diagram_type if diagram_type in {"mindmap", "flowchart"} else "mindmap"
    messages = _build_structured_diagram_messages(
        title=title,
        content=content,
        source_ids=source_ids,
        diagram_type=normalized_diagram_type,
        max_steps=max_steps,
    )
    try:
        if llm_chat is None:
            from ..llm.client import chat as llm_chat
        response = llm_chat(
            messages,
            temperature=0.1,
            response_format=STRUCTURED_OUTPUT_FORMAT,
        )
        output = StructuredDiagramOutput.model_validate(_parse_json_object(str(response.get("content") or "")))
        output.type = normalized_diagram_type
        return _structured_output_to_diagram_ir(
            output=output,
            title=title,
            content=content,
            source_ids=source_ids,
            diagram_type=normalized_diagram_type,
            max_steps=max_steps,
            model=str(response.get("model") or ""),
        )
    except (ValueError, json.JSONDecodeError, ValidationError, TypeError) as exc:
        fallback = build_keyword_diagram_ir(
            title=title,
            content=content,
            source_ids=source_ids,
            diagram_type=normalized_diagram_type,
            max_steps=max_steps,
        )
        fallback.metadata["generation_mode"] = "keyword_fallback"
        fallback.metadata["fallback_reason"] = str(exc)[:240]
        fallback.notes.append("LLM structured output 不可用，本次使用关键词规则降级生成。")
        return fallback


def build_keyword_diagram_ir(
    title: str,
    content: str,
    source_ids: list[str] | None = None,
    diagram_type: str = "flowchart",
    max_steps: int = 8,
) -> DiagramIR:
    source_ids = source_ids or []
    keyword_items = _extract_weighted_keywords(content, source_ids, limit=max(max_steps * 3, 30))
    keywords = [item["term"] for item in keyword_items]
    steps = extract_diagram_steps(content, max_steps)
    nodes: list[DiagramNode] = []
    edges: list[DiagramEdge] = []

    if diagram_type == "mindmap":
        root_id = "root"
        nodes.append(
            DiagramNode(
                id=root_id,
                label=title,
                kind="root",
                source_ids=source_ids,
                metadata={"keywords": keywords},
            )
        )
        category_nodes: dict[str, str] = {}
        category_counts: Counter[str] = Counter()
        keyword_evidence: dict[str, list[dict[str, Any]]] = {}
        ordered_items = sorted(
            keyword_items or [
                {"term": step, "category": _category_for_keyword(step)[0], "category_label": _category_for_keyword(step)[1], "weight": 1, "source_ids": [], "evidence": []}
                for step in steps
            ],
            key=lambda item: (_CATEGORY_ORDER.index(item["category"]) if item["category"] in _CATEGORY_ORDER else 99, -item["weight"], item["term"]),
        )
        for item in ordered_items:
            keyword = item["term"]
            category = item["category"]
            label = item["category_label"]
            if category not in category_nodes and len(category_nodes) >= _MAX_MINDMAP_CATEGORIES:
                continue
            if category_counts[category] >= _MAX_KEYWORDS_PER_CATEGORY:
                continue
            if category not in category_nodes:
                category_id = f"category-{category}"
                category_nodes[category] = category_id
                nodes.append(
                    DiagramNode(
                        id=category_id,
                        label=label,
                        kind="category",
                        source_ids=source_ids,
                    )
                )
                edges.append(DiagramEdge(source=root_id, target=category_id, relation="contains"))

            node_id = f"keyword-{len(nodes)}"
            nodes.append(
                DiagramNode(
                    id=node_id,
                    label=keyword,
                    kind="keyword",
                    source_ids=item.get("source_ids") or source_ids,
                    metadata={
                        "category": category,
                        "weight": item.get("weight", 1),
                        "evidence_count": len(item.get("evidence", [])),
                    },
                )
            )
            edges.append(
                DiagramEdge(
                    source=category_nodes[category],
                    target=node_id,
                    relation="contains",
                )
            )
            category_counts[category] += 1
            keyword_evidence[keyword] = item.get("evidence", [])[:2]

        return _attach_artifact_payload(_apply_mindmap_layout(DiagramIR(
            title=title,
            objective="基于回答和引用内容提炼核心概念，生成精简思维导图 IR。",
            type=diagram_type,
            layout_hint="radial",
            nodes=nodes,
            edges=edges,
            notes=[
                "画布只展示核心概念，引用证据保留在节点元数据中。",
                f"每个分类最多展示 {_MAX_KEYWORDS_PER_CATEGORY} 个关键点。",
            ],
            metadata={
                "source_count": len(source_ids),
                "keyword_count": len([node for node in nodes if node.kind == "keyword"]),
                "categories": list(category_nodes.keys()),
                "keyword_sources": {item["term"]: item.get("source_ids", []) for item in keyword_items},
                "keyword_evidence": keyword_evidence,
                "condensed": True,
                "max_categories": _MAX_MINDMAP_CATEGORIES,
                "max_keywords_per_category": _MAX_KEYWORDS_PER_CATEGORY,
            },
        )), content, source_ids)

    previous_id = ""
    for index, step in enumerate(steps, 1):
        node_id = f"step-{index}"
        matched_keywords = [keyword for keyword in keywords if keyword in step]
        node_kind = _step_kind(step)
        nodes.append(
            DiagramNode(
                id=node_id,
                label=step,
                kind=node_kind,
                source_ids=source_ids,
                metadata={"keywords": matched_keywords},
            )
        )
        if previous_id:
            is_condition = node_kind == "decision"
            edges.append(
                DiagramEdge(
                    source=previous_id,
                    target=node_id,
                    relation="condition" if is_condition else "sequence",
                    label="判断" if is_condition else "",
                )
            )
        previous_id = node_id

    return _attach_artifact_payload(_apply_flowchart_layout(DiagramIR(
        title=title,
        objective="基于回答步骤和关键词生成可渲染的流程图 IR。",
        type=diagram_type,
        layout_hint="top_to_bottom",
        nodes=nodes,
        edges=edges,
        notes=[
            "步骤来自回答中的编号、换行和句子边界。",
            "条件词会标记为 decision 节点，供前端突出显示。",
        ],
        metadata={
            "source_count": len(source_ids),
            "step_count": len(steps),
            "keywords": keywords,
            "node_kinds": [node.kind for node in nodes],
        },
    )), content, source_ids)


def build_placeholder_diagram_ir(
    title: str,
    steps: list[str],
    source_ids: list[str] | None = None,
    diagram_type: str = "flowchart",
) -> DiagramIR:
    return build_keyword_diagram_ir(
        title=title,
        content="。".join(steps),
        source_ids=source_ids,
        diagram_type=diagram_type,
        max_steps=max(len(steps), 2),
    )
