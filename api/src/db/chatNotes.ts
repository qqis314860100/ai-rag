import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export const NOTE_SCOPES = ["session", "message", "source"] as const;
export type NoteScope = typeof NOTE_SCOPES[number];

export interface ChatNoteRow {
  id: string;
  user_id: string;
  user_name: string;
  scope: NoteScope;
  session_id: string;
  message_id: string | null;
  source_id: string | null;
  document_id: string | null;
  chunk_id: string | null;
  content: string;
  metadata_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface NoteTarget {
  scope: NoteScope;
  sessionId: string;
  messageId?: string | null;
  sourceId?: string | null;
  documentId?: string | null;
  chunkId?: string | null;
}

export interface CreateNoteInput extends NoteTarget {
  userId: string;
  userName: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export const NOTE_OWNERSHIP_CONTRACT = {
  owner_service: "api",
  storage_model: "single_polymorphic_table",
  table: "chat_notes",
  independent_tables_required: false,
  scopes: {
    session: {
      description: "当前会话笔记，挂在 chat_sessions.id 上。",
      required_fields: ["session_id"],
      lifecycle: "会话删除后级联删除。",
    },
    message: {
      description: "回答笔记，挂在 assistant chat_messages.id 上。",
      required_fields: ["session_id", "message_id"],
      lifecycle: "消息或会话删除后级联删除。",
    },
    source: {
      description: "引用笔记，挂在 assistant message 的 source_id/chunk_id 上，并冗余 document_id/chunk_id 便于查询。",
      required_fields: ["session_id", "message_id", "source_id"],
      lifecycle: "消息或会话删除后级联删除；source_id 可兼容历史 sources_json fallback。",
    },
  },
  permissions: {
    create: "用户必须能读取目标会话；笔记归属创建者本人。",
    read: "只返回当前用户自己的 active 笔记。",
    update_delete: "只允许笔记创建者修改或删除。",
  },
} as const;

export function isNoteScope(value: unknown): value is NoteScope {
  return typeof value === "string" && NOTE_SCOPES.includes(value as NoteScope);
}

export function listNotes(target: NoteTarget, userId: string): ChatNoteRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT *
     FROM chat_notes
     WHERE user_id = ?
       AND status = 'active'
       AND scope = ?
       AND session_id = ?
       AND (? IS NULL OR message_id = ?)
       AND (? IS NULL OR source_id = ?)
     ORDER BY updated_at DESC, rowid DESC`
  ).all(
    userId,
    target.scope,
    target.sessionId,
    target.messageId ?? null,
    target.messageId ?? null,
    target.sourceId ?? null,
    target.sourceId ?? null
  ) as ChatNoteRow[];
}

export function getNoteById(id: string): ChatNoteRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM chat_notes WHERE id = ? AND status = 'active'").get(id) as ChatNoteRow | undefined;
  return row ?? null;
}

export function createNote(input: CreateNoteInput): ChatNoteRow {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO chat_notes (
       id, user_id, user_name, scope, session_id, message_id, source_id,
       document_id, chunk_id, content, metadata_json, status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    id,
    input.userId,
    input.userName,
    input.scope,
    input.sessionId,
    input.messageId ?? null,
    input.sourceId ?? null,
    input.documentId ?? null,
    input.chunkId ?? null,
    input.content,
    JSON.stringify(input.metadata ?? {}),
    now,
    now
  );

  return getNoteById(id)!;
}

export function updateNote(id: string, userId: string, content: string): ChatNoteRow | null {
  const db = getDb();
  const existing = getNoteById(id);
  if (!existing || existing.user_id !== userId) return null;

  const now = new Date().toISOString();
  db.prepare("UPDATE chat_notes SET content = ?, updated_at = ? WHERE id = ?").run(content, now, id);
  return getNoteById(id);
}

export function softDeleteNote(id: string, userId: string): boolean {
  const db = getDb();
  const existing = getNoteById(id);
  if (!existing || existing.user_id !== userId) return false;

  const now = new Date().toISOString();
  db.prepare("UPDATE chat_notes SET status = 'deleted', updated_at = ? WHERE id = ?").run(now, id);
  return true;
}

export function formatNote(row: ChatNoteRow) {
  return {
    id: row.id,
    scope: row.scope,
    session_id: row.session_id,
    message_id: row.message_id,
    source_id: row.source_id,
    document_id: row.document_id,
    chunk_id: row.chunk_id,
    content: row.content,
    metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
