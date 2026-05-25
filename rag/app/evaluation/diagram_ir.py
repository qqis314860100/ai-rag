from __future__ import annotations

import re
from collections import Counter
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
}

_CATEGORY_RULES: tuple[tuple[str, str, set[str]], ...] = (
    ("risk", "风险", {"异常", "故障", "风险", "报警", "缺陷", "超限", "失效", "安全"}),
    ("parameter", "参数", {"温度", "压力", "电压", "电流", "时间", "速度", "阈值", "窗口", "SOC"}),
    ("equipment", "设备", {"设备", "夹具", "传感器", "电机", "阀门", "工站", "产线", "模组"}),
    ("action", "动作", {"检查", "确认", "调整", "复位", "更换", "记录", "上传", "恢复", "定位"}),
)


def extract_diagram_keywords(content: str, limit: int = 10) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fffA-Za-z0-9]{2,}", content)
    counter: Counter[str] = Counter()

    for word in words:
        normalized = word.strip("，。；：、,.!?！？()（）[]【】")
        if len(normalized) < 2 or normalized in _STOPWORDS:
            continue
        if re.fullmatch(r"\d+", normalized):
            continue
        counter[normalized] += 1

    ranked = sorted(counter.items(), key=lambda item: (-item[1], -len(item[0]), item[0]))
    return [word for word, _count in ranked[:limit]]


def _category_for_keyword(keyword: str) -> tuple[str, str]:
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
            if line:
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


def build_keyword_diagram_ir(
    title: str,
    content: str,
    source_ids: list[str] | None = None,
    diagram_type: str = "flowchart",
    max_steps: int = 8,
) -> DiagramIR:
    source_ids = source_ids or []
    keywords = extract_diagram_keywords(content, limit=max_steps)
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
        for keyword in keywords or steps:
            category, label = _category_for_keyword(keyword)
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
                    source_ids=source_ids,
                    metadata={"category": category},
                )
            )
            edges.append(
                DiagramEdge(
                    source=category_nodes[category],
                    target=node_id,
                    relation="contains",
                )
            )

        return DiagramIR(
            title=title,
            objective="基于回答和引用内容提取关键词，生成可渲染的思维导图 IR。",
            diagram_type=diagram_type,
            layout_hint="radial",
            nodes=nodes,
            edges=edges,
            notes=[
                "关键词来自回答正文和引用摘要。",
                "类别节点用于前端形成中心放射式布局。",
            ],
            metadata={
                "source_count": len(source_ids),
                "keyword_count": len(keywords),
                "categories": list(category_nodes.keys()),
            },
        )

    previous_id = ""
    for index, step in enumerate(steps, 1):
        node_id = f"step-{index}"
        matched_keywords = [keyword for keyword in keywords if keyword in step]
        is_decision = bool(re.search(r"如果|若|是否|判断|异常|失败|否则", step))
        nodes.append(
            DiagramNode(
                id=node_id,
                label=step,
                kind="decision" if is_decision else "step",
                source_ids=source_ids,
                metadata={"keywords": matched_keywords},
            )
        )
        if previous_id:
            edges.append(
                DiagramEdge(
                    source=previous_id,
                    target=node_id,
                    relation="condition" if is_decision else "sequence",
                    label="判断" if is_decision else "",
                )
            )
        previous_id = node_id

    return DiagramIR(
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
        },
    )


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
