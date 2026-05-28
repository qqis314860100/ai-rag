ALLOWED_DIAGRAM_TYPES = {"mindmap", "flowchart", "graph"}
FLOWCHART_NODE_KINDS = {"start", "end", "input", "output", "step", "action", "decision", "subflow"}
FLOWCHART_EVIDENCE_NODE_KINDS = (FLOWCHART_NODE_KINDS - {"start", "end"}) | {"topic", "equipment", "parameter", "risk"}
ALLOWED_NODE_KINDS = {
    "root",
    "category",
    "keyword",
    "evidence",
    *FLOWCHART_NODE_KINDS,
    "topic",
    "equipment",
    "parameter",
    "risk",
}
ALLOWED_EDGE_RELATIONS = {"contains", "supported_by", "sequence", "condition", "loop", "fallback", "flows_to", "relates_to"}
STRUCTURED_OUTPUT_FORMAT = {"type": "json_object"}
