import { listKnowledgeCards } from "../db/knowledgeCards";
import { listKnowledgeFaqs } from "../db/knowledgeFaqs";
import { listTerminologyTerms } from "../db/terminology";

export interface PublishedKnowledgeAssetContext {
  asset_type: "term" | "knowledge_card" | "faq";
  id: string;
  label: string;
  summary: string;
  retrieval_terms: string[];
  status: string;
  metadata?: Record<string, unknown>;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function matchesQuery(query: string, terms: string[]) {
  const normalizedQuery = normalize(query);
  return terms.some((term) => {
    const normalizedTerm = normalize(term);
    return normalizedTerm.length >= 2 && normalizedQuery.includes(normalizedTerm);
  });
}

export function buildPublishedKnowledgeAssetContext(query: string): PublishedKnowledgeAssetContext[] {
  const assets: PublishedKnowledgeAssetContext[] = [];

  for (const term of listTerminologyTerms({ status: "published" })) {
    const retrievalTerms = unique([
      term.canonical_term,
      term.abbreviation,
      ...(term.aliases ?? []),
      ...(term.synonyms ?? []),
      ...(term.retrieval_terms ?? []),
      ...(term.related_topics ?? []),
    ]);
    if (!matchesQuery(query, retrievalTerms)) continue;
    assets.push({
      asset_type: "term",
      id: term.id,
      label: term.canonical_term,
      summary: term.definition,
      retrieval_terms: retrievalTerms,
      status: term.status,
      metadata: { source: term.source },
    });
  }

  for (const card of listKnowledgeCards({ status: "published", pageSize: 40 }).items) {
    const retrievalTerms = unique([card.topic, ...(card.related_terms ?? [])]);
    if (!matchesQuery(query, retrievalTerms)) continue;
    assets.push({
      asset_type: "knowledge_card",
      id: card.id,
      label: card.topic,
      summary: card.summary,
      retrieval_terms: retrievalTerms,
      status: card.status,
      metadata: { source_count: card.source_refs.length, current_version: card.current_version },
    });
  }

  for (const faq of listKnowledgeFaqs({ status: "published", pageSize: 40 }).items) {
    const retrievalTerms = unique([faq.question, ...(faq.tags ?? [])]);
    if (!matchesQuery(query, retrievalTerms)) continue;
    assets.push({
      asset_type: "faq",
      id: faq.id,
      label: faq.question,
      summary: faq.answer,
      retrieval_terms: retrievalTerms,
      status: faq.status,
      metadata: { source_count: faq.source_refs.length, frequency_count: faq.frequency_count },
    });
  }

  return assets.slice(0, 12);
}
