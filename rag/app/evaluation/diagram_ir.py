from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from typing import Any, Callable

from pydantic import BaseModel, Field, ValidationError


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


class DiagramIR(BaseModel):
    schema_version: str = "diagram-ir/v2"
    title: str
    objective: str = ""
    diagram_type: str = "graph"
    layout_hint: str = "auto"
    can_generate: bool = True
    nodes: list[DiagramNode] = Field(default_factory=list)
    edges: list[DiagramEdge] = Field(default_factory=list)
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


class StructuredDiagramNode(BaseModel):
    id: str = ""
    label: str
    kind: str = "topic"
    description: str = ""
    source_ids: list[str] = Field(default_factory=list)


class StructuredDiagramEdge(BaseModel):
    source: str
    target: str
    relation: str = "relates_to"
    label: str = ""


class StructuredDiagramOutput(BaseModel):
    title: str = ""
    objective: str = ""
    diagram_type: str = "mindmap"
    layout_hint: str = "auto"
    nodes: list[StructuredDiagramNode] = Field(default_factory=list)
    edges: list[StructuredDiagramEdge] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


StructuredDiagramChat = Callable[..., dict[str, Any]]


_STOPWORDS = {
    "这个",
    "那个",
    "需要",
    "进行",
    "可以",
    "如果",
    "然后",
    "以及",
    "或者",
    "因为",
    "所以",
    "当前",
    "相关",
    "通过",
    "确认",
    "检查",
    "文档",
    "章节",
    "来源",
    "引用",
    "回答正文",
}

_CATEGORY_RULES: tuple[tuple[str, str, set[str]], ...] = (
    ("equipment", "设备", {"设备", "夹具", "传感器", "电机", "阀门", "工站", "产线", "模组", "测试柜", "仪器", "探针", "线束"}),
    ("step", "步骤", {"步骤", "流程", "先", "再", "然后", "最后", "执行", "连接", "施加", "测量", "计算"}),
    ("parameter", "参数", {"温度", "压力", "电压", "电流", "时间", "速度", "阈值", "窗口", "SOC", "PPM", "mA", "MΩ", "V", "DC", "AC"}),
    ("risk", "风险", {"异常", "故障", "风险", "报警", "缺陷", "超限", "失效", "安全", "击穿", "短路", "泄漏"}),
    ("action", "处理方法", {"检查", "确认", "调整", "复位", "更换", "记录", "上传", "恢复", "定位", "处理", "隔离", "返修", "复核"}),
)

_CATEGORY_ORDER = ("equipment", "step", "parameter", "risk", "action", "concept")
_SEQUENCE_PATTERN = r"先|再|然后|之后|随后|最后|第一步|第二步|第三步|执行|连接|施加|测量|计算|记录|上传"
_DECISION_PATTERN = r"如果|若|是否|判断|异常|失败|否则|低于|高于|超过|不通过|报警"
_ACTION_PATTERN = r"检查|确认|处理|恢复|更换|复位|记录|上传|隔离|返修|复核|定位|调整"
_PARAMETER_PATTERN = r"\d+(?:\.\d+)?\s?(?:V|mA|A|MΩ|GΩ|Ω|秒|s|PPM|%RH|%)|≥\s?\d+|≤\s?\d+"
_MAX_MINDMAP_CATEGORIES = 5
_MAX_KEYWORDS_PER_CATEGORY = 4
_ALLOWED_DIAGRAM_TYPES = {"mindmap", "flowchart", "graph"}
_ALLOWED_NODE_KINDS = {"root", "category", "keyword", "evidence", "step", "decision", "action", "topic", "equipment", "parameter", "risk"}
_ALLOWED_EDGE_RELATIONS = {"contains", "supported_by", "sequence", "condition", "flows_to", "relates_to"}
_STRUCTURED_OUTPUT_FORMAT = {"type": "json_object"}


def _clean_text(value: str, max_length: int = 80) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip(" ，。；：、,.!?！？()（）[]【】|")
    return cleaned[:max_length]


def _source_id_at(source_ids: list[str], index: int) -> str:
    if 0 <= index < len(source_ids):
        return source_ids[index]
    return f"source-{index + 1}"


def _extract_evidence_blocks(content: str, source_ids: list[str]) -> list[dict[str, str]]:
    blocks: list[dict[str, str]] = []
    pattern = re.compile(
        r"\[引用\s*(\d+)\]\s*文档：(?P<title>.*?)\s*章节：(?P<section>.*?)\s*片段：(?P<snippet>.*?)(?=\n\[引用\s*\d+\]|\Z)",
        re.S,
    )
    for match in pattern.finditer(content):
        index = int(match.group(1)) - 1
        title = _clean_text(match.group("title"), 42)
        section = _clean_text(match.group("section"), 56)
        snippet = _clean_text(match.group("snippet"), 160)
        blocks.append(
            {
                "source_id": _source_id_at(source_ids, index),
                "title": title,
                "section": section,
                "snippet": snippet,
                "text": " ".join(part for part in (title, section, snippet) if part),
            }
        )
    return blocks


def _term_weight(term: str, text: str) -> int:
    return len(re.findall(re.escape(term), text, flags=re.I))


def _adjusted_keyword_weight(term: str, weight: int) -> int:
    category, _label = _category_for_keyword(term)
    bonus = 0
    if category != "concept":
        bonus += 3
    if category == "parameter":
        bonus += 2
    return weight + bonus


def extract_diagram_keywords(content: str, limit: int = 10) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fffA-Za-z0-9Ωμ/%-]{2,}", content)
    counter: Counter[str] = Counter()

    for word in words:
        normalized = _clean_text(word, 16)
        if len(normalized) < 2 or normalized in _STOPWORDS:
            continue
        if re.fullmatch(r"\d+", normalized):
            continue
        counter[normalized] += 1

        if re.search(r"[\u4e00-\u9fff]{5,}", normalized):
            for size in (4, 3, 2):
                for index in range(0, len(normalized) - size + 1):
                    ngram = normalized[index:index + size]
                    if ngram not in _STOPWORDS:
                        counter[ngram] += 1

    ranked = sorted(counter.items(), key=lambda item: (-_adjusted_keyword_weight(item[0], item[1]), -len(item[0]), item[0]))
    return [word for word, _count in ranked[:limit]]


def _extract_weighted_keywords(content: str, source_ids: list[str], limit: int) -> list[dict[str, Any]]:
    evidence_blocks = _extract_evidence_blocks(content, source_ids)
    counter: Counter[str] = Counter()
    source_map: dict[str, set[str]] = {}
    evidence_map: dict[str, list[dict[str, str]]] = {}

    fields: list[tuple[str, int, str]] = [(content, 3, "answer")]
    for block in evidence_blocks:
        fields.extend(
            [
                (block["title"], 3, block["source_id"]),
                (block["section"], 2, block["source_id"]),
                (block["snippet"], 2, block["source_id"]),
            ]
        )

    for text, weight, source_id in fields:
        for keyword in extract_diagram_keywords(text, limit=limit * 3):
            if keyword in _STOPWORDS:
                continue
            counter[keyword] += weight + _term_weight(keyword, text)
            if source_id != "answer":
                source_map.setdefault(keyword, set()).add(source_id)
                matched_block = next((block for block in evidence_blocks if block["source_id"] == source_id), None)
                if matched_block:
                    evidence_map.setdefault(keyword, []).append(matched_block)

    for parameter in re.findall(_PARAMETER_PATTERN, content, flags=re.I):
        normalized = _clean_text(parameter, 18)
        if normalized:
            counter[normalized] += 5

    ranked = sorted(counter.items(), key=lambda item: (-item[1], -len(item[0]), item[0]))
    results: list[dict[str, Any]] = []
    seen_categories: Counter[str] = Counter()
    for keyword, weight in ranked:
        category, label = _category_for_keyword(keyword)
        weight = _adjusted_keyword_weight(keyword, weight)
        if seen_categories[category] >= 6:
            continue
        seen_categories[category] += 1
        results.append(
            {
                "term": keyword,
                "weight": weight,
                "category": category,
                "category_label": label,
                "source_ids": sorted(source_map.get(keyword, set())),
                "evidence": evidence_map.get(keyword, [])[:2],
            }
        )
        if len(results) >= limit:
            break
    return results


def _category_for_keyword(keyword: str) -> tuple[str, str]:
    if re.search(_PARAMETER_PATTERN, keyword, flags=re.I):
        return "parameter", "参数"
    for category, label, markers in _CATEGORY_RULES:
        if any(marker in keyword for marker in markers):
            return category, label
    return "concept", "概念"


def extract_diagram_steps(content: str, max_steps: int) -> list[str]:
    cleaned = content.strip()
    candidates: list[str] = []

    numbered_content = re.sub(
        r"(^|[。；;.!?！？\s])(?:\d+[.)、]|[一二三四五六七八九十]+[、.])\s*",
        lambda match: f"{match.group(1)}\n",
        cleaned,
    )

    for block in re.split(r"[\r\n]+", numbered_content):
        block = block.strip()
        if not block:
            continue
        for part in re.split(r"[。；;.!?！？]+", block):
            line = re.sub(r"^\s*(?:[-*+]\s+|\d+[.)、]\s*|[一二三四五六七八九十]+[、.]\s*)", "", part).strip()
            if line and (
                re.search(_SEQUENCE_PATTERN, line)
                or re.search(_DECISION_PATTERN, line)
                or re.search(_ACTION_PATTERN, line)
                or len(candidates) < 2
            ):
                candidates.append(line)

    steps: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = re.sub(r"\s+", " ", candidate).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        steps.append(normalized[:80])
        if len(steps) >= max_steps:
            break

    if len(steps) < 2 and cleaned:
        compact = re.sub(r"\s+", " ", cleaned)
        steps = [compact[index:index + 36] for index in range(0, min(len(compact), 36 * max_steps), 36)]

    return steps[:max_steps] or ["整理回答要点", "检查关联证据"]


def _step_kind(step: str) -> str:
    if re.search(_DECISION_PATTERN, step):
        return "decision"
    if re.search(_ACTION_PATTERN, step):
        return "action"
    return "step"


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
    "contains": {"stroke": "#94A3B8", "strokeWidth": 1.8, "curve": "horizontal", "arrow": True},
    "supported_by": {"stroke": "#CBD5E1", "strokeWidth": 1.2, "strokeDasharray": "5 6", "curve": "horizontal", "arrow": False},
    "sequence": {"stroke": "#64748B", "strokeWidth": 2.0, "curve": "vertical", "arrow": True},
    "condition": {"stroke": "#D97706", "strokeWidth": 1.8, "curve": "vertical", "arrow": True},
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


def _apply_mindmap_layout(ir: DiagramIR) -> DiagramIR:
    nodes = _node_by_id(ir.nodes)
    children = _children_by_source(ir.edges)
    root = next((node for node in ir.nodes if node.kind == "root"), ir.nodes[0] if ir.nodes else None)
    if not root:
        return ir

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
    viewport_width = 980
    center_x = viewport_width // 2
    center_y = viewport_height // 2
    _set_layout(root, center_x - 78, center_y - 34, 156, 68, "root")

    cursors = {
        1: max(70, (viewport_height - right_height) // 2),
        -1: max(70, (viewport_height - left_height) // 2),
    }
    for category, keyword_ids, block_height, side in category_blocks:
        y = cursors[side] + block_height // 2
        cursors[side] += block_height
        category_x = center_x + side * 230
        _set_layout(category, category_x - 56, y - 24, 112, 48, "category")

        for keyword_index, keyword_id in enumerate(keyword_ids):
            keyword = nodes[keyword_id]
            keyword_y = y + (keyword_index - (len(keyword_ids) - 1) / 2) * 56
            keyword_x = category_x + side * 185
            _set_layout(keyword, int(keyword_x - 68), int(keyword_y - 20), 136, 40, keyword.metadata.get("category", "keyword"))

            evidence_ids = [node_id for node_id in children.get(keyword.id, []) if nodes.get(node_id) and nodes[node_id].kind == "evidence"]
            for evidence_index, evidence_id in enumerate(evidence_ids[:2]):
                evidence = nodes[evidence_id]
                evidence_x = keyword_x + side * 140
                evidence_y = keyword_y + (evidence_index * 30) - 15
                _set_layout(evidence, int(evidence_x - 46), int(evidence_y - 14), 92, 28, "evidence")

    _apply_edge_render(ir.edges)
    ir.metadata["viewport"] = {"width": viewport_width, "height": viewport_height}
    ir.metadata["renderer"] = "positioned-svg"
    return ir


def _apply_flowchart_layout(ir: DiagramIR) -> DiagramIR:
    flow_nodes = [node for node in ir.nodes if node.kind in {"step", "decision", "action"}]
    viewport_width = 980
    viewport_height = max(620, len(flow_nodes) * 168 + 140)
    center_x = viewport_width // 2

    for index, node in enumerate(flow_nodes):
        y = 86 + index * 168
        if node.kind == "decision":
            _set_layout(node, center_x - 160, y - 58, 320, 116, "decision")
        elif node.kind == "action":
            _set_layout(node, center_x - 210, y - 38, 420, 76, "action")
        else:
            _set_layout(node, center_x - 210, y - 38, 420, 76, "step")

    _apply_edge_render(ir.edges)
    ir.metadata["viewport"] = {"width": viewport_width, "height": viewport_height}
    ir.metadata["renderer"] = "positioned-svg"
    ir.metadata["layout_rule"] = "top_down_process_rectangles_decision_diamonds"
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


def _edge_points(source: DiagramNode, target: DiagramNode, source_index: int, target_index: int) -> tuple[float, float, float, float]:
    source_layout = _node_layout(source, source_index)
    target_layout = _node_layout(target, target_index)
    source_x = source_layout["x"] + source_layout["width"] / 2
    source_y = source_layout["y"] + source_layout["height"] / 2
    target_x = target_layout["x"] + target_layout["width"] / 2
    target_y = target_layout["y"] + target_layout["height"] / 2
    return source_x, source_y, target_x, target_y


def _excalidraw_edge_element(
    edge: DiagramEdge,
    source: DiagramNode,
    target: DiagramNode,
    source_index: int,
    target_index: int,
    index: int,
) -> dict[str, Any]:
    start_x, start_y, end_x, end_y = _edge_points(source, target, source_index, target_index)
    element_id = f"edge-{edge.source}-{edge.target}-{index}"
    render = edge.metadata.get("render") if isinstance(edge.metadata.get("render"), dict) else {}
    element = _element_base(element_id, "arrow", start_x, start_y, end_x - start_x, end_y - start_y)
    element.update(
        {
            "strokeColor": render.get("stroke", "#64748B"),
            "strokeWidth": int(float(render.get("strokeWidth", 2))),
            "strokeStyle": "dashed" if render.get("strokeDasharray") else "solid",
            "points": [[0, 0], [end_x - start_x, end_y - start_y]],
            "startBinding": {"elementId": f"node-{source.id}", "focus": 0, "gap": 10},
            "endBinding": {"elementId": f"node-{target.id}", "focus": 0, "gap": 10},
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
    if ir.diagram_type == "flowchart":
        return DiagramLayoutSuggestion(
            layout_hint=ir.layout_hint or "top_to_bottom",
            direction="top_to_bottom",
            node_spacing=120,
            rank_spacing=168,
            viewport=normalized_viewport,
            notes=["流程图建议保持单主线自上而下布局，decision 节点用于承载判断条件。"],
        )
    if ir.diagram_type == "mindmap":
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
        if node.kind not in _ALLOWED_NODE_KINDS:
            warnings.append(_diagram_warning("unknown_node_kind", "未知节点类型会触发默认样式兜底。", node_ids=[node.id]))
        covered_sources.update(source_id for source_id in node.source_ids if source_id)

    if duplicate_node_ids:
        errors.append(_diagram_warning(
            "duplicate_node_id",
            "节点 id 必须唯一。",
            severity="error",
            node_ids=sorted(duplicate_node_ids),
        ))

    seen_edges: set[tuple[str, str, str]] = set()
    duplicate_edges: set[str] = set()
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
        if edge.relation not in _ALLOWED_EDGE_RELATIONS:
            warnings.append(_diagram_warning("unknown_edge_relation", "未知连线关系会触发默认连线样式兜底。", edge_ids=[edge_id]))
        edge_key = (edge.source, edge.target, edge.relation)
        if edge_key in seen_edges:
            duplicate_edges.add(edge_id)
        seen_edges.add(edge_key)

    if duplicate_edges:
        warnings.append(_diagram_warning("duplicate_edge", "存在重复连线，建议生成前去重。", edge_ids=sorted(duplicate_edges)))
    if not ir.nodes:
        errors.append(_diagram_warning("empty_nodes", "图解至少需要一个节点。", severity="error"))
    if ir.diagram_type not in _ALLOWED_DIAGRAM_TYPES:
        warnings.append(_diagram_warning("unknown_diagram_type", "未知图解类型会触发前端通用图兜底渲染。"))
    if ir.diagram_type == "flowchart" and len(ir.nodes) > 1 and not ir.edges:
        warnings.append(_diagram_warning("flowchart_without_edges", "流程图有多个节点但没有连线，流程关系不完整。"))
    if ir.diagram_type == "mindmap" and not any(node.kind == "root" for node in ir.nodes):
        warnings.append(_diagram_warning("mindmap_without_root", "思维导图缺少 root 节点，布局稳定性会下降。"))

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
    structure_bonus = 0.12 if ir.nodes and (ir.diagram_type == "mindmap" or ir.edges) else 0.0
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


def _estimate_diagram_confidence(ir: DiagramIR, evidence: list[dict[str, Any]]) -> float:
    meaningful_evidence = [
        item
        for item in evidence
        if any(str(item.get(field) or "").strip() for field in ("title", "section", "snippet"))
    ]
    node_score = min(len(ir.nodes), 10) * 0.02
    edge_score = min(len(ir.edges), 8) * 0.015
    evidence_score = min(len(meaningful_evidence), 4) * 0.09
    structure_score = 0.12 if ir.nodes and (ir.diagram_type == "mindmap" or ir.edges) else 0.0
    confidence = 0.28 + node_score + edge_score + evidence_score + structure_score
    if not meaningful_evidence:
        confidence = min(confidence, 0.48)
    return round(min(confidence, 0.9), 2)


def _build_generation_reason(ir: DiagramIR, evidence: list[dict[str, Any]]) -> str:
    if ir.diagram_type == "mindmap":
        keyword_count = int(ir.metadata.get("keyword_count") or len([node for node in ir.nodes if node.kind == "keyword"]))
        category_count = len(ir.metadata.get("categories", [])) if isinstance(ir.metadata.get("categories"), list) else 0
        return f"基于回答正文提取 {keyword_count} 个关键词，并结合 {len(evidence)} 条来源证据归类为 {category_count} 组思维导图节点。"
    step_count = int(ir.metadata.get("step_count") or len(ir.nodes))
    decision_count = len([node for node in ir.nodes if node.kind == "decision"])
    return f"基于回答中的 {step_count} 个步骤和 {len(evidence)} 条来源证据生成流程图，并标记 {decision_count} 个条件判断节点。"


def _build_excalidraw_scene(ir: DiagramIR) -> dict[str, Any]:
    node_indexes = {node.id: index for index, node in enumerate(ir.nodes)}
    nodes = _node_by_id(ir.nodes)
    elements: list[dict[str, Any]] = []
    for index, node in enumerate(ir.nodes):
        elements.extend(_excalidraw_node_elements(node, index))
    for index, edge in enumerate(ir.edges):
        source = nodes.get(edge.source)
        target = nodes.get(edge.target)
        if not source or not target:
            continue
        elements.append(
            _excalidraw_edge_element(
                edge,
                source,
                target,
                node_indexes.get(source.id, 0),
                node_indexes.get(target.id, 0),
                index,
            )
        )

    viewport = ir.metadata.get("viewport") if isinstance(ir.metadata.get("viewport"), dict) else {}
    return {
        "type": "excalidraw",
        "version": 2,
        "source": "ai-rag/rag/diagram_ir",
        "elements": elements,
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
            "diagram_type": ir.diagram_type,
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
        "diagram_type": "mindmap|flowchart",
        "layout_hint": "radial|top_to_bottom|left_to_right|auto",
        "nodes": [
            {
                "id": "stable kebab-case id",
                "label": "short business label",
                "kind": "root|category|keyword|topic|step|decision|action|equipment|parameter|risk",
                "description": "one short evidence-backed explanation",
                "source_ids": ["one or more source ids from the provided mapping"],
            }
        ],
        "edges": [
            {
                "source": "source node id",
                "target": "target node id",
                "relation": "contains|sequence|condition|flows_to|relates_to",
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
        "2. 节点必须是回答中的业务概念、步骤、参数、风险或动作，禁止创建 evidence/source/citation/引用 节点。\n"
        "3. 引用只能写入节点 source_ids，source_ids 只能来自用户提供的映射。\n"
        "4. 图要精简，节点数量不超过用户要求，标签短而具体，不要复述整段证据。\n"
        "5. mindmap 需要一个 root 节点，并用 contains 连接分类或主题；flowchart 使用 sequence/condition/flows_to 表达流程。\n"
        "6. 如果证据不足以生成某个节点，不要编造。"
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
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.S)
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
        "source": "evidence",
        "citation": "evidence",
        "reference": "evidence",
        "concept": "topic",
        "process": "step",
        "condition": "decision",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized == "evidence":
        return "evidence"
    if diagram_type == "flowchart":
        if normalized == "decision" or re.search(_DECISION_PATTERN, label):
            return "decision"
        if normalized == "action" or re.search(_ACTION_PATTERN, label):
            return "action"
        return "step"
    if normalized in _ALLOWED_NODE_KINDS:
        return normalized
    category, _label = _category_for_keyword(label)
    return category if category in _ALLOWED_NODE_KINDS else "topic"


def _normalize_llm_edge_relation(relation: str, diagram_type: str) -> str:
    normalized = relation.strip().lower().replace("-", "_")
    aliases = {
        "next": "sequence",
        "then": "sequence",
        "depends_on": "condition",
        "supports": "supported_by",
        "support": "supported_by",
        "includes": "contains",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized == "supported_by":
        return ""
    if normalized in _ALLOWED_EDGE_RELATIONS:
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
        nodes.append(
            DiagramNode(
                id=node_id,
                label=label,
                kind=kind,
                description=_clean_text(node.description, 140),
                source_ids=_filtered_source_ids(node.source_ids, source_ids),
                metadata={"generated_by": "llm_structured"},
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
        diagram_type=diagram_type,
        layout_hint=layout_hint,
        nodes=nodes,
        edges=edges,
        notes=[
            *[_clean_text(note, 120) for note in output.notes if _clean_text(note, 120)],
            "LLM 仅输出业务节点，引用证据保留在节点 source_ids 和 source_evidence 中。",
        ],
        confidence=output.confidence,
        metadata={
            "generation_mode": "llm_structured",
            "model": model,
            "source_count": len(source_ids),
            "requested_node_limit": max_nodes,
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
            response_format=_STRUCTURED_OUTPUT_FORMAT,
        )
        output = StructuredDiagramOutput.model_validate(_parse_json_object(str(response.get("content") or "")))
        output.diagram_type = normalized_diagram_type
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
            diagram_type=diagram_type,
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
        diagram_type=diagram_type,
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
