import type Database from "better-sqlite3";

export function createArtifactTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      renderer TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('pending','ready','failed','deleted')),
      confidence REAL NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function createArtifactIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_artifacts_message_id ON chat_artifacts(message_id, status);
    CREATE INDEX IF NOT EXISTS idx_chat_artifacts_session_id ON chat_artifacts(session_id, status, updated_at);
  `);
}
