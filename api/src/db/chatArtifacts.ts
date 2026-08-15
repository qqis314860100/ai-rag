import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export type ArtifactStatus = "pending" | "ready" | "failed" | "deleted";

export interface ChatArtifactRow {
  id: string;
  session_id: string;
  message_id: string;
  type: string;
  renderer: string;
  title: string;
  summary: string;
  reason: string;
  status: ArtifactStatus;
  confidence: number;
  payload_json: string;
  source_ids_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface CreateArtifactInput {
  sessionId: string;
  messageId: string;
  type: string;
  renderer: string;
  title: string;
  summary?: string;
  reason?: string;
  status?: ArtifactStatus;
  confidence?: number;
  payload?: unknown;
  sourceIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateArtifactInput {
  type?: string;
  renderer?: string;
  title?: string;
  summary?: string;
  reason?: string;
  status?: ArtifactStatus;
  confidence?: number;
  payload?: unknown;
  sourceIds?: string[];
  metadata?: Record<string, unknown>;
}

function artifactPayload(input: unknown) {
  return JSON.stringify(input ?? {});
}

export function createArtifact(input: CreateArtifactInput): ChatArtifactRow {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO chat_artifacts (
       id, session_id, message_id, type, renderer, title, summary, reason,
       status, confidence, payload_json, source_ids_json, metadata_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.sessionId,
    input.messageId,
    input.type,
    input.renderer,
    input.title,
    input.summary ?? "",
    input.reason ?? "",
    input.status ?? "ready",
    input.confidence ?? 0,
    artifactPayload(input.payload),
    JSON.stringify(input.sourceIds ?? []),
    JSON.stringify(input.metadata ?? {}),
    now,
    now
  );

  return getArtifactById(id)!;
}

export function getArtifactById(id: string): ChatArtifactRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM chat_artifacts WHERE id = ?").get(id) as ChatArtifactRow | undefined;
  return row ?? null;
}

export function listArtifactsByMessage(messageId: string, includeDeleted = false): ChatArtifactRow[] {
  const db = getDb();
  const statusClause = includeDeleted ? "" : "AND status != 'deleted'";
  return db.prepare(
    `SELECT *
     FROM chat_artifacts
     WHERE message_id = ?
       ${statusClause}
     ORDER BY created_at ASC, rowid ASC`
  ).all(messageId) as ChatArtifactRow[];
}

export function updateArtifact(id: string, input: UpdateArtifactInput): ChatArtifactRow | null {
  const existing = getArtifactById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const metadata = input.metadata ?? JSON.parse(existing.metadata_json || "{}");

  getDb().prepare(
    `UPDATE chat_artifacts
     SET renderer = ?,
         type = ?,
         title = ?,
         summary = ?,
         reason = ?,
         status = ?,
         confidence = ?,
         payload_json = ?,
         source_ids_json = ?,
         metadata_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    input.renderer ?? existing.renderer,
    input.type ?? existing.type,
    input.title ?? existing.title,
    input.summary ?? existing.summary,
    input.reason ?? existing.reason,
    input.status ?? existing.status,
    input.confidence ?? existing.confidence,
    input.payload === undefined ? existing.payload_json : artifactPayload(input.payload),
    input.sourceIds === undefined ? existing.source_ids_json : JSON.stringify(input.sourceIds),
    JSON.stringify(metadata),
    now,
    id
  );

  return getArtifactById(id);
}

export function softDeleteArtifact(id: string): boolean {
  const existing = getArtifactById(id);
  if (!existing || existing.status === "deleted") return false;

  const now = new Date().toISOString();
  getDb().prepare("UPDATE chat_artifacts SET status = 'deleted', updated_at = ? WHERE id = ?").run(now, id);
  return true;
}

export function formatArtifact(row: ChatArtifactRow) {
  return {
    id: row.id,
    session_id: row.session_id,
    message_id: row.message_id,
    type: row.type,
    renderer: row.renderer,
    title: row.title,
    summary: row.summary,
    reason: row.reason,
    status: row.status,
    confidence: row.confidence,
    payload: JSON.parse(row.payload_json || "{}"),
    source_ids: JSON.parse(row.source_ids_json || "[]") as string[],
    metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
