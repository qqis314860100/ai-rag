import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";
import type { KnowledgeCardSourceRef, KnowledgeCardStatus } from "./knowledgeCards";

export type KnowledgeFaqStatus = KnowledgeCardStatus;

export interface KnowledgeFaqRow {
  id: string;
  question: string;
  normalized_question: string;
  answer: string;
  source_refs_json: string;
  applicable_scope: string;
  invalid_conditions_json: string;
  related_card_ids_json: string;
  tags_json: string;
  status: KnowledgeFaqStatus;
  frequency_count: number;
  created_by: string | null;
  created_by_name: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFaqInput {
  question: string;
  answer?: string;
  sourceRefs?: KnowledgeCardSourceRef[];
  applicableScope?: string;
  invalidConditions?: string[];
  relatedCardIds?: string[];
  tags?: string[];
  status?: KnowledgeFaqStatus;
  frequencyCount?: number;
  createdBy?: string | null;
  createdByName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeFaqFilters {
  status?: KnowledgeFaqStatus;
  query?: string;
  relatedCardId?: string;
  page?: number;
  pageSize?: number;
}

export const KNOWLEDGE_FAQ_STATUSES: KnowledgeFaqStatus[] = ["ai_draft", "pending_review", "returned", "published", "archived"];

export const KNOWLEDGE_FAQ_CONTRACT = {
  owner_service: "api",
  table: "knowledge_faqs",
  status_flow: ["ai_draft", "pending_review", "returned", "published", "archived"],
  required_fields: ["question", "answer", "source_refs"],
  reusable_fields: ["applicable_scope", "invalid_conditions", "related_card_ids", "tags", "frequency_count"],
  draft_generation: "从可追溯回答沉淀 FAQ；重复问题会增加 frequency_count 并合并引用证据。",
} as const;

function toJson(input: unknown): string {
  return JSON.stringify(input ?? []);
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input || "") as T;
  } catch {
    return fallback;
  }
}

export function normalizeFaqQuestion(question: string): string {
  return question.replace(/\s+/g, "").replace(/[？?。.!！]/g, "").trim().toLowerCase();
}

function existingUserIdOrNull(userId?: string | null): string | null {
  if (!userId) return null;
  const row = getDb().prepare("SELECT id FROM users WHERE id = ? LIMIT 1").get(userId) as { id: string } | undefined;
  return row?.id ?? null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function mergeSourceRefs(existing: KnowledgeCardSourceRef[], next: KnowledgeCardSourceRef[]): KnowledgeCardSourceRef[] {
  const byKey = new Map<string, KnowledgeCardSourceRef>();
  for (const ref of [...existing, ...next]) {
    const key = ref.source_id || ref.chunk_id || ref.document_id || ref.snippet;
    if (key) byKey.set(key, ref);
  }
  return Array.from(byKey.values()).slice(0, 12);
}

export function isKnowledgeFaqStatus(value: unknown): value is KnowledgeFaqStatus {
  return typeof value === "string" && KNOWLEDGE_FAQ_STATUSES.includes(value as KnowledgeFaqStatus);
}

export function formatKnowledgeFaq(row: KnowledgeFaqRow) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    source_refs: parseJson<KnowledgeCardSourceRef[]>(row.source_refs_json, []),
    applicable_scope: row.applicable_scope,
    invalid_conditions: parseJson<string[]>(row.invalid_conditions_json, []),
    related_card_ids: parseJson<string[]>(row.related_card_ids_json, []),
    tags: parseJson<string[]>(row.tags_json, []),
    status: row.status,
    frequency_count: row.frequency_count,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getKnowledgeFaqById(id: string): KnowledgeFaqRow | null {
  const row = getDb().prepare("SELECT * FROM knowledge_faqs WHERE id = ?").get(id) as KnowledgeFaqRow | undefined;
  return row ?? null;
}

export function getKnowledgeFaqByNormalizedQuestion(normalizedQuestion: string): KnowledgeFaqRow | null {
  const row = getDb()
    .prepare("SELECT * FROM knowledge_faqs WHERE normalized_question = ? ORDER BY updated_at DESC LIMIT 1")
    .get(normalizedQuestion) as KnowledgeFaqRow | undefined;
  return row ?? null;
}

export function listKnowledgeFaqs(filters: KnowledgeFaqFilters = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.query) {
    where.push("(question LIKE ? OR answer LIKE ? OR tags_json LIKE ?)");
    const keyword = `%${filters.query}%`;
    params.push(keyword, keyword, keyword);
  }
  if (filters.relatedCardId) {
    where.push("related_card_ids_json LIKE ?");
    params.push(`%${filters.relatedCardId}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const total = (getDb().prepare(`SELECT COUNT(*) as total FROM knowledge_faqs ${whereClause}`).get(...params) as { total: number }).total;
  const rows = getDb()
    .prepare(`SELECT * FROM knowledge_faqs ${whereClause} ORDER BY frequency_count DESC, updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as KnowledgeFaqRow[];

  return { items: rows.map(formatKnowledgeFaq), total, page, pageSize };
}

export function createKnowledgeFaq(input: KnowledgeFaqInput): KnowledgeFaqRow {
  const id = uuidv4();
  const now = new Date().toISOString();
  const normalizedQuestion = normalizeFaqQuestion(input.question);

  getDb().prepare(
    `INSERT INTO knowledge_faqs (
       id, question, normalized_question, answer, source_refs_json, applicable_scope,
       invalid_conditions_json, related_card_ids_json, tags_json, status, frequency_count,
       created_by, created_by_name, metadata_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.question,
    normalizedQuestion,
    input.answer ?? "",
    toJson(input.sourceRefs ?? []),
    input.applicableScope ?? "",
    toJson(input.invalidConditions ?? []),
    toJson(input.relatedCardIds ?? []),
    toJson(input.tags ?? []),
    input.status ?? "ai_draft",
    input.frequencyCount ?? 1,
    existingUserIdOrNull(input.createdBy),
    input.createdByName ?? null,
    JSON.stringify(input.metadata ?? {}),
    now,
    now
  );

  return getKnowledgeFaqById(id)!;
}

export function createOrUpdateKnowledgeFaq(input: KnowledgeFaqInput): KnowledgeFaqRow {
  const normalizedQuestion = normalizeFaqQuestion(input.question);
  const existing = getKnowledgeFaqByNormalizedQuestion(normalizedQuestion);
  if (!existing) return createKnowledgeFaq(input);

  const now = new Date().toISOString();
  const sourceRefs = mergeSourceRefs(parseJson<KnowledgeCardSourceRef[]>(existing.source_refs_json, []), input.sourceRefs ?? []);
  const invalidConditions = uniqueStrings([
    ...parseJson<string[]>(existing.invalid_conditions_json, []),
    ...(input.invalidConditions ?? []),
  ]);
  const relatedCardIds = uniqueStrings([
    ...parseJson<string[]>(existing.related_card_ids_json, []),
    ...(input.relatedCardIds ?? []),
  ]);
  const tags = uniqueStrings([...parseJson<string[]>(existing.tags_json, []), ...(input.tags ?? [])]);

  getDb().prepare(
    `UPDATE knowledge_faqs
     SET answer = ?, source_refs_json = ?, applicable_scope = ?, invalid_conditions_json = ?,
         related_card_ids_json = ?, tags_json = ?, frequency_count = frequency_count + 1,
         metadata_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.answer ?? existing.answer,
    toJson(sourceRefs),
    input.applicableScope || existing.applicable_scope,
    toJson(invalidConditions),
    toJson(relatedCardIds),
    toJson(tags),
    JSON.stringify({ ...parseJson<Record<string, unknown>>(existing.metadata_json, {}), ...(input.metadata ?? {}), deduped_at: now }),
    now,
    existing.id
  );

  return getKnowledgeFaqById(existing.id)!;
}
