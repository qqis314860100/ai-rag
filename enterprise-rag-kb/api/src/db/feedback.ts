import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export interface FeedbackRow {
  id: string;
  message_id: string;
  user_id: string;
  rating: string;
  reason: string | null;
  comment: string | null;
  status: string;
  resolution: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateFeedbackInput {
  messageId: string;
  userId: string;
  rating: string;
  reason?: string;
  comment?: string;
}

export interface FeedbackFilters {
  status?: string;
  rating?: string;
  page?: number;
  pageSize?: number;
}

export function listFeedback(filters: FeedbackFilters = {}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.rating) {
    conditions.push("rating = ?");
    params.push(filters.rating);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM feedback ${whereClause}`)
    .get(...params) as { total: number };

  const rows = db
    .prepare(`SELECT * FROM feedback ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as FeedbackRow[];

  return {
    items: rows,
    total: countRow.total,
    page,
    pageSize,
  };
}

export function getFeedbackById(id: string): FeedbackRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM feedback WHERE id = ?").get(id) as FeedbackRow | undefined;
  return row ?? null;
}

export function createFeedback(input: CreateFeedbackInput): FeedbackRow {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  // UPSERT: if same user already voted on this message, update rating
  db.prepare(
    `INSERT INTO feedback (id, message_id, user_id, rating, reason, comment, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
     ON CONFLICT(message_id, user_id) DO UPDATE SET
       rating = excluded.rating,
       reason = excluded.reason,
       comment = excluded.comment,
       updated_at = excluded.updated_at`
  ).run(id, input.messageId, input.userId, input.rating, input.reason ?? null, input.comment ?? null, now, now);

  // Return the row (might be updated existing one)
  const row = db.prepare("SELECT * FROM feedback WHERE message_id=? AND user_id=?").get(input.messageId, input.userId) as FeedbackRow | undefined;
  return row!;
}

export function updateFeedback(
  id: string,
  updates: { status?: string; resolution?: string; handledBy?: string }
): FeedbackRow | null {
  const db = getDb();
  const existing = getFeedbackById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) { fields.push("status = ?"); params.push(updates.status); }
  if (updates.resolution !== undefined) { fields.push("resolution = ?"); params.push(updates.resolution); }
  if (updates.handledBy !== undefined) {
    fields.push("handled_by = ?");
    fields.push("handled_at = ?");
    params.push(updates.handledBy);
    params.push(now);
  }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  params.push(now);
  params.push(id);

  db.prepare(`UPDATE feedback SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return getFeedbackById(id);
}
