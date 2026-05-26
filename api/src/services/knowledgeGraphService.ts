import { getDb } from "../db";
import { listKnowledgeCards } from "../db/knowledgeCards";
import { listKnowledgeFaqs } from "../db/knowledgeFaqs";
import { listTerminologyTerms } from "../db/terminology";

type KnowledgeGraphNodeType = "topic" | "term" | "parameter" | "risk" | "process" | "exception" | "handling" | "document" | "faq" | "knowledge_card";
type KnowledgeGraphEdgeType = "mentions" | "defines" | "has_parameter" | "has_risk" | "has_step" | "handles" | "cites" | "relates_to" | "reuses";

interface KnowledgeGraphNode {
  id: string;
  type: KnowledgeGraphNodeType;
  label: string;
  summary?: string;
  status?: string;
  weight: number;
  metadata?: Record<string, unknown>;
}

interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  type: KnowledgeGraphEdgeType;
  weight: number;
  evidence?: string;
}

function nodeId(type: KnowledgeGraphNodeType, raw: string) {
  return `${type}:${raw.trim().toLowerCase().replace(/\s+/g, "-")}`;
}

function addNode(nodes: Map<string, KnowledgeGraphNode>, node: KnowledgeGraphNode) {
  const existing = nodes.get(node.id);
  if (existing) {
    existing.weight = Math.max(existing.weight, node.weight);
    existing.summary = existing.summary || node.summary;
    return;
  }
  nodes.set(node.id, node);
}

function addEdge(edges: Map<string, KnowledgeGraphEdge>, edge: Omit<KnowledgeGraphEdge, "id">) {
  if (edge.source === edge.target) return;
  const id = `${edge.source}->${edge.type}->${edge.target}`;
  const existing = edges.get(id);
  if (existing) {
    existing.weight = Math.max(existing.weight, edge.weight);
    existing.evidence = existing.evidence || edge.evidence;
    return;
  }
  edges.set(id, { id, ...edge });
}

function compactText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sourceTitle(source: { title?: string; document_id?: string; chunk_id?: string; section_path?: string }) {
  return source.title || source.section_path || source.document_id || source.chunk_id || "";
}

function listDocumentNodes() {
  return getDb()
    .prepare("SELECT id, title, category, process, station, index_status FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 80")
    .all() as Array<{ id: string; title: string; category: string; process: string | null; station: string | null; index_status: string }>;
}

export function buildKnowledgeGraph() {
  const nodes = new Map<string, KnowledgeGraphNode>();
  const edges = new Map<string, KnowledgeGraphEdge>();
  const terms = listTerminologyTerms({ status: "published" });
  const cards = listKnowledgeCards({ pageSize: 100 }).items;
  const faqResult = listKnowledgeFaqs({ pageSize: 100 });
  const faqs = faqResult.items;
  const docs = listDocumentNodes();

  for (const doc of docs) {
    addNode(nodes, {
      id: nodeId("document", doc.id),
      type: "document",
      label: doc.title,
      summary: [doc.category, doc.process, doc.station].filter(Boolean).join(" / "),
      status: doc.index_status,
      weight: 0.5,
      metadata: { document_id: doc.id },
    });
  }

  for (const term of terms) {
    const termNode = nodeId("term", term.canonical_term);
    addNode(nodes, {
      id: termNode,
      type: "term",
      label: term.canonical_term,
      summary: compactText(term.definition, 140),
      status: term.status,
      weight: 0.8,
      metadata: { aliases: term.aliases, synonyms: term.synonyms },
    });
    for (const topic of term.related_topics ?? []) {
      const topicNode = nodeId("topic", topic);
      addNode(nodes, { id: topicNode, type: "topic", label: topic, weight: 0.45 });
      addEdge(edges, { source: termNode, target: topicNode, type: "relates_to", weight: 0.5 });
    }
    for (const source of term.source_refs ?? []) {
      const title = sourceTitle(source);
      if (!title) continue;
      const docNode = nodeId("document", source.document_id || title);
      addNode(nodes, { id: docNode, type: "document", label: title, weight: 0.35, metadata: { document_id: source.document_id } });
      addEdge(edges, { source: termNode, target: docNode, type: "cites", weight: 0.4, evidence: source.section_path });
    }
  }

  for (const card of cards) {
    const cardNode = nodeId("knowledge_card", card.id);
    addNode(nodes, {
      id: cardNode,
      type: "knowledge_card",
      label: card.topic,
      summary: compactText(card.summary, 160),
      status: card.status,
      weight: card.status === "published" ? 0.9 : 0.55,
      metadata: { card_id: card.id, current_version: card.current_version },
    });
    for (const term of card.related_terms ?? []) {
      const termNode = nodeId("term", term);
      addNode(nodes, { id: termNode, type: "term", label: term, weight: 0.45 });
      addEdge(edges, { source: cardNode, target: termNode, type: "mentions", weight: 0.55 });
    }
    for (const parameter of card.key_parameters ?? []) {
      const label = parameter.name || parameter.value;
      if (!label) continue;
      const parameterNode = nodeId("parameter", label);
      addNode(nodes, { id: parameterNode, type: "parameter", label, summary: parameter.value || parameter.description, weight: 0.5 });
      addEdge(edges, { source: cardNode, target: parameterNode, type: "has_parameter", weight: 0.6 });
    }
    for (const risk of card.risks ?? []) {
      const riskNode = nodeId("risk", risk.title);
      addNode(nodes, { id: riskNode, type: "risk", label: risk.title, summary: risk.description, weight: 0.55, metadata: { level: risk.level } });
      addEdge(edges, { source: cardNode, target: riskNode, type: "has_risk", weight: 0.65 });
    }
    for (const step of card.steps ?? []) {
      const stepNode = nodeId("process", step.title);
      addNode(nodes, { id: stepNode, type: "process", label: step.title, summary: step.description, weight: 0.5, metadata: { order: step.order } });
      addEdge(edges, { source: cardNode, target: stepNode, type: "has_step", weight: 0.6 });
    }
    for (const method of card.handling_methods ?? []) {
      const methodNode = nodeId("handling", method.title);
      addNode(nodes, { id: methodNode, type: "handling", label: method.title, summary: method.description, weight: 0.5 });
      addEdge(edges, { source: cardNode, target: methodNode, type: "handles", weight: 0.6, evidence: method.related_risk });
    }
    for (const source of card.source_refs ?? []) {
      const title = sourceTitle(source);
      if (!title) continue;
      const docNode = nodeId("document", source.document_id || title);
      addNode(nodes, { id: docNode, type: "document", label: title, weight: 0.4, metadata: { document_id: source.document_id } });
      addEdge(edges, { source: cardNode, target: docNode, type: "cites", weight: 0.7, evidence: source.snippet });
    }
  }

  for (const faq of faqs) {
    const faqNode = nodeId("faq", faq.id);
    addNode(nodes, {
      id: faqNode,
      type: "faq",
      label: faq.question,
      summary: compactText(faq.answer, 160),
      status: faq.status,
      weight: Math.min(1, 0.45 + faq.frequency_count * 0.08),
      metadata: { faq_id: faq.id, frequency_count: faq.frequency_count },
    });
    for (const cardId of faq.related_card_ids ?? []) {
      const cardNode = nodeId("knowledge_card", cardId);
      addEdge(edges, { source: faqNode, target: cardNode, type: "reuses", weight: 0.7 });
    }
    for (const tag of faq.tags ?? []) {
      const termNode = nodeId("term", tag);
      addNode(nodes, { id: termNode, type: "term", label: tag, weight: 0.35 });
      addEdge(edges, { source: faqNode, target: termNode, type: "mentions", weight: 0.4 });
    }
    for (const condition of faq.invalid_conditions ?? []) {
      const exceptionNode = nodeId("exception", condition);
      addNode(nodes, { id: exceptionNode, type: "exception", label: condition, weight: 0.45 });
      addEdge(edges, { source: faqNode, target: exceptionNode, type: "has_risk", weight: 0.45 });
    }
    for (const source of faq.source_refs ?? []) {
      const title = sourceTitle(source);
      if (!title) continue;
      const docNode = nodeId("document", source.document_id || title);
      addNode(nodes, { id: docNode, type: "document", label: title, weight: 0.4, metadata: { document_id: source.document_id } });
      addEdge(edges, { source: faqNode, target: docNode, type: "cites", weight: 0.65, evidence: source.snippet });
    }
  }

  return {
    schema_version: "knowledge-graph/v1",
    nodes: Array.from(nodes.values()).sort((a, b) => b.weight - a.weight),
    edges: Array.from(edges.values()).sort((a, b) => b.weight - a.weight),
    stats: {
      node_count: nodes.size,
      edge_count: edges.size,
      term_count: terms.length,
      card_count: cards.length,
      faq_count: faqResult.total,
      document_count: docs.length,
    },
  };
}
