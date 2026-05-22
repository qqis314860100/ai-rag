import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export interface DocCommentRow {
  id: string;
  document_id: string;
  chunk_id: string | null;
  user_id: string;
  user_name: string;
  content: string;
  parent_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCommentInput {
  documentId: string;
  chunkId?: string;
  userId: string;
  userName: string;
  content: string;
  parentId?: string;
}

export function listComments(documentId: string, chunkId?: string): DocCommentRow[] {
  const db = getDb();
  if (chunkId) {
    return db.prepare(
      "SELECT * FROM doc_comments WHERE document_id = ? AND chunk_id = ? AND status = 'active' ORDER BY created_at ASC"
    ).all(documentId, chunkId) as DocCommentRow[];
  }
  return db.prepare(
    "SELECT * FROM doc_comments WHERE document_id = ? AND chunk_id IS NULL AND status = 'active' ORDER BY created_at ASC"
  ).all(documentId) as DocCommentRow[];
}

export function createComment(input: CreateCommentInput): DocCommentRow {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO doc_comments (id, document_id, chunk_id, user_id, user_name, content, parent_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, input.documentId, input.chunkId ?? null, input.userId, input.userName, input.content, input.parentId ?? null, now, now);

  return db.prepare("SELECT * FROM doc_comments WHERE id = ?").get(id) as DocCommentRow;
}

export function updateComment(id: string, userId: string, content: string): DocCommentRow | null {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM doc_comments WHERE id = ? AND status = 'active'").get(id) as DocCommentRow | undefined;
  if (!existing || existing.user_id !== userId) return null;

  const now = new Date().toISOString();
  db.prepare("UPDATE doc_comments SET content = ?, updated_at = ? WHERE id = ?").run(content, now, id);
  return db.prepare("SELECT * FROM doc_comments WHERE id = ?").get(id) as DocCommentRow;
}

export function softDeleteComment(id: string, userId: string): boolean {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM doc_comments WHERE id = ? AND status = 'active'").get(id) as DocCommentRow | undefined;
  if (!existing || existing.user_id !== userId) return false;

  const now = new Date().toISOString();
  db.prepare("UPDATE doc_comments SET status = 'deleted', updated_at = ? WHERE id = ?").run(now, id);
  return true;
}
