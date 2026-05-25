import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";
import { touchSession } from "./chatSessions";
import { formatArtifact, listArtifactsByMessage } from "./chatArtifacts";

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  sources_json: string;
  metadata_json: string;
  latency_ms: number | null;
  created_at: string;
}

export interface CreateMessageInput {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  sources?: unknown[];
  metadata?: Record<string, unknown>;
  latencyMs?: number;
}

interface OrderedMessageRow {
  id: string;
  _rowid: number;
}

export function listMessagesBySession(sessionId: string): ChatMessageRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(sessionId) as ChatMessageRow[];
}

export function getMessageById(id: string): ChatMessageRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id) as ChatMessageRow | undefined;
  return row ?? null;
}

function listOrderedMessageIds(sessionId: string): OrderedMessageRow[] {
  const db = getDb();
  return db
    .prepare("SELECT id, rowid AS _rowid FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(sessionId) as OrderedMessageRow[];
}

function getBranchTruncationIds(sessionId: string, messageId: string, includeSelf: boolean): string[] {
  const ordered = listOrderedMessageIds(sessionId);
  const index = ordered.findIndex((row) => row.id === messageId);
  if (index === -1) return [];

  const startIndex = includeSelf ? index : index + 1;
  return ordered.slice(startIndex).map((row) => row.id);
}

function deleteMessageIds(db: ReturnType<typeof getDb>, ids: string[]): void {
  if (ids.length === 0) return;
  const stmt = db.prepare("DELETE FROM chat_messages WHERE id = ?");
  for (const id of ids) {
    stmt.run(id);
  }
}

export function createMessage(input: CreateMessageInput): ChatMessageRow {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, sources_json, metadata_json, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.sessionId,
    input.role,
    input.content,
    JSON.stringify(input.sources ?? []),
    JSON.stringify(input.metadata ?? {}),
    input.latencyMs ?? null,
    now
  );

  // Write message_sources for queryability
  if (input.sources && input.sources.length > 0) {
    const insertSource = db.prepare(
      `INSERT INTO message_sources (id, message_id, chunk_id, document_id, document_title, section_path, score, snippet, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of input.sources as Array<Record<string, unknown>>) {
      insertSource.run(
        uuidv4(), id,
        s.chunk_id || "", s.document_id || null, s.document_title || "", s.section_path || "",
        s.score || 0, s.content || s.snippet || "", now
      );
    }
  }

  touchSession(input.sessionId);
  return getMessageById(id)!;
}

export function updateMessageAndTruncateSession(messageId: string, content: string): ChatMessageRow | null {
  const db = getDb();
  const existing = getMessageById(messageId);
  if (!existing) return null;

  const idsToDelete = getBranchTruncationIds(existing.session_id, messageId, false);
  const truncateBranch = db.transaction((idsToDelete: string[]) => {
    db.prepare("UPDATE chat_messages SET content = ? WHERE id = ?").run(content, messageId);
    deleteMessageIds(db, idsToDelete);
    touchSession(existing.session_id);
  });

  truncateBranch(idsToDelete);
  return getMessageById(messageId);
}

export function deleteMessageAndTruncateSession(messageId: string): boolean {
  const db = getDb();
  const existing = getMessageById(messageId);
  if (!existing) return false;

  const idsToDelete = getBranchTruncationIds(existing.session_id, messageId, true);
  if (idsToDelete.length === 0) return false;
  const truncateBranch = db.transaction((idsToDelete: string[]) => {
    deleteMessageIds(db, idsToDelete);
    touchSession(existing.session_id);
  });

  truncateBranch(idsToDelete);
  return true;
}

export function formatMessage(row: ChatMessageRow) {
  const metadata = JSON.parse(row.metadata_json || "{}");
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content: row.content,
    sources: JSON.parse(row.sources_json || "[]"),
    confidence: metadata.confidence as number | undefined,
    followups: metadata.followups as string[] | undefined,
    artifacts: listArtifactsByMessage(row.id).map(formatArtifact),
    metadata,
    latency_ms: row.latency_ms,
    created_at: row.created_at,
  };
}
