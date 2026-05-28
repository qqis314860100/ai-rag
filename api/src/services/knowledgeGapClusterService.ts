import {
  attachFailedQuestionsToGap,
  createKnowledgeGap,
  formatKnowledgeGap,
  getKnowledgeGapByKey,
  isKnowledgeGapSeverity,
  isKnowledgeGapType,
  listFailedQuestions,
  updateKnowledgeGap,
} from "../db/knowledgeGaps";
import { getDb } from "../db";
import type { ChatMessageRow } from "../db/chatMessages";
import { listMessagesBySession } from "../db/chatMessages";
import type { RetrievalEvidenceRef } from "../db/knowledgeGaps";
import { clusterKnowledgeGapDrafts } from "./rag/endpoints";
import type {
  RagFailedQuestionSignal,
  RagHighConfidenceAnswerSignal,
  RagKnowledgeGapClusterDraft,
  RagKnowledgeGapClusterResult,
  RagManualNoteSignal,
} from "./rag/types";

export interface KnowledgeGapClusterOptions {
  minFrequency?: number;
  maxClusters?: number;
  sampleLimit?: number;
  persist?: boolean;
  requestId?: string;
  userId?: string;
}

export interface PersistedKnowledgeGapCluster {
  cluster: RagKnowledgeGapClusterDraft;
  gap: ReturnType<typeof formatKnowledgeGap>;
  attached_failed_question_count: number;
}

export interface KnowledgeGapClusterServiceResult {
  schema_version: string;
  clusters: RagKnowledgeGapClusterDraft[];
  persisted: PersistedKnowledgeGapCluster[];
  ignored_count: number;
  metadata: Record<string, unknown>;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value as number)));
}

function toFailedQuestionSignal(item: Record<string, unknown>): RagFailedQuestionSignal {
  return {
    id: String(item.id || ""),
    question: String(item.question || ""),
    event_type: String(item.event_type || "refusal"),
    confidence: typeof item.confidence === "number" ? item.confidence : null,
    feedback_reason: String(item.feedback_reason || ""),
    feedback_comment: String(item.feedback_comment || ""),
    answer_snapshot: String(item.answer_snapshot || ""),
    query_understanding: Array.isArray(item.query_understanding) ? item.query_understanding as Array<Record<string, unknown>> : [],
    retrieval_evidence: Array.isArray(item.retrieval_evidence) ? item.retrieval_evidence as Array<Record<string, unknown>> : [],
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {},
    created_at: String(item.created_at || ""),
  };
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input || "") as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceIdentity(source: Record<string, unknown>): string {
  return stringValue(source.id) || stringValue(source.chunk_id) || stringValue(source.source_id);
}

function retrievalEvidenceFromSources(sources: unknown[]): Array<Record<string, unknown>> {
  return sources.filter(isRecord).slice(0, 8).map((source, index) => ({
    document_id: stringValue(source.document_id),
    chunk_id: stringValue(source.chunk_id) || sourceIdentity(source),
    source_id: sourceIdentity(source),
    title: stringValue(source.document_title) || stringValue(source.title),
    section_path: stringValue(source.section_path),
    snippet: stringValue(source.snippet) || stringValue(source.content).slice(0, 240),
    score: numberValue(source.score) ?? 0,
    rank: index + 1,
    retrieval_type: "hybrid",
  }));
}

function previousQuestion(assistantMessage: ChatMessageRow): string {
  const messages = listMessagesBySession(assistantMessage.session_id);
  const index = messages.findIndex((message) => message.id === assistantMessage.id);
  const previous = index >= 0 ? messages.slice(0, index) : messages;
  return previous.reverse().find((message) => message.role === "user")?.content ?? "";
}

function queryUnderstandingArray(metadata: Record<string, unknown>): Array<Record<string, unknown>> {
  const queryUnderstanding = isRecord(metadata.query_understanding) ? metadata.query_understanding : {};
  const query = isRecord(metadata.query) ? metadata.query : {};
  if (Object.keys(queryUnderstanding).length === 0 && Object.keys(query).length === 0) return [];
  return [{
    raw_query: stringValue(query.original_question) || stringValue(queryUnderstanding.original_query),
    rewritten_query: stringValue(query.rewritten_question) || stringValue(queryUnderstanding.rewritten_query),
    intent: stringValue(queryUnderstanding.intent),
    confidence: numberValue(queryUnderstanding.confidence) ?? numberValue(query.understanding_confidence) ?? 0,
    candidate_terms: Array.isArray(queryUnderstanding.candidate_terms) ? queryUnderstanding.candidate_terms : [],
    terms: Array.isArray(queryUnderstanding.candidate_terms)
      ? queryUnderstanding.candidate_terms
        .filter(isRecord)
        .map((item) => stringValue(item.term) || stringValue(item.matched_text))
        .filter(Boolean)
      : [],
    source: "answer_metadata",
  }];
}

function collectManualNotes(limit: number): RagManualNoteSignal[] {
  const rows = getDb()
    .prepare(
      `SELECT id, content, scope, session_id, message_id, source_id, document_id, chunk_id, metadata_json, created_at
       FROM chat_notes
       WHERE status = 'active'
       ORDER BY updated_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(Math.min(100, Math.max(0, limit))) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: stringValue(row.id),
    content: stringValue(row.content),
    scope: stringValue(row.scope),
    session_id: stringValue(row.session_id),
    message_id: stringValue(row.message_id) || null,
    source_id: stringValue(row.source_id) || null,
    document_id: stringValue(row.document_id) || null,
    chunk_id: stringValue(row.chunk_id) || null,
    metadata: parseJson<Record<string, unknown>>(String(row.metadata_json || "{}"), {}),
    created_at: stringValue(row.created_at),
  })).filter((item) => item.content);
}

function collectHighConfidenceAnswers(limit: number): RagHighConfidenceAnswerSignal[] {
  const rows = getDb()
    .prepare(
      `SELECT *
       FROM chat_messages
       WHERE role = 'assistant'
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(Math.min(200, Math.max(0, limit * 2))) as ChatMessageRow[];

  const results: RagHighConfidenceAnswerSignal[] = [];
  for (const row of rows) {
    const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
    const answerIrSummary = isRecord(metadata.answer_ir_summary) ? metadata.answer_ir_summary : {};
    const answerQuality = isRecord(metadata.answer_quality) ? metadata.answer_quality : {};
    const confidence = numberValue(metadata.confidence) ?? numberValue(answerIrSummary.confidence) ?? 0;
    const status = stringValue(answerIrSummary.status);
    if (confidence < 0.75 || (status && status !== "answered")) continue;
    if (stringValue(answerQuality.tier) === "refused") continue;

    const sources = parseJson<unknown[]>(row.sources_json, []);
    const evidence = retrievalEvidenceFromSources(sources);
    if (evidence.length === 0) continue;

    const query = isRecord(metadata.query) ? metadata.query : {};
    results.push({
      id: row.id,
      question: stringValue(query.rewritten_question) || stringValue(query.original_question) || previousQuestion(row),
      answer: row.content.slice(0, 2000),
      confidence,
      query_understanding: queryUnderstandingArray(metadata),
      retrieval_evidence: evidence,
      source_ids: evidence.map((item) => stringValue(item.source_id) || stringValue(item.chunk_id)).filter(Boolean),
      metadata: {
        source: "high_confidence_answer",
        session_id: row.session_id,
        answer_quality: answerQuality,
      },
      created_at: row.created_at,
    });
    if (results.length >= limit) break;
  }
  return results;
}

function normalizeClusterMetadata(cluster: RagKnowledgeGapClusterDraft, ragResult: RagKnowledgeGapClusterResult) {
  return {
    draft_suggestions: {
      schema_version: ragResult.schema_version ?? "knowledge-gap-cluster/v1",
      cluster_id: cluster.cluster_id,
      term_candidates: cluster.term_candidates ?? [],
      alias_candidates: cluster.alias_candidates ?? [],
      faq_drafts: cluster.faq_drafts ?? [],
      knowledge_card_drafts: cluster.knowledge_card_drafts ?? [],
      document_supplement_suggestions: cluster.document_supplement_suggestions ?? [],
      generated_at: new Date().toISOString(),
      generator: "rag.knowledge_gap_cluster_drafts",
    },
    cluster_metadata: cluster.metadata ?? {},
  };
}

function persistCluster(cluster: RagKnowledgeGapClusterDraft, ragResult: RagKnowledgeGapClusterResult): PersistedKnowledgeGapCluster {
  const failedQuestionIds = cluster.sample_failed_question_ids ?? [];
  const gapType = isKnowledgeGapType(cluster.gap_type) ? cluster.gap_type : "mixed";
  const severity = isKnowledgeGapSeverity(cluster.severity) ? cluster.severity : "medium";
  const retrievalEvidence = (cluster.retrieval_evidence ?? []) as RetrievalEvidenceRef[];
  const metadata = normalizeClusterMetadata(cluster, ragResult);
  const existing = getKnowledgeGapByKey(cluster.normalized_key);

  const row = existing
    ? updateKnowledgeGap(existing.id, {
        title: cluster.title,
        representativeQuestion: cluster.representative_question,
        gapType,
        status: "draft_generated",
        severity,
        frequencyCount: cluster.frequency_count,
        sampleFailedQuestionIds: failedQuestionIds,
        retrievalEvidence,
        metadata,
      })
    : createKnowledgeGap({
        title: cluster.title,
        gapKey: cluster.normalized_key,
        representativeQuestion: cluster.representative_question,
        gapType,
        status: "draft_generated",
        severity,
        frequencyCount: cluster.frequency_count,
        sampleFailedQuestionIds: failedQuestionIds,
        retrievalEvidence,
        metadata,
      });

  if (!row) {
    throw new Error(`Failed to persist knowledge gap cluster ${cluster.cluster_id}`);
  }

  const attached = attachFailedQuestionsToGap(row.id, failedQuestionIds);
  return {
    cluster,
    gap: formatKnowledgeGap(row),
    attached_failed_question_count: attached,
  };
}

export async function generateKnowledgeGapClusterDrafts(options: KnowledgeGapClusterOptions = {}): Promise<KnowledgeGapClusterServiceResult> {
  const sampleLimit = clamp(options.sampleLimit, 100, 10, 100);
  const minFrequency = clamp(options.minFrequency, 2, 1, 20);
  const maxClusters = clamp(options.maxClusters, 20, 1, 100);
  const failedQuestions = listFailedQuestions({ pageSize: sampleLimit }).items.map((item) =>
    toFailedQuestionSignal(item as Record<string, unknown>)
  );
  const manualNotes = collectManualNotes(sampleLimit);
  const highConfidenceAnswers = collectHighConfidenceAnswers(sampleLimit);

  const ragResult = await clusterKnowledgeGapDrafts(
    {
      failed_questions: failedQuestions,
      manual_notes: manualNotes,
      high_confidence_answers: highConfidenceAnswers,
      min_frequency: minFrequency,
      max_clusters: maxClusters,
    },
    options.requestId,
    options.userId
  );
  const clusters = ragResult.clusters ?? [];
  const persisted = options.persist === false
    ? []
    : clusters.map((cluster) => persistCluster(cluster, ragResult));

  return {
    schema_version: ragResult.schema_version ?? "knowledge-gap-cluster/v1",
    clusters,
    persisted,
    ignored_count: ragResult.ignored_count ?? 0,
    metadata: {
      ...(ragResult.metadata ?? {}),
      sample_limit: sampleLimit,
      manual_note_count: manualNotes.length,
      high_confidence_answer_count: highConfidenceAnswers.length,
      persisted_count: persisted.length,
    },
  };
}
