import { listNotesBySession } from "../db/chatNotes";
import { listKnowledgeGaps } from "../db/knowledgeGaps";

export interface KnowledgeDraftContextInput {
  sessionId: string;
  messageId: string;
  userId: string;
  metadata: Record<string, unknown>;
  question: string;
  answer: string;
  includeSessionNotes?: boolean;
}

export interface KnowledgeDraftContext {
  contextText: string;
  termText: string;
  noteText: string;
  noteIds: string[];
  failureClusterText: string;
  failureClusterIds: string[];
  metadata: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.map((item) => String(item))) : [];
}

function normalize(value: string): string {
  return value.replace(/[\s，,。.!！?？:：;；/\\-]+/g, "").toLowerCase();
}

function queryUnderstandingTerms(metadata: Record<string, unknown>): string[] {
  const understanding = isRecord(metadata.query_understanding) ? metadata.query_understanding : {};
  const query = isRecord(metadata.query) ? metadata.query : {};
  const terms = [
    stringValue(understanding.intent),
    stringValue(understanding.rewritten_query),
    stringValue(query.rewritten_question),
    ...arrayRecords(understanding.candidate_terms).flatMap((candidate) => [
      stringValue(candidate.term),
      stringValue(candidate.matched_text),
    ]),
    ...arrayRecords(understanding.spell_corrections).flatMap((candidate) => [
      stringValue(candidate.original),
      stringValue(candidate.correction),
    ]),
  ];
  return uniqueStrings(terms).slice(0, 16);
}

function confidence(metadata: Record<string, unknown>): number {
  const answerIrSummary = isRecord(metadata.answer_ir_summary) ? metadata.answer_ir_summary : {};
  return numberValue(metadata.confidence) ?? numberValue(answerIrSummary.confidence) ?? 0;
}

function draftSuggestionTerms(metadata: Record<string, unknown>): string[] {
  const suggestions = isRecord(metadata.draft_suggestions) ? metadata.draft_suggestions : {};
  return [
    ...arrayRecords(suggestions.term_candidates).flatMap((item) => [
      stringValue(item.canonical_term),
      ...arrayStrings(item.aliases),
      ...arrayStrings(item.retrieval_terms),
    ]),
    ...arrayRecords(suggestions.alias_candidates).flatMap((item) => [
      stringValue(item.canonical_term),
      stringValue(item.alias),
    ]),
    ...arrayRecords(suggestions.faq_drafts).flatMap((item) => [
      stringValue(item.question),
      ...arrayStrings(item.tags),
    ]),
    ...arrayRecords(suggestions.knowledge_card_drafts).flatMap((item) => [
      stringValue(item.topic),
      ...arrayStrings(item.related_terms),
    ]),
  ];
}

function matchedFailureClusters(input: KnowledgeDraftContextInput, queryTerms: string[]) {
  const corpus = normalize(`${input.question} ${input.answer} ${queryTerms.join(" ")}`);
  return listKnowledgeGaps({ status: "draft_generated", pageSize: 50 }).items
    .map((gap) => {
      const metadata = isRecord(gap.metadata) ? gap.metadata : {};
      const terms = uniqueStrings([
        gap.title,
        gap.representative_question,
        ...draftSuggestionTerms(metadata),
      ]);
      const matched = terms.some((term) => {
        const normalized = normalize(term);
        return normalized.length >= 2 && corpus.includes(normalized);
      });
      return matched ? { id: gap.id, title: gap.title, terms } : null;
    })
    .filter((item): item is { id: string; title: string; terms: string[] } => Boolean(item))
    .slice(0, 6);
}

export function buildKnowledgeDraftContext(input: KnowledgeDraftContextInput): KnowledgeDraftContext {
  const queryTerms = queryUnderstandingTerms(input.metadata);
  const notes = listNotesBySession(input.sessionId, input.userId)
    .filter((note) =>
      note.scope === "message" && note.message_id === input.messageId ||
      note.scope === "source" && note.message_id === input.messageId ||
      input.includeSessionNotes && note.scope === "session"
    );
  const noteText = compactText(notes.map((note) => note.content).join("。"), 1200);
  const clusters = matchedFailureClusters(input, queryTerms);
  const failureClusterText = compactText(clusters.map((item) => `${item.title}：${item.terms.slice(0, 8).join("、")}`).join("。"), 1200);
  const highConfidenceAnswerText = confidence(input.metadata) >= 0.75 ? compactText(input.answer, 600) : "";
  const allTerms = uniqueStrings([
    ...queryTerms,
    ...clusters.flatMap((item) => item.terms),
  ]).slice(0, 24);

  return {
    contextText: [queryTerms.join("、"), noteText, failureClusterText, highConfidenceAnswerText].filter(Boolean).join("。"),
    termText: allTerms.join(" "),
    noteText,
    noteIds: notes.map((note) => note.id),
    failureClusterText,
    failureClusterIds: clusters.map((item) => item.id),
    metadata: {
      query_understanding_terms: queryTerms,
      manual_note_ids: notes.map((note) => note.id),
      failure_cluster_ids: clusters.map((item) => item.id),
      failure_cluster_count: clusters.length,
      high_confidence_answer_included: Boolean(highConfidenceAnswerText),
    },
  };
}
