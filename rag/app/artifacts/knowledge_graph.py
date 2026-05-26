from __future__ import annotations

import re
from typing import Any

KEYWORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fff]{2,}")
RISK_RE = re.compile(r"(风险|异常|失效|报警|偏差|超限|冲突|不合格|禁止)")
HANDLING_RE = re.compile(r"(处理|检查|复核|调整|隔离|通知|记录|确认|排查|复测|更换|校准)")
PROCESS_RE = re.compile(r"(先|再|然后|随后|最后|流程|步骤|执行|上传|确认)")
PARAMETER_RE = re.compile(r"([A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fff]{2,12})\s*(?:[:：=]|为|是|不低于|低于|范围为|应为)\s*([0-9]+(?:\.[0-9]+)?\s*[A-Za-z%Ωμ℃°-]*)")


def _compact(text: str, limit: int = 80) -> str:
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _node_id(kind: str, label: str) -> str:
    normalized = re.sub(r"\s+", "-", label.strip().lower())
    return f"{kind}:{normalized[:60]}"


def _add_node(nodes: dict[str, dict[str, Any]], kind: str, label: str, weight: float = 0.5, **metadata: Any) -> str:
    node_id = _node_id(kind, label)
    if not label:
        return node_id
    existing = nodes.get(node_id)
    if existing:
        existing["weight"] = max(existing["weight"], weight)
        existing["metadata"].update({key: value for key, value in metadata.items() if value not in (None, "", [])})
    else:
        nodes[node_id] = {
            "id": node_id,
            "type": kind,
            "label": _compact(label, 80),
            "weight": weight,
            "metadata": {key: value for key, value in metadata.items() if value not in (None, "", [])},
        }
    return node_id


def _add_edge(edges: dict[str, dict[str, Any]], source: str, target: str, relation: str, weight: float = 0.5, evidence: str = "") -> None:
    if not source or not target or source == target:
        return
    edge_id = f"{source}->{relation}->{target}"
    if edge_id in edges:
        edges[edge_id]["weight"] = max(edges[edge_id]["weight"], weight)
        return
    edges[edge_id] = {
        "id": edge_id,
        "source": source,
        "target": target,
        "type": relation,
        "weight": weight,
        "evidence": _compact(evidence, 140),
    }


def _keywords(text: str, limit: int = 18) -> list[str]:
    seen: dict[str, int] = {}
    for raw in KEYWORD_RE.findall(text):
        if len(raw) < 2:
            continue
        seen[raw] = seen.get(raw, 0) + 1
    return [item for item, _ in sorted(seen.items(), key=lambda kv: (-kv[1], len(kv[0])))[:limit]]


def _sentences(text: str) -> list[str]:
    return [_compact(part, 140) for part in re.split(r"[。！？!?；;\n]+", text) if _compact(part, 140)]


def build_lightweight_knowledge_graph(content: str, sources: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}
    sources = sources or []
    root = _add_node(nodes, "topic", _compact(content, 36) or "知识主题", 0.9)

    for keyword in _keywords(content):
        kind = "term"
        if RISK_RE.search(keyword):
            kind = "risk"
        elif HANDLING_RE.search(keyword):
            kind = "handling"
        elif PROCESS_RE.search(keyword):
            kind = "process"
        keyword_node = _add_node(nodes, kind, keyword, 0.55)
        _add_edge(edges, root, keyword_node, "mentions", 0.45)

    for name, value in PARAMETER_RE.findall(content):
        parameter_node = _add_node(nodes, "parameter", name, 0.65, value=value)
        _add_edge(edges, root, parameter_node, "has_parameter", 0.65, value)

    for sentence in _sentences(content):
        if RISK_RE.search(sentence):
            risk_node = _add_node(nodes, "risk", sentence, 0.62)
            _add_edge(edges, root, risk_node, "has_risk", 0.6, sentence)
        if HANDLING_RE.search(sentence):
            handling_node = _add_node(nodes, "handling", sentence, 0.58)
            _add_edge(edges, root, handling_node, "handles", 0.55, sentence)
        if PROCESS_RE.search(sentence):
            process_node = _add_node(nodes, "process", sentence, 0.55)
            _add_edge(edges, root, process_node, "has_step", 0.5, sentence)

    for index, source in enumerate(sources[:12]):
        label = str(source.get("document_title") or source.get("title") or source.get("document_id") or source.get("chunk_id") or f"来源 {index + 1}")
        doc_node = _add_node(nodes, "document", label, 0.5, document_id=source.get("document_id"), chunk_id=source.get("chunk_id"))
        _add_edge(edges, root, doc_node, "cites", 0.65, str(source.get("snippet") or source.get("content") or ""))

    return {
        "schema_version": "knowledge-graph/v1",
        "nodes": sorted(nodes.values(), key=lambda item: item["weight"], reverse=True),
        "edges": sorted(edges.values(), key=lambda item: item["weight"], reverse=True),
        "stats": {"node_count": len(nodes), "edge_count": len(edges), "source_count": len(sources)},
    }
