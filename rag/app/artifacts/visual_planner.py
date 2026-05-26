from __future__ import annotations

import re
from typing import Any, Mapping

from ..schemas.models import AnswerWarning, VisualArtifactPlan, VisualPlan


MIN_VISUAL_CONFIDENCE = 0.66
MAX_AUTO_ARTIFACTS = 1

_FLOW_PATTERN = re.compile(r"流程|步骤|先|再|然后|之后|最后|如果|是否|判断|异常|排查|处理|恢复|复测")
_MINDMAP_PATTERN = re.compile(r"有哪些|包括|包含|总结|整理|要点|分类|风险|原因|影响|方法|标准")
_CHART_PATTERN = re.compile(r"趋势|对比|比例|分布|统计|变化|指标|曲线|占比|同比|环比|数量|排行|Top", re.I)
_TABLE_PATTERN = re.compile(r"\|.+\||参数|阈值|范围|标准|对比|清单|\d+(?:\.\d+)?\s?(?:V|A|mA|MΩ|Ω|%|秒|s)")
_ARCH_PATTERN = re.compile(r"架构|系统|模块|链路|接口|数据流|服务|组件")
_IMAGE_PATTERN = re.compile(r"图片|示意图|生成图|文生图|画一张|可视化海报")


def _source_id(source: Mapping[str, Any], index: int) -> str:
    return str(source.get("id") or source.get("chunk_id") or f"source-{index}")


def _source_ids(sources: list[Mapping[str, Any]]) -> list[str]:
    ids: list[str] = []
    for index, source in enumerate(sources, 1):
        source_id = _source_id(source, index)
        if source_id and source_id not in ids:
            ids.append(source_id)
    return ids


def _score(base: float, confidence: float, has_sources: bool) -> float:
    source_bonus = 0.08 if has_sources else 0
    return round(max(0.0, min(1.0, base * 0.55 + confidence * 0.37 + source_bonus)), 2)


def _plan(
    type: str,
    title: str,
    reason: str,
    confidence: float,
    priority: int,
    source_ids: list[str],
    auto_generate: bool,
    metadata: dict[str, Any] | None = None,
) -> VisualArtifactPlan:
    return VisualArtifactPlan(
        type=type,
        title=title[:48],
        reason=reason,
        confidence=confidence,
        priority=priority,
        source_ids=source_ids,
        auto_generate=auto_generate,
        metadata=metadata or {},
    )


def plan_visual_artifacts(
    *,
    question: str,
    answer: str,
    sources: list[Mapping[str, Any]],
    confidence: float,
    answer_status: str = "answered",
) -> VisualPlan:
    text = f"{question}\n{answer}"
    source_ids = _source_ids(sources)
    warnings: list[AnswerWarning] = []

    if answer_status == "insufficient_context" or confidence < MIN_VISUAL_CONFIDENCE or not source_ids:
        warnings.append(AnswerWarning(
            code="visual_plan_not_ready",
            message="回答证据或置信度不足，暂不自动生成可视化产物。",
            severity="info",
        ))
        return VisualPlan(
            can_generate=False,
            warnings=warnings,
            metadata={
                "answer_status": answer_status,
                "confidence": confidence,
                "source_count": len(source_ids),
            },
        )

    plans: list[VisualArtifactPlan] = []
    has_sources = bool(source_ids)
    flow_hits = len(_FLOW_PATTERN.findall(text))
    mindmap_hits = len(_MINDMAP_PATTERN.findall(text))
    table_hits = len(_TABLE_PATTERN.findall(text))
    chart_hits = len(_CHART_PATTERN.findall(text))
    arch_hits = len(_ARCH_PATTERN.findall(text))
    image_hits = len(_IMAGE_PATTERN.findall(question))

    if flow_hits >= 2:
        score = _score(min(1.0, 0.58 + flow_hits * 0.08), confidence, has_sources)
        plans.append(_plan(
            "flowchart",
            "流程图",
            "问题或回答包含顺序、判断或异常处理信号，适合生成流程图。",
            score,
            92,
            source_ids,
            score >= 0.72,
            {"signals": {"flow_hits": flow_hits}},
        ))

    if mindmap_hits >= 1 or len(answer) >= 180:
        score = _score(min(1.0, 0.55 + mindmap_hits * 0.08), confidence, has_sources)
        plans.append(_plan(
            "mindmap",
            "思维导图",
            "回答包含多类要点或概念归纳，适合生成思维导图。",
            score,
            84,
            source_ids,
            score >= 0.72,
            {"signals": {"mindmap_hits": mindmap_hits, "answer_length": len(answer)}},
        ))

    if arch_hits >= 2:
        score = _score(min(1.0, 0.55 + arch_hits * 0.07), confidence, has_sources)
        plans.append(_plan(
            "diagram",
            "架构图",
            "问题或回答包含系统、接口、模块或数据流信号，适合生成架构图。",
            score,
            78,
            source_ids,
            False,
            {"signals": {"architecture_hits": arch_hits}, "requires_renderer": "excalidraw", "subtype": "architecture"},
        ))

    if chart_hits >= 2:
        score = _score(min(1.0, 0.54 + chart_hits * 0.06), confidence, has_sources)
        plans.append(_plan(
            "chart",
            "图表",
            "回答包含趋势、对比或统计信号，适合生成图表。",
            score,
            76,
            source_ids,
            False,
            {"signals": {"chart_hits": chart_hits}, "requires_renderer": "echarts"},
        ))

    if table_hits >= 2:
        score = _score(min(1.0, 0.50 + table_hits * 0.06), confidence, has_sources)
        plans.append(_plan(
            "table",
            "对照表",
            "回答包含参数、阈值、标准或 Markdown 表格信号，适合生成结构化表格。",
            score,
            70,
            source_ids,
            False,
            {"signals": {"table_hits": table_hits}, "requires_renderer": "table"},
        ))

    if image_hits >= 1:
        plans.append(_plan(
            "image",
            "示意图",
            "用户明确提到图片或示意图，可进入受控图片产物链路。",
            round(min(confidence, 0.82), 2),
            60,
            source_ids,
            False,
            {"requires_contract": "image_artifact"},
        ))

    plans.sort(key=lambda item: (-item.priority, -item.confidence))
    auto_remaining = MAX_AUTO_ARTIFACTS
    normalized_plans: list[VisualArtifactPlan] = []
    for plan in plans:
        if plan.auto_generate and auto_remaining > 0:
            auto_remaining -= 1
            normalized_plans.append(plan)
            continue
        normalized_plans.append(plan.model_copy(update={"auto_generate": False}))

    return VisualPlan(
        can_generate=any(plan.auto_generate for plan in normalized_plans),
        artifacts=normalized_plans,
        warnings=warnings,
        metadata={
            "confidence": confidence,
            "source_count": len(source_ids),
            "signal_counts": {
                "flow": flow_hits,
                "mindmap": mindmap_hits,
                "chart": chart_hits,
                "table": table_hits,
                "architecture": arch_hits,
                "image": image_hits,
            },
        },
    )
