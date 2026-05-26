import type Database from "better-sqlite3";

export function createChatTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
      content TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      latency_ms INTEGER,
      token_count INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_sources (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      chunk_id TEXT NOT NULL,
      document_id TEXT,
      document_title TEXT,
      section_path TEXT,
      score REAL NOT NULL DEFAULT 0,
      snippet TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      rating TEXT NOT NULL CHECK(rating IN ('up','down')),
      reason TEXT,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      handled_by TEXT,
      handled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS browse_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL CHECK(scope IN ('session','message','source')),
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES chat_messages(id) ON DELETE CASCADE,
      source_id TEXT,
      document_id TEXT,
      chunk_id TEXT,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','deleted')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function createChatIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_message_sources_message_id ON message_sources(message_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_message_id ON feedback(message_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_message_id ON favorites(message_id);
    CREATE INDEX IF NOT EXISTS idx_browse_history_user_id ON browse_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_browse_history_created_at ON browse_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_notes_target ON chat_notes(scope, session_id, message_id, source_id);
    CREATE INDEX IF NOT EXISTS idx_chat_notes_user ON chat_notes(user_id, status, updated_at);
  `);
}
