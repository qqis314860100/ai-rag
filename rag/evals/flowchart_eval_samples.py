from __future__ import annotations

from typing import Any, TypedDict


class FlowchartEvalSample(TypedDict):
    id: str
    title: str
    dimensions: tuple[str, ...]
    question: str
    answer: str
    sources: tuple[dict[str, str], ...]
    structured_output: dict[str, Any]
    expectations: dict[str, Any]


REQUIRED_FLOWCHART_EVAL_DIMENSIONS = frozenset(
    {
        "linear_sop",
        "branch_decision",
        "exception_retry",
        "review_publish",
        "multi_role_collaboration",
        "low_information_refusal",
    }
)


FLOWCHART_EVAL_SAMPLES: tuple[FlowchartEvalSample, ...] = (
    {
        "id": "linear_sop_ocv_test",
        "title": "OCV 线性测试 SOP",
        "dimensions": ("linear_sop",),
        "question": "OCV 测试的标准执行顺序是什么？",
        "answer": (
            "OCV 测试先接收待测电芯批次并扫描条码，再导入测试参数，随后执行开路电压测量，"
            "测量完成后上传结果并结束归档。"
        ),
        "sources": (
            {
                "source_id": "flow-linear-1",
                "title": "电芯 OCV 测试 SOP",
                "section": "3.1 测试准备",
                "snippet": "测试前扫描电芯批次条码，并从 MES 导入 OCV 测试参数。",
            },
            {
                "source_id": "flow-linear-2",
                "title": "电芯 OCV 测试 SOP",
                "section": "3.2 结果上传",
                "snippet": "开路电压测量完成后，测试结果应上传 MES 并完成归档。",
            },
        ),
        "structured_output": {
            "title": "OCV 线性测试 SOP",
            "objective": "验证无分支 SOP 可生成自上而下主线流程。",
            "type": "flowchart",
            "layout_hint": "top_to_bottom",
            "flow_semantics": {
                "roles": [],
                "actions": ["扫描条码", "导入参数", "执行测量", "上传归档"],
                "decisions": [],
                "branches": [],
                "loops": [],
                "final_results": ["测试结果上传归档"],
            },
            "nodes": [
                {"id": "receive", "label": "接收待测批次", "kind": "start", "source_ids": ["flow-linear-1"]},
                {"id": "scan", "label": "扫描电芯条码", "kind": "input", "source_ids": ["flow-linear-1"]},
                {"id": "measure", "label": "执行 OCV 测量", "kind": "action", "source_ids": ["flow-linear-1"]},
                {"id": "upload", "label": "上传测试结果", "kind": "output", "source_ids": ["flow-linear-2"]},
                {"id": "archive", "label": "结束归档", "kind": "end", "source_ids": ["flow-linear-2"]},
            ],
            "edges": [
                {"source": "receive", "target": "scan", "relation": "sequence"},
                {"source": "scan", "target": "measure", "relation": "sequence"},
                {"source": "measure", "target": "upload", "relation": "sequence"},
                {"source": "upload", "target": "archive", "relation": "sequence"},
            ],
            "notes": ["线性 SOP 不应强行生成 decision 节点。"],
            "confidence": 0.9,
        },
        "expectations": {
            "can_generate": True,
            "min_quality_score": 0.9,
            "required_node_kinds": ("start", "input", "action", "output", "end"),
            "required_edge_relations": ("sequence",),
        },
    },
    {
        "id": "branch_decision_insulation",
        "title": "绝缘测试分支判断",
        "dimensions": ("branch_decision",),
        "question": "绝缘电阻不达标时流程怎么走？",
        "answer": (
            "绝缘测试完成后判断电阻是否不低于阈值。合格时记录结果并放行；不合格时隔离模组，"
            "转入异常复核子流程。"
        ),
        "sources": (
            {
                "source_id": "flow-branch-1",
                "title": "模组绝缘测试规范",
                "section": "4.2 合格判定",
                "snippet": "测试完成后应判断绝缘电阻是否达到规定阈值。",
            },
            {
                "source_id": "flow-branch-2",
                "title": "模组绝缘测试规范",
                "section": "4.3 异常处置",
                "snippet": "绝缘电阻不合格时隔离模组，并进入异常复核流程。",
            },
        ),
        "structured_output": {
            "title": "绝缘测试分支判断",
            "objective": "验证 decision 节点和通过/不通过分支标签。",
            "type": "flowchart",
            "layout_hint": "top_to_bottom",
            "flow_semantics": {
                "roles": [],
                "actions": ["执行绝缘测试", "记录结果", "隔离模组"],
                "decisions": ["绝缘电阻是否合格"],
                "branches": ["合格放行", "不合格隔离复核"],
                "loops": [],
                "final_results": ["放行或进入异常复核"],
            },
            "nodes": [
                {"id": "test", "label": "执行绝缘测试", "kind": "action", "source_ids": ["flow-branch-1"]},
                {"id": "judge", "label": "绝缘电阻是否合格", "kind": "decision", "source_ids": ["flow-branch-1"]},
                {"id": "pass", "label": "记录结果并放行", "kind": "output", "source_ids": ["flow-branch-1"]},
                {"id": "isolate", "label": "隔离并异常复核", "kind": "subflow", "source_ids": ["flow-branch-2"]},
            ],
            "edges": [
                {"source": "test", "target": "judge", "relation": "condition", "label": "完成测试"},
                {"source": "judge", "target": "pass", "relation": "condition", "label": "合格"},
                {"source": "judge", "target": "isolate", "relation": "fallback", "label": "不合格"},
            ],
            "notes": ["分支边必须带业务结果标签。"],
            "confidence": 0.88,
        },
        "expectations": {
            "can_generate": True,
            "min_quality_score": 0.9,
            "required_node_kinds": ("decision", "subflow", "output"),
            "required_edge_relations": ("condition", "fallback"),
            "decision_labels": ("合格", "不合格"),
        },
    },
    {
        "id": "exception_retry_dcr",
        "title": "DCR 异常重试闭环",
        "dimensions": ("exception_retry",),
        "question": "DCR 偏差异常时如何复测？",
        "answer": (
            "DCR 采集后先判断偏差是否在 ±5% 内。正常则记录结果；异常时复核探针接触力并重新采集，"
            "复测仍异常再升级设备工程师处理。"
        ),
        "sources": (
            {
                "source_id": "flow-retry-1",
                "title": "DCR 测试异常处理",
                "section": "2.1 偏差判断",
                "snippet": "DCR 偏差超过 ±5% 时，应先复核探针接触力并重新采集。",
            },
            {
                "source_id": "flow-retry-2",
                "title": "DCR 测试异常处理",
                "section": "2.2 升级处理",
                "snippet": "复测仍异常时记录报警代码，并升级设备工程师排查采集模块。",
            },
        ),
        "structured_output": {
            "title": "DCR 异常重试闭环",
            "objective": "验证异常 fallback 与重试 loop 语义。",
            "type": "flowchart",
            "layout_hint": "top_to_bottom",
            "flow_semantics": {
                "roles": [],
                "actions": ["采集 DCR", "复核探针接触力", "重新采集", "升级排查"],
                "decisions": ["偏差是否正常"],
                "branches": ["正常记录", "异常复核重试"],
                "loops": ["复核后重新采集"],
                "final_results": ["记录结果或升级处理"],
            },
            "nodes": [
                {"id": "collect", "label": "采集 DCR 数据", "kind": "action", "source_ids": ["flow-retry-1"]},
                {"id": "judge", "label": "偏差是否在 ±5% 内", "kind": "decision", "source_ids": ["flow-retry-1"]},
                {"id": "record", "label": "记录正常结果", "kind": "output", "source_ids": ["flow-retry-1"]},
                {"id": "probe", "label": "复核探针接触力", "kind": "action", "source_ids": ["flow-retry-1"]},
                {"id": "escalate", "label": "升级设备工程师", "kind": "subflow", "source_ids": ["flow-retry-2"]},
            ],
            "edges": [
                {"source": "collect", "target": "judge", "relation": "condition", "label": "采集完成"},
                {"source": "judge", "target": "record", "relation": "condition", "label": "正常"},
                {"source": "judge", "target": "probe", "relation": "fallback", "label": "异常"},
                {"source": "probe", "target": "collect", "relation": "loop", "label": "复核后重新采集"},
                {"source": "probe", "target": "escalate", "relation": "fallback", "label": "复测仍异常"},
            ],
            "notes": ["loop 边必须写清回流条件。"],
            "confidence": 0.87,
        },
        "expectations": {
            "can_generate": True,
            "min_quality_score": 0.9,
            "required_node_kinds": ("decision", "subflow"),
            "required_edge_relations": ("condition", "fallback", "loop"),
            "loop_labels": ("复核后重新采集",),
        },
    },
    {
        "id": "review_publish_quality_record",
        "title": "质量记录审核发布",
        "dimensions": ("review_publish",),
        "question": "质量记录从提交到发布如何审核？",
        "answer": (
            "操作员提交质量记录后，审核员检查记录完整性。通过则发布为受控记录并归档；不通过则退回补正，"
            "补正后重新提交审核。"
        ),
        "sources": (
            {
                "source_id": "flow-review-1",
                "title": "质量记录管理规范",
                "section": "5.1 提交审核",
                "snippet": "操作员提交记录后，审核员应检查记录完整性和附件一致性。",
            },
            {
                "source_id": "flow-review-2",
                "title": "质量记录管理规范",
                "section": "5.2 发布归档",
                "snippet": "审核通过的记录发布为受控记录；不通过的记录退回补正后重新审核。",
            },
        ),
        "structured_output": {
            "title": "质量记录审核发布",
            "objective": "验证审核、发布和退回补正闭环。",
            "type": "flowchart",
            "layout_hint": "top_to_bottom",
            "flow_semantics": {
                "roles": [],
                "actions": ["提交记录", "检查完整性", "补正记录", "发布归档"],
                "decisions": ["审核是否通过"],
                "branches": ["通过发布", "不通过补正"],
                "loops": ["补正后重新审核"],
                "final_results": ["受控记录发布归档"],
            },
            "nodes": [
                {"id": "submit", "label": "提交质量记录", "kind": "start", "source_ids": ["flow-review-1"]},
                {"id": "review", "label": "审核是否通过", "kind": "decision", "source_ids": ["flow-review-1"]},
                {"id": "fix", "label": "退回并补正记录", "kind": "action", "source_ids": ["flow-review-2"]},
                {"id": "publish", "label": "发布受控记录", "kind": "output", "source_ids": ["flow-review-2"]},
                {"id": "archive", "label": "归档完成", "kind": "end", "source_ids": ["flow-review-2"]},
            ],
            "edges": [
                {"source": "submit", "target": "review", "relation": "condition", "label": "提交后"},
                {"source": "review", "target": "publish", "relation": "condition", "label": "通过"},
                {"source": "review", "target": "fix", "relation": "fallback", "label": "不通过"},
                {"source": "fix", "target": "review", "relation": "loop", "label": "补正后复审"},
                {"source": "publish", "target": "archive", "relation": "sequence"},
            ],
            "notes": ["审核发布场景必须保留通过/不通过分支。"],
            "confidence": 0.89,
        },
        "expectations": {
            "can_generate": True,
            "min_quality_score": 0.9,
            "required_node_kinds": ("start", "decision", "output", "end"),
            "required_edge_relations": ("condition", "fallback", "loop", "sequence"),
            "decision_labels": ("通过", "不通过"),
        },
    },
    {
        "id": "multi_role_collaboration_alarm",
        "title": "多角色异常协作",
        "dimensions": ("multi_role_collaboration",),
        "question": "产线报警需要哪些角色协同处理？",
        "answer": (
            "操作员先记录报警并隔离工位，设备工程师复位采集模块，工艺工程师确认参数窗口。"
            "质量工程师判断是否放行；不通过则回到工艺确认，确认通过后 MES 记录关闭。"
        ),
        "sources": (
            {
                "source_id": "flow-role-1",
                "title": "产线报警协作规范",
                "section": "6.1 现场隔离",
                "snippet": "操作员记录报警并隔离工位，设备工程师负责复位采集模块。",
            },
            {
                "source_id": "flow-role-2",
                "title": "产线报警协作规范",
                "section": "6.2 放行关闭",
                "snippet": "工艺工程师确认参数窗口后，质量工程师判定是否放行，通过后 MES 关闭记录。",
            },
        ),
        "structured_output": {
            "title": "多角色异常协作",
            "objective": "验证泳道、角色归属和跨角色流程。",
            "type": "flowchart",
            "layout_hint": "top_to_bottom",
            "flow_semantics": {
                "roles": ["操作员", "设备工程师", "工艺工程师", "质量工程师", "MES"],
                "actions": ["记录报警", "复位模块", "确认参数", "判定放行", "关闭记录"],
                "decisions": ["是否允许放行"],
                "branches": ["允许放行", "不允许放行"],
                "loops": ["不允许放行回到工艺确认"],
                "final_results": ["报警记录关闭"],
            },
            "lanes": [
                {"id": "operator", "label": "操作员"},
                {"id": "equipment", "label": "设备工程师"},
                {"id": "process", "label": "工艺工程师"},
                {"id": "quality", "label": "质量工程师"},
                {"id": "mes", "label": "MES"},
            ],
            "nodes": [
                {"id": "alarm", "label": "记录报警并隔离", "kind": "start", "source_ids": ["flow-role-1"], "lane_id": "operator"},
                {"id": "reset", "label": "复位采集模块", "kind": "action", "source_ids": ["flow-role-1"], "lane_id": "equipment"},
                {"id": "window", "label": "确认参数窗口", "kind": "action", "source_ids": ["flow-role-2"], "lane_id": "process"},
                {"id": "release", "label": "是否允许放行", "kind": "decision", "source_ids": ["flow-role-2"], "lane_id": "quality"},
                {"id": "close", "label": "关闭报警记录", "kind": "end", "source_ids": ["flow-role-2"], "lane_id": "mes"},
            ],
            "edges": [
                {"source": "alarm", "target": "reset", "relation": "sequence"},
                {"source": "reset", "target": "window", "relation": "sequence"},
                {"source": "window", "target": "release", "relation": "condition", "label": "参数确认后"},
                {"source": "release", "target": "close", "relation": "condition", "label": "允许放行"},
                {"source": "release", "target": "window", "relation": "loop", "label": "不允许放行，重新确认"},
            ],
            "notes": ["涉及两个以上角色时必须输出 lanes 和 lane_id。"],
            "confidence": 0.9,
        },
        "expectations": {
            "can_generate": True,
            "min_quality_score": 0.9,
            "required_node_kinds": ("start", "action", "decision", "end"),
            "required_edge_relations": ("sequence", "condition", "loop"),
            "lanes": ("操作员", "设备工程师", "工艺工程师", "质量工程师", "MES"),
        },
    },
    {
        "id": "low_information_refusal",
        "title": "低信息拒绝生成",
        "dimensions": ("low_information_refusal",),
        "question": "这个帮我画个流程？",
        "answer": "当前问题和回答没有提供可排序步骤、判断条件、异常分支或最终结果，无法可靠生成流程图。",
        "sources": (),
        "structured_output": {
            "title": "低信息拒绝生成",
            "objective": "验证低信息内容不强行出图。",
            "type": "flowchart",
            "layout_hint": "top_to_bottom",
            "can_generate": False,
            "reason": "回答和引用证据不足以形成明确流程，本次不生成流程图。",
            "flow_semantics": {
                "roles": [],
                "actions": [],
                "decisions": [],
                "branches": [],
                "loops": [],
                "final_results": [],
            },
            "nodes": [],
            "edges": [],
            "notes": ["低信息拒绝生成"],
            "confidence": 0.18,
        },
        "expectations": {
            "can_generate": False,
            "required_node_kinds": (),
            "required_edge_relations": (),
            "structured_refusal": True,
        },
    },
)


def source_ids_for(sample: FlowchartEvalSample) -> list[str]:
    return [source["source_id"] for source in sample["sources"]]


def build_flowchart_eval_content(sample: FlowchartEvalSample) -> str:
    blocks = [f"回答正文：{sample['answer']}"]
    for index, source in enumerate(sample["sources"], start=1):
        blocks.append(
            "\n".join(
                [
                    f"[引用 {index}]",
                    f"文档：{source['title']}",
                    f"章节：{source['section']}",
                    f"片段：{source['snippet']}",
                ]
            )
        )
    return "\n\n".join(blocks)
