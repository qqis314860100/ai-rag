import { getDb } from "../db";
import { listKnowledgeCards } from "../db/knowledgeCards";
import { listKnowledgeFaqs } from "../db/knowledgeFaqs";

function documentStatusById() {
  const rows = getDb()
    .prepare("SELECT id, title, status, index_status, deleted_at FROM documents")
    .all() as Array<{ id: string; title: string; status: string; index_status: string; deleted_at: string | null }>;
  return new Map(rows.map((row) => [row.id, row]));
}

function sourceRefKey(source: { document_id?: string; title?: string; chunk_id?: string }) {
  return source.document_id || source.title || source.chunk_id || "";
}

export function buildKnowledgeGovernanceView() {
  const cards = listKnowledgeCards({ pageSize: 100 }).items;
  const faqs = listKnowledgeFaqs({ pageSize: 100 }).items;
  const docs = documentStatusById();
  const citationCount = new Map<string, { label: string; count: number; kind: "knowledge_card" | "faq" }>();

  for (const faq of faqs) {
    for (const cardId of faq.related_card_ids ?? []) {
      const current = citationCount.get(cardId) || { label: cardId, count: 0, kind: "knowledge_card" as const };
      current.count += Math.max(1, faq.frequency_count);
      citationCount.set(cardId, current);
    }
  }

  const pending = cards
    .filter((card) => card.status === "pending_review" || card.status === "ai_draft" || card.status === "returned")
    .slice(0, 20)
    .map((card) => ({
      id: card.id,
      kind: "knowledge_card",
      title: card.topic,
      status: card.status,
      evidence_count: card.source_refs.length,
      updated_at: card.updated_at,
    }));

  const lowEvidence = [
    ...cards
      .filter((card) => card.source_refs.length === 0)
      .map((card) => ({ id: card.id, kind: "knowledge_card", title: card.topic, status: card.status, evidence_count: 0 })),
    ...faqs
      .filter((faq) => faq.source_refs.length === 0)
      .map((faq) => ({ id: faq.id, kind: "faq", title: faq.question, status: faq.status, evidence_count: 0 })),
  ].slice(0, 20);

  const expiredSources = [
    ...cards.flatMap((card) =>
      (card.source_refs ?? []).map((source) => ({ owner_id: card.id, owner_title: card.topic, owner_kind: "knowledge_card", source }))
    ),
    ...faqs.flatMap((faq) =>
      (faq.source_refs ?? []).map((source) => ({ owner_id: faq.id, owner_title: faq.question, owner_kind: "faq", source }))
    ),
  ]
    .filter((item) => {
      const key = sourceRefKey(item.source);
      const doc = item.source.document_id ? docs.get(item.source.document_id) : null;
      return !key || !doc || doc.status !== "active" || doc.index_status !== "ready" || Boolean(doc.deleted_at);
    })
    .slice(0, 20)
    .map((item) => ({
      owner_id: item.owner_id,
      owner_kind: item.owner_kind,
      owner_title: item.owner_title,
      source_id: sourceRefKey(item.source),
      source_title: item.source.title || item.source.document_id || item.source.chunk_id || "缺失来源",
    }));

  const frequentCards = cards
    .map((card) => {
      const referenced = citationCount.get(card.id)?.count ?? 0;
      const sourceReuse = faqs.filter((faq) => faq.answer.includes(card.topic) || faq.question.includes(card.topic)).length;
      return {
        id: card.id,
        title: card.topic,
        status: card.status,
        usage_count: referenced + sourceReuse,
        evidence_count: card.source_refs.length,
      };
    })
    .filter((item) => item.usage_count > 0)
    .sort((a, b) => b.usage_count - a.usage_count)
    .slice(0, 12);

  const riskReview = cards
    .flatMap((card) =>
      (card.risks ?? [])
        .filter((risk) => risk.level === "high" || risk.level === "critical" || card.status !== "published")
        .map((risk) => ({
          card_id: card.id,
          title: card.topic,
          status: card.status,
          risk_title: risk.title,
          risk_level: risk.level || "medium",
          evidence_count: card.source_refs.length,
        }))
    )
    .slice(0, 20);

  return {
    schema_version: "knowledge-governance/v1",
    summary: {
      pending_count: pending.length,
      low_evidence_count: lowEvidence.length,
      expired_source_count: expiredSources.length,
      frequent_card_count: frequentCards.length,
      risk_review_count: riskReview.length,
    },
    pending,
    low_evidence: lowEvidence,
    expired_sources: expiredSources,
    frequent_cards: frequentCards,
    risk_review: riskReview,
  };
}
