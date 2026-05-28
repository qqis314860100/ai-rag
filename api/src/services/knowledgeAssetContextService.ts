import { listKnowledgeCards } from "../db/knowledgeCards";
import { listKnowledgeFaqs } from "../db/knowledgeFaqs";
import { listTerminologyTerms } from "../db/terminology";

export interface PublishedKnowledgeAssetContext {
  asset_type: "term" | "knowledge_card" | "faq";
  id: string;
  asset_id: string;
  version: number;
  label: string;
  summary: string;
  retrieval_terms: string[];
  match_type: "strong_term" | "semantic_candidate";
  match_terms: string[];
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
  return terms.filter((term) => {
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
    const strongTerms = unique([
      term.canonical_term,
      term.abbreviation,
      ...(term.aliases ?? []),
      ...(term.synonyms ?? []),
    ]);
    const matchTerms = matchesQuery(query, retrievalTerms);
    if (matchTerms.length === 0) continue;
    const strongMatchTerms = matchesQuery(query, strongTerms);
    assets.push({
      asset_type: "term",
      id: term.id,
      asset_id: term.id,
      version: typeof term.version === "number" ? term.version : 1,
      label: term.canonical_term,
      summary: term.definition,
      retrieval_terms: retrievalTerms,
      match_type: strongMatchTerms.length > 0 ? "strong_term" : "semantic_candidate",
      match_terms: strongMatchTerms.length > 0 ? strongMatchTerms : matchTerms,
      status: term.status,
      metadata: {
        source: term.source,
        asset_id: term.id,
        asset_version: typeof term.version === "number" ? term.version : 1,
        match_type: strongMatchTerms.length > 0 ? "strong_term" : "semantic_candidate",
      },
    });
  }

  for (const card of listKnowledgeCards({ status: "published", pageSize: 40 }).items) {
    const retrievalTerms = unique([card.topic, ...(card.related_terms ?? [])]);
    const matchTerms = matchesQuery(query, retrievalTerms);
    if (matchTerms.length === 0) continue;
    assets.push({
      asset_type: "knowledge_card",
      id: card.id,
      asset_id: card.id,
      version: card.current_version ?? 1,
      label: card.topic,
      summary: card.summary,
      retrieval_terms: retrievalTerms,
      match_type: "semantic_candidate",
      match_terms: matchTerms,
      status: card.status,
      metadata: {
        source_count: card.source_refs.length,
        current_version: card.current_version,
        asset_id: card.id,
        asset_version: card.current_version ?? 1,
        match_type: "semantic_candidate",
      },
    });
  }

  for (const faq of listKnowledgeFaqs({ status: "published", pageSize: 40 }).items) {
    const retrievalTerms = unique([faq.question, ...(faq.tags ?? [])]);
    const matchTerms = matchesQuery(query, retrievalTerms);
    if (matchTerms.length === 0) continue;
    assets.push({
      asset_type: "faq",
      id: faq.id,
      asset_id: faq.id,
      version: 1,
      label: faq.question,
      summary: faq.answer,
      retrieval_terms: retrievalTerms,
      match_type: "semantic_candidate",
      match_terms: matchTerms,
      status: faq.status,
      metadata: {
        source_count: faq.source_refs.length,
        frequency_count: faq.frequency_count,
        asset_id: faq.id,
        asset_version: 1,
        match_type: "semantic_candidate",
      },
    });
  }

  return assets.slice(0, 12);
}
