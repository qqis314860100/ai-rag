import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export function listSessions(userId: string): ChatSessionRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as ChatSessionRow[];
}

export function getSessionById(id: string): ChatSessionRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id) as ChatSessionRow | undefined;
  return row ?? null;
}

export function createSession(userId: string, title: string): ChatSessionRow {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO chat_sessions (id, user_id, title, pinned, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)"
  ).run(id, userId, title, now, now);

  return getSessionById(id)!;
}

export function updateSession(id: string, updates: { title?: string; pinned?: number }): ChatSessionRow | null {
  const db = getDb();
  const existing = getSessionById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.title !== undefined) { fields.push("title = ?"); params.push(updates.title); }
  if (updates.pinned !== undefined) { fields.push("pinned = ?"); params.push(updates.pinned); }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  params.push(now);
  params.push(id);

  db.prepare(`UPDATE chat_sessions SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return getSessionById(id);
}

export function touchSession(id: string): void {
  const db = getDb();
  db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}
