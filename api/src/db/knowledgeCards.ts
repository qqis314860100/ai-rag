import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export const KNOWLEDGE_CARD_STATUSES = ["ai_draft", "pending_review", "returned", "published", "archived"] as const;
export type KnowledgeCardStatus = typeof KNOWLEDGE_CARD_STATUSES[number];

export interface KnowledgeCardSourceRef {
  document_id?: string;
  chunk_id?: string;
  message_id?: string;
  source_id?: string;
  title?: string;
  section_path?: string;
  snippet?: string;
  score?: number;
}

export interface KnowledgeCardKeyParameter {
  name: string;
  value?: string;
  unit?: string;
  range?: string;
  description?: string;
}

export interface KnowledgeCardStep {
  title: string;
  description?: string;
  order?: number;
}

export interface KnowledgeCardRisk {
  title: string;
  level?: "low" | "medium" | "high" | "critical";
  description?: string;
}

export interface KnowledgeCardHandlingMethod {
  title: string;
  description?: string;
  related_risk?: string;
}

export interface KnowledgeCardRow {
  id: string;
  topic: string;
  summary: string;
  key_parameters_json: string;
  steps_json: string;
  risks_json: string;
  handling_methods_json: string;
  source_refs_json: string;
  related_terms_json: string;
  status: KnowledgeCardStatus;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  current_version: number;
  created_by: string | null;
  created_by_name: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeCardVersionRow {
  id: string;
  card_id: string;
  version: number;
  snapshot_json: string;
  change_note: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  created_at: string;
}

export interface KnowledgeCardDraftInput {
  topic: string;
  summary?: string;
  keyParameters?: KnowledgeCardKeyParameter[];
  steps?: KnowledgeCardStep[];
  risks?: KnowledgeCardRisk[];
  handlingMethods?: KnowledgeCardHandlingMethod[];
  sourceRefs?: KnowledgeCardSourceRef[];
  relatedTerms?: string[];
  status?: KnowledgeCardStatus;
  reviewerId?: string | null;
  reviewerName?: string | null;
  reviewedAt?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  metadata?: Record<string, unknown>;
  changeNote?: string | null;
}

export interface UpdateKnowledgeCardInput {
  topic?: string;
  summary?: string;
  keyParameters?: KnowledgeCardKeyParameter[];
  steps?: KnowledgeCardStep[];
  risks?: KnowledgeCardRisk[];
  handlingMethods?: KnowledgeCardHandlingMethod[];
  sourceRefs?: KnowledgeCardSourceRef[];
  relatedTerms?: string[];
  status?: KnowledgeCardStatus;
  reviewerId?: string | null;
  reviewerName?: string | null;
  reviewedAt?: string | null;
  metadata?: Record<string, unknown>;
  changedBy?: string | null;
  changedByName?: string | null;
  changeNote?: string | null;
}

export interface KnowledgeCardFilters {
  status?: KnowledgeCardStatus;
  topic?: string;
  relatedTerm?: string;
  reviewerId?: string;
  page?: number;
  pageSize?: number;
}

export const KNOWLEDGE_CARD_MODEL_CONTRACT = {
  owner_service: "api",
  tables: {
    cards: "knowledge_cards",
    versions: "knowledge_card_versions",
  },
  status_flow: ["ai_draft", "pending_review", "returned", "published", "archived"],
  required_fields: ["topic"],
  structured_fields: [
    "key_parameters",
    "steps",
    "risks",
    "handling_methods",
    "source_refs",
    "related_terms",
  ],
  versioning: "每次 create/update 都写入 knowledge_card_versions 快照，主表保留 current_version。",
} as const;

function toJson(input: unknown): string {
  return JSON.stringify(input ?? {});
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input || "") as T;
  } catch {
    return fallback;
  }
}

function existingUserIdOrNull(userId?: string | null): string | null {
  if (!userId) return null;
  const row = getDb().prepare("SELECT id FROM users WHERE id = ? LIMIT 1").get(userId) as { id: string } | undefined;
  return row?.id ?? null;
}

function snapshotFromRow(row: KnowledgeCardRow) {
  return {
    id: row.id,
    topic: row.topic,
    summary: row.summary,
    key_parameters: parseJson<KnowledgeCardKeyParameter[]>(row.key_parameters_json, []),
    steps: parseJson<KnowledgeCardStep[]>(row.steps_json, []),
    risks: parseJson<KnowledgeCardRisk[]>(row.risks_json, []),
    handling_methods: parseJson<KnowledgeCardHandlingMethod[]>(row.handling_methods_json, []),
    source_refs: parseJson<KnowledgeCardSourceRef[]>(row.source_refs_json, []),
    related_terms: parseJson<string[]>(row.related_terms_json, []),
    status: row.status,
    reviewer_id: row.reviewer_id,
    reviewer_name: row.reviewer_name,
    reviewed_at: row.reviewed_at,
    current_version: row.current_version,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function insertVersion(row: KnowledgeCardRow, changedBy?: string | null, changedByName?: string | null, changeNote?: string | null): KnowledgeCardVersionRow {
  const id = uuidv4();
  const now = new Date().toISOString();

  getDb().prepare(
    `INSERT INTO knowledge_card_versions (
       id, card_id, version, snapshot_json, change_note, changed_by, changed_by_name, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    row.id,
    row.current_version,
    toJson(snapshotFromRow(row)),
    changeNote ?? null,
    existingUserIdOrNull(changedBy),
    changedByName ?? null,
    now
  );

  return getKnowledgeCardVersionById(id)!;
}

export function isKnowledgeCardStatus(value: unknown): value is KnowledgeCardStatus {
  return typeof value === "string" && KNOWLEDGE_CARD_STATUSES.includes(value as KnowledgeCardStatus);
}

export function createKnowledgeCard(input: KnowledgeCardDraftInput): KnowledgeCardRow {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO knowledge_cards (
         id, topic, summary, key_parameters_json, steps_json, risks_json,
         handling_methods_json, source_refs_json, related_terms_json, status,
         reviewer_id, reviewer_name, reviewed_at, current_version, created_by,
         created_by_name, metadata_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.topic,
      input.summary ?? "",
      toJson(input.keyParameters ?? []),
      toJson(input.steps ?? []),
      toJson(input.risks ?? []),
      toJson(input.handlingMethods ?? []),
      toJson(input.sourceRefs ?? []),
      toJson(input.relatedTerms ?? []),
      input.status ?? "ai_draft",
      existingUserIdOrNull(input.reviewerId),
      input.reviewerName ?? null,
      input.reviewedAt ?? null,
      existingUserIdOrNull(input.createdBy),
      input.createdByName ?? null,
      toJson(input.metadata ?? {}),
      now,
      now
    );

    const created = getKnowledgeCardById(id);
    if (!created) throw new Error("Failed to create knowledge card.");
    insertVersion(created, input.createdBy ?? null, input.createdByName ?? null, input.changeNote ?? "创建知识卡");
  })();

  return getKnowledgeCardById(id)!;
}

export function getKnowledgeCardById(id: string): KnowledgeCardRow | null {
  const row = getDb().prepare("SELECT * FROM knowledge_cards WHERE id = ?").get(id) as KnowledgeCardRow | undefined;
  return row ?? null;
}

export function getKnowledgeCardVersionById(id: string): KnowledgeCardVersionRow | null {
  const row = getDb().prepare("SELECT * FROM knowledge_card_versions WHERE id = ?").get(id) as KnowledgeCardVersionRow | undefined;
  return row ?? null;
}

export function listKnowledgeCardVersions(cardId: string): KnowledgeCardVersionRow[] {
  return getDb().prepare(
    `SELECT *
     FROM knowledge_card_versions
     WHERE card_id = ?
     ORDER BY version DESC, created_at DESC`
  ).all(cardId) as KnowledgeCardVersionRow[];
}

export function listKnowledgeCards(filters: KnowledgeCardFilters = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.topic) {
    conditions.push("topic LIKE ?");
    params.push(`%${filters.topic}%`);
  }
  if (filters.relatedTerm) {
    conditions.push("related_terms_json LIKE ?");
    params.push(`%"${filters.relatedTerm}"%`);
  }
  if (filters.reviewerId) {
    conditions.push("reviewer_id = ?");
    params.push(filters.reviewerId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const countRow = getDb()
    .prepare(`SELECT COUNT(*) as total FROM knowledge_cards ${whereClause}`)
    .get(...params) as { total: number };

  const rows = getDb()
    .prepare(
      `SELECT *
       FROM knowledge_cards
       ${whereClause}
       ORDER BY updated_at DESC, rowid DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as KnowledgeCardRow[];

  return {
    items: rows.map((row) => formatKnowledgeCard(row)),
    total: countRow.total,
    page,
    pageSize,
  };
}

export function updateKnowledgeCard(id: string, input: UpdateKnowledgeCardInput): KnowledgeCardRow | null {
  const existing = getKnowledgeCardById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const nextVersion = existing.current_version + 1;
  const db = getDb();

  db.transaction(() => {
    db.prepare(
      `UPDATE knowledge_cards
       SET topic = ?,
           summary = ?,
           key_parameters_json = ?,
           steps_json = ?,
           risks_json = ?,
           handling_methods_json = ?,
           source_refs_json = ?,
           related_terms_json = ?,
           status = ?,
           reviewer_id = ?,
           reviewer_name = ?,
           reviewed_at = ?,
           current_version = ?,
           metadata_json = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      input.topic ?? existing.topic,
      input.summary ?? existing.summary,
      input.keyParameters === undefined ? existing.key_parameters_json : toJson(input.keyParameters),
      input.steps === undefined ? existing.steps_json : toJson(input.steps),
      input.risks === undefined ? existing.risks_json : toJson(input.risks),
      input.handlingMethods === undefined ? existing.handling_methods_json : toJson(input.handlingMethods),
      input.sourceRefs === undefined ? existing.source_refs_json : toJson(input.sourceRefs),
      input.relatedTerms === undefined ? existing.related_terms_json : toJson(input.relatedTerms),
      input.status ?? existing.status,
      input.reviewerId === undefined ? existing.reviewer_id : existingUserIdOrNull(input.reviewerId),
      input.reviewerName === undefined ? existing.reviewer_name : input.reviewerName,
      input.reviewedAt === undefined ? existing.reviewed_at : input.reviewedAt,
      nextVersion,
      input.metadata === undefined ? existing.metadata_json : toJson(input.metadata),
      now,
      id
    );

    const updated = getKnowledgeCardById(id);
    if (!updated) throw new Error("Failed to update knowledge card.");
    insertVersion(updated, input.changedBy ?? null, input.changedByName ?? null, input.changeNote ?? null);
  })();

  return getKnowledgeCardById(id);
}

export function formatKnowledgeCard(row: KnowledgeCardRow, versions: KnowledgeCardVersionRow[] = []) {
  return {
    ...snapshotFromRow(row),
    version_history: versions.map(formatKnowledgeCardVersion),
  };
}

export function formatKnowledgeCardVersion(row: KnowledgeCardVersionRow) {
  return {
    id: row.id,
    card_id: row.card_id,
    version: row.version,
    snapshot: parseJson<Record<string, unknown>>(row.snapshot_json, {}),
    change_note: row.change_note,
    changed_by: row.changed_by,
    changed_by_name: row.changed_by_name,
    created_at: row.created_at,
  };
}
