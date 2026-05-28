import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export const FAILED_QUESTION_EVENT_TYPES = [
  "refusal",
  "low_confidence",
  "user_retry",
  "follow_up_correction",
  "negative_feedback",
] as const;
export type FailedQuestionEventType = typeof FAILED_QUESTION_EVENT_TYPES[number];

export const KNOWLEDGE_GAP_TYPES = [...FAILED_QUESTION_EVENT_TYPES, "mixed"] as const;
export type KnowledgeGapType = typeof KNOWLEDGE_GAP_TYPES[number];

export const KNOWLEDGE_GAP_STATUSES = ["pending", "merged", "draft_generated", "published", "ignored"] as const;
export type KnowledgeGapStatus = typeof KNOWLEDGE_GAP_STATUSES[number];

export const KNOWLEDGE_GAP_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type KnowledgeGapSeverity = typeof KNOWLEDGE_GAP_SEVERITIES[number];

export interface QueryUnderstandingCandidate {
  raw_query?: string;
  rewritten_query?: string;
  intent?: string;
  terms?: string[];
  filters?: Record<string, unknown>;
  confidence?: number;
  source?: string;
}

export interface RetrievalEvidenceRef {
  document_id?: string;
  chunk_id?: string;
  source_id?: string;
  title?: string;
  section_path?: string;
  snippet?: string;
  score?: number;
  rank?: number;
  retrieval_type?: "strong_term" | "semantic_candidate" | "hybrid" | "manual";
}

export interface KnowledgeGapRow {
  id: string;
  title: string;
  gap_key: string;
  representative_question: string;
  gap_type: KnowledgeGapType;
  status: KnowledgeGapStatus;
  severity: KnowledgeGapSeverity;
  frequency_count: number;
  sample_failed_question_ids_json: string;
  query_understanding_json: string;
  retrieval_evidence_json: string;
  metadata_json: string;
  created_by: string | null;
  created_by_name: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface FailedQuestionRow {
  id: string;
  gap_id: string | null;
  event_type: FailedQuestionEventType;
  question: string;
  normalized_question: string;
  user_id: string | null;
  session_id: string | null;
  user_message_id: string | null;
  assistant_message_id: string | null;
  feedback_id: string | null;
  retry_of_question_id: string | null;
  corrected_question: string;
  answer_snapshot: string;
  confidence: number | null;
  feedback_reason: string;
  feedback_comment: string;
  query_understanding_json: string;
  retrieval_evidence_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeGapInput {
  title: string;
  gapKey?: string;
  representativeQuestion: string;
  gapType?: KnowledgeGapType;
  status?: KnowledgeGapStatus;
  severity?: KnowledgeGapSeverity;
  frequencyCount?: number;
  sampleFailedQuestionIds?: string[];
  queryUnderstanding?: QueryUnderstandingCandidate[];
  retrievalEvidence?: RetrievalEvidenceRef[];
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
  createdByName?: string | null;
  lastSeenAt?: string;
}

export interface FailedQuestionInput {
  eventType: FailedQuestionEventType;
  question: string;
  gapId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
  feedbackId?: string | null;
  retryOfQuestionId?: string | null;
  correctedQuestion?: string;
  answerSnapshot?: string;
  confidence?: number | null;
  feedbackReason?: string;
  feedbackComment?: string;
  queryUnderstanding?: QueryUnderstandingCandidate[];
  retrievalEvidence?: RetrievalEvidenceRef[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeGapFilters {
  status?: KnowledgeGapStatus;
  gapType?: KnowledgeGapType;
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface FailedQuestionFilters {
  gapId?: string;
  eventType?: FailedQuestionEventType;
  sessionId?: string;
  userId?: string;
  normalizedQuestion?: string;
  page?: number;
  pageSize?: number;
}

export const KNOWLEDGE_GAP_MODEL_CONTRACT = {
  owner_service: "api",
  tables: {
    gaps: "knowledge_gaps",
    failed_questions: "failed_questions",
  },
  event_types: FAILED_QUESTION_EVENT_TYPES,
  gap_types: KNOWLEDGE_GAP_TYPES,
  status_flow: KNOWLEDGE_GAP_STATUSES,
  required_failed_question_fields: ["event_type", "question", "normalized_question"],
  structured_fields: ["query_understanding", "retrieval_evidence", "metadata"],
  trace_fields: ["session_id", "user_message_id", "assistant_message_id", "feedback_id", "retry_of_question_id"],
  governance_rule: "failed_questions 记录原始失败信号，knowledge_gaps 承载人工治理和后续聚类结果；正式知识资产发布前不得自动污染术语、FAQ 或知识卡。",
} as const;

const LINKED_TABLES = {
  knowledge_gaps: "knowledge_gaps",
  users: "users",
  chat_sessions: "chat_sessions",
  chat_messages: "chat_messages",
  feedback: "feedback",
  failed_questions: "failed_questions",
} as const;

type LinkedTable = keyof typeof LINKED_TABLES;

function toJson(input: unknown, fallback: unknown[] | Record<string, unknown> = []): string {
  return JSON.stringify(input ?? fallback);
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input || "") as T;
  } catch {
    return fallback;
  }
}

export function normalizeFailedQuestion(question: string): string {
  return question.replace(/\s+/g, "").replace(/[？?。.!！]/g, "").trim().toLowerCase();
}

function existingIdOrNull(table: LinkedTable, id?: string | null): string | null {
  if (!id) return null;
  const tableName = LINKED_TABLES[table];
  const row = getDb().prepare(`SELECT id FROM ${tableName} WHERE id = ? LIMIT 1`).get(id) as { id: string } | undefined;
  return row?.id ?? null;
}

function clampPage(page?: number): number {
  return Math.max(1, page ?? 1);
}

function clampPageSize(pageSize?: number): number {
  return Math.min(100, Math.max(1, pageSize ?? 20));
}

export function isFailedQuestionEventType(value: unknown): value is FailedQuestionEventType {
  return typeof value === "string" && FAILED_QUESTION_EVENT_TYPES.includes(value as FailedQuestionEventType);
}

export function isKnowledgeGapType(value: unknown): value is KnowledgeGapType {
  return typeof value === "string" && KNOWLEDGE_GAP_TYPES.includes(value as KnowledgeGapType);
}

export function isKnowledgeGapStatus(value: unknown): value is KnowledgeGapStatus {
  return typeof value === "string" && KNOWLEDGE_GAP_STATUSES.includes(value as KnowledgeGapStatus);
}

export function isKnowledgeGapSeverity(value: unknown): value is KnowledgeGapSeverity {
  return typeof value === "string" && KNOWLEDGE_GAP_SEVERITIES.includes(value as KnowledgeGapSeverity);
}

export function createKnowledgeGap(input: KnowledgeGapInput): KnowledgeGapRow {
  const id = uuidv4();
  const now = new Date().toISOString();
  const gapKey = normalizeFailedQuestion(input.gapKey ?? input.representativeQuestion ?? input.title);

  getDb().prepare(
    `INSERT INTO knowledge_gaps (
       id, title, gap_key, representative_question, gap_type, status, severity,
       frequency_count, sample_failed_question_ids_json, query_understanding_json,
       retrieval_evidence_json, metadata_json, created_by, created_by_name,
       last_seen_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.title,
    gapKey,
    input.representativeQuestion,
    input.gapType ?? "mixed",
    input.status ?? "pending",
    input.severity ?? "medium",
    Math.max(1, input.frequencyCount ?? input.sampleFailedQuestionIds?.length ?? 1),
    toJson(input.sampleFailedQuestionIds ?? []),
    toJson(input.queryUnderstanding ?? []),
    toJson(input.retrievalEvidence ?? []),
    toJson(input.metadata ?? {}, {}),
    existingIdOrNull("users", input.createdBy),
    input.createdByName ?? null,
    input.lastSeenAt ?? now,
    now,
    now
  );

  return getKnowledgeGapById(id)!;
}

export function createFailedQuestion(input: FailedQuestionInput): FailedQuestionRow {
  const id = uuidv4();
  const now = new Date().toISOString();

  getDb().prepare(
    `INSERT INTO failed_questions (
       id, gap_id, event_type, question, normalized_question, user_id, session_id,
       user_message_id, assistant_message_id, feedback_id, retry_of_question_id,
       corrected_question, answer_snapshot, confidence, feedback_reason, feedback_comment,
       query_understanding_json, retrieval_evidence_json, metadata_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    existingIdOrNull("knowledge_gaps", input.gapId),
    input.eventType,
    input.question,
    normalizeFailedQuestion(input.question),
    existingIdOrNull("users", input.userId),
    existingIdOrNull("chat_sessions", input.sessionId),
    existingIdOrNull("chat_messages", input.userMessageId),
    existingIdOrNull("chat_messages", input.assistantMessageId),
    existingIdOrNull("feedback", input.feedbackId),
    existingIdOrNull("failed_questions", input.retryOfQuestionId),
    input.correctedQuestion ?? "",
    input.answerSnapshot ?? "",
    input.confidence ?? null,
    input.feedbackReason ?? "",
    input.feedbackComment ?? "",
    toJson(input.queryUnderstanding ?? []),
    toJson(input.retrievalEvidence ?? []),
    toJson(input.metadata ?? {}, {}),
    now,
    now
  );

  return getFailedQuestionById(id)!;
}

export function getKnowledgeGapById(id: string): KnowledgeGapRow | null {
  const row = getDb().prepare("SELECT * FROM knowledge_gaps WHERE id = ?").get(id) as KnowledgeGapRow | undefined;
  return row ?? null;
}

export function getKnowledgeGapByKey(gapKey: string): KnowledgeGapRow | null {
  const row = getDb()
    .prepare("SELECT * FROM knowledge_gaps WHERE gap_key = ? LIMIT 1")
    .get(normalizeFailedQuestion(gapKey)) as KnowledgeGapRow | undefined;
  return row ?? null;
}

export function getFailedQuestionById(id: string): FailedQuestionRow | null {
  const row = getDb().prepare("SELECT * FROM failed_questions WHERE id = ?").get(id) as FailedQuestionRow | undefined;
  return row ?? null;
}

export function listKnowledgeGaps(filters: KnowledgeGapFilters = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.gapType) {
    conditions.push("gap_type = ?");
    params.push(filters.gapType);
  }
  if (filters.query) {
    conditions.push("(title LIKE ? OR representative_question LIKE ?)");
    const keyword = `%${filters.query}%`;
    params.push(keyword, keyword);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize);
  const offset = (page - 1) * pageSize;

  const total = (getDb().prepare(`SELECT COUNT(*) as total FROM knowledge_gaps ${whereClause}`).get(...params) as { total: number }).total;
  const rows = getDb()
    .prepare(
      `SELECT *
       FROM knowledge_gaps
       ${whereClause}
       ORDER BY frequency_count DESC, last_seen_at DESC, updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as KnowledgeGapRow[];

  return { items: rows.map(formatKnowledgeGap), total, page, pageSize };
}

export function listFailedQuestions(filters: FailedQuestionFilters = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.gapId) {
    conditions.push("gap_id = ?");
    params.push(filters.gapId);
  }
  if (filters.eventType) {
    conditions.push("event_type = ?");
    params.push(filters.eventType);
  }
  if (filters.sessionId) {
    conditions.push("session_id = ?");
    params.push(filters.sessionId);
  }
  if (filters.userId) {
    conditions.push("user_id = ?");
    params.push(filters.userId);
  }
  if (filters.normalizedQuestion) {
    conditions.push("normalized_question = ?");
    params.push(normalizeFailedQuestion(filters.normalizedQuestion));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize);
  const offset = (page - 1) * pageSize;

  const total = (getDb().prepare(`SELECT COUNT(*) as total FROM failed_questions ${whereClause}`).get(...params) as { total: number }).total;
  const rows = getDb()
    .prepare(
      `SELECT *
       FROM failed_questions
       ${whereClause}
       ORDER BY created_at DESC, rowid DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as FailedQuestionRow[];

  return { items: rows.map(formatFailedQuestion), total, page, pageSize };
}

export function formatKnowledgeGap(row: KnowledgeGapRow) {
  return {
    id: row.id,
    title: row.title,
    gap_key: row.gap_key,
    representative_question: row.representative_question,
    gap_type: row.gap_type,
    status: row.status,
    severity: row.severity,
    frequency_count: row.frequency_count,
    sample_failed_question_ids: parseJson<string[]>(row.sample_failed_question_ids_json, []),
    query_understanding: parseJson<QueryUnderstandingCandidate[]>(row.query_understanding_json, []),
    retrieval_evidence: parseJson<RetrievalEvidenceRef[]>(row.retrieval_evidence_json, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function formatFailedQuestion(row: FailedQuestionRow) {
  return {
    id: row.id,
    gap_id: row.gap_id,
    event_type: row.event_type,
    question: row.question,
    normalized_question: row.normalized_question,
    user_id: row.user_id,
    session_id: row.session_id,
    user_message_id: row.user_message_id,
    assistant_message_id: row.assistant_message_id,
    feedback_id: row.feedback_id,
    retry_of_question_id: row.retry_of_question_id,
    corrected_question: row.corrected_question,
    answer_snapshot: row.answer_snapshot,
    confidence: row.confidence,
    feedback_reason: row.feedback_reason,
    feedback_comment: row.feedback_comment,
    query_understanding: parseJson<QueryUnderstandingCandidate[]>(row.query_understanding_json, []),
    retrieval_evidence: parseJson<RetrievalEvidenceRef[]>(row.retrieval_evidence_json, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
