import type Database from "better-sqlite3";

export function createPlatformTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      operator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      operator_name TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      detail_json TEXT NOT NULL DEFAULT '{}',
      ip TEXT,
      user_agent TEXT,
      request_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'string',
      description TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'deepseek-chat',
      temperature REAL NOT NULL DEFAULT 0.2,
      tools_json TEXT DEFAULT '[]',
      created_by TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_tools (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      tool_id TEXT NOT NULL,
      config_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(agent_id, tool_id)
    );

    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      agent_id TEXT REFERENCES agents(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, key)
    );
  `);
}

export function createPlatformIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_operator_id ON audit_logs(operator_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  `);
}
