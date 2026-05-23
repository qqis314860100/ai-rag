import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export interface FavoriteItem {
  id: string;
  message_id: string;
  session_id: string;
  session_title: string;
  question: string;
  answer: string;
  sources: unknown[];
  confidence?: number;
  created_at: string;
  saved_at: string;
}

interface FavoriteRow {
  id: string;
  message_id: string;
  session_id: string;
  session_title: string;
  question: string | null;
  answer: string;
  sources_json: string;
  metadata_json: string;
  message_created_at: string;
  saved_at: string;
}

function formatFavorite(row: FavoriteRow): FavoriteItem {
  const metadata = JSON.parse(row.metadata_json || "{}") as { confidence?: number };

  return {
    id: row.id,
    message_id: row.message_id,
    session_id: row.session_id,
    session_title: row.session_title,
    question: row.question || "",
    answer: row.answer,
    sources: JSON.parse(row.sources_json || "[]"),
    confidence: metadata.confidence,
    created_at: row.message_created_at,
    saved_at: row.saved_at,
  };
}

export function listFavorites(userId: string): FavoriteItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      f.id,
      f.message_id,
      m.session_id,
      s.title AS session_title,
      (
        SELECT prev.content
        FROM chat_messages prev
        WHERE prev.session_id = m.session_id
          AND prev.role = 'user'
          AND prev.created_at <= m.created_at
        ORDER BY prev.created_at DESC
        LIMIT 1
      ) AS question,
      m.content AS answer,
      m.sources_json,
      m.metadata_json,
      m.created_at AS message_created_at,
      f.created_at AS saved_at
    FROM favorites f
    JOIN chat_messages m ON m.id = f.message_id
    JOIN chat_sessions s ON s.id = m.session_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(userId) as FavoriteRow[];

  return rows.map(formatFavorite);
}

export function getFavoriteMessageIds(userId: string, messageIds: string[]): string[] {
  if (messageIds.length === 0) return [];

  const db = getDb();
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT message_id
    FROM favorites
    WHERE user_id = ?
      AND message_id IN (${placeholders})
  `).all(userId, ...messageIds) as Array<{ message_id: string }>;

  return rows.map((row) => row.message_id);
}

export function addFavorite(userId: string, messageId: string): FavoriteItem | null {
  const db = getDb();
  const now = new Date().toISOString();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO favorites (id, user_id, message_id, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, message_id) DO NOTHING
  `).run(id, userId, messageId, now);

  const row = db.prepare(`
    SELECT
      f.id,
      f.message_id,
      m.session_id,
      s.title AS session_title,
      (
        SELECT prev.content
        FROM chat_messages prev
        WHERE prev.session_id = m.session_id
          AND prev.role = 'user'
          AND prev.created_at <= m.created_at
        ORDER BY prev.created_at DESC
        LIMIT 1
      ) AS question,
      m.content AS answer,
      m.sources_json,
      m.metadata_json,
      m.created_at AS message_created_at,
      f.created_at AS saved_at
    FROM favorites f
    JOIN chat_messages m ON m.id = f.message_id
    JOIN chat_sessions s ON s.id = m.session_id
    WHERE f.user_id = ?
      AND f.message_id = ?
  `).get(userId, messageId) as FavoriteRow | undefined;

  return row ? formatFavorite(row) : null;
}

export function removeFavorite(userId: string, messageId: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM favorites WHERE user_id = ? AND message_id = ?").run(userId, messageId);
  return result.changes > 0;
}
