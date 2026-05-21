import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function initDb(databaseUrl: string): Database.Database {
  const dbPath = databaseUrl.replace("file:", "");
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  migrate(db);
  createTables(db);
  seedData(db);

  return db;
}

// ── Migration: upgrade old schema to v2 with FK constraints ──
function migrate(database: Database.Database): void {
  // Check if old tables exist (pre-v2 schema)
  const tableExists = database.prepare(
    "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='chat_messages'"
  ).get() as { c: number };

  if (tableExists.c === 0) return; // Fresh install, no migration needed

  // Check if already v2 (has message_sources table)
  const hasMessageSources = database.prepare(
    "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='message_sources'"
  ).get() as { c: number };

  if (hasMessageSources.c > 0) return; // Already v2

  console.log("Migrating database to v2 schema...");

  // Drop old indexes that reference old tables
  database.exec(`
    DROP INDEX IF EXISTS idx_feedback_message_id;
    DROP INDEX IF EXISTS idx_feedback_status;
    DROP INDEX IF EXISTS idx_feedback_rating;
    DROP INDEX IF EXISTS idx_chat_messages_session_id;
    DROP INDEX IF EXISTS idx_chat_messages_created_at;
    DROP INDEX IF EXISTS idx_chat_sessions_user_id;
    DROP INDEX IF EXISTS idx_chat_sessions_updated_at;
    DROP INDEX IF EXISTS idx_documents_category;
    DROP INDEX IF EXISTS idx_documents_status;
    DROP INDEX IF EXISTS idx_documents_index_status;
    DROP INDEX IF EXISTS idx_documents_security_level;
    DROP INDEX IF EXISTS idx_documents_created_at;
    DROP INDEX IF EXISTS idx_document_versions_document_id;
    DROP INDEX IF EXISTS idx_document_jobs_document_id;
    DROP INDEX IF EXISTS idx_document_jobs_status;
    DROP INDEX IF EXISTS idx_users_role;
    DROP INDEX IF EXISTS idx_users_status;
    DROP INDEX IF EXISTS idx_role_permissions_role_id;
  `);

  // Migrate documents: add FK to users
  database.exec(`
    ALTER TABLE documents RENAME TO documents_old;
    ALTER TABLE chat_messages RENAME TO chat_messages_old;
    ALTER TABLE chat_sessions RENAME TO chat_sessions_old;
    ALTER TABLE feedback RENAME TO feedback_old;
  `);

  // Create v2 tables
  createTablesV2(database);

  // Copy data
  database.exec(`
    INSERT INTO documents SELECT * FROM documents_old;
    INSERT INTO chat_sessions SELECT * FROM chat_sessions_old;
    INSERT INTO chat_messages (id, session_id, role, content, sources_json, metadata_json, latency_ms, created_at)
      SELECT id, session_id, role, content, sources_json, metadata_json, latency_ms, created_at FROM chat_messages_old;
    INSERT INTO feedback (id, message_id, user_id, rating, reason, comment, status, resolution, handled_by, handled_at, created_at, updated_at)
      SELECT id, message_id, user_id, rating, reason, comment, status, resolution, handled_by, handled_at, created_at, updated_at FROM feedback_old;
  `);

  // Drop old tables
  database.exec(`
    DROP TABLE documents_old;
    DROP TABLE chat_messages_old;
    DROP TABLE chat_sessions_old;
    DROP TABLE feedback_old;
  `);

  console.log("Migration to v2 complete.");
}

function createTablesV2(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'active',
      preferences_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(role_id, permission)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      process TEXT,
      station TEXT,
      version TEXT NOT NULL DEFAULT 'v1.0',
      owner TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      security_level TEXT NOT NULL DEFAULT 'internal',
      tags_json TEXT NOT NULL DEFAULT '[]',
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      file_hash TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      index_status TEXT NOT NULL DEFAULT 'pending',
      index_error TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT,
      change_note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(document_id, version)
    );

    CREATE TABLE IF NOT EXISTS document_jobs (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      result_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agent_id TEXT,
      parent_session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
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

    -- N:M source references (replaces sources_json for queryability)
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
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS browse_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

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

    -- Future: agents
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

    -- Future: agent-tool binding
    CREATE TABLE IF NOT EXISTS agent_tools (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      tool_id TEXT NOT NULL,
      config_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(agent_id, tool_id)
    );

    -- Future: agent memory
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

  // Indexes
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
    CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_documents_index_status ON documents(index_status);
    CREATE INDEX IF NOT EXISTS idx_documents_security_level ON documents(security_level);
    CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by);
    CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
    CREATE INDEX IF NOT EXISTS idx_document_versions_document_id ON document_versions(document_id);
    CREATE INDEX IF NOT EXISTS idx_document_jobs_document_id ON document_jobs(document_id);
    CREATE INDEX IF NOT EXISTS idx_document_jobs_status ON document_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_message_sources_message_id ON message_sources(message_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_message_id ON feedback(message_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
    CREATE INDEX IF NOT EXISTS idx_browse_history_user_id ON browse_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_browse_history_created_at ON browse_history(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_operator_id ON audit_logs(operator_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  `);
}

function createTables(database: Database.Database): void {
  // Use v2 schema directly (fresh install path)
  createTablesV2(database);
}

function seedData(database: Database.Database): void {
  const now = new Date().toISOString();

  // Seed default users
  const userCount = database.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    const insertUser = database.prepare(
      "INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const users = [
      { name: "admin", email: "admin@battery.local", password: "admin123", role: "system_admin" },
      { name: "editor", email: "editor@battery.local", password: "editor123", role: "knowledge_admin" },
      { name: "viewer", email: "viewer@battery.local", password: "viewer123", role: "viewer" },
    ];

    const insertUsers = database.transaction(() => {
      for (const u of users) {
        insertUser.run(uuidv4(), u.name, u.email, bcrypt.hashSync(u.password, 10), u.role, "active", now, now);
      }
    });
    insertUsers();
  }

  // Seed roles
  const roleCount = database.prepare("SELECT COUNT(*) as count FROM roles").get() as { count: number };
  if (roleCount.count === 0) {
    const insertRole = database.prepare("INSERT INTO roles (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
    for (const [id, name, desc] of [
      ["role_viewer", "viewer", "只读用户"],
      ["role_operator", "operator", "产线操作员"],
      ["role_process_engineer", "process_engineer", "工艺工程师"],
      ["role_equipment_engineer", "equipment_engineer", "设备工程师"],
      ["role_quality_engineer", "quality_engineer", "质量工程师"],
      ["role_knowledge_admin", "knowledge_admin", "知识库管理员"],
      ["role_system_admin", "system_admin", "系统管理员"],
    ]) {
      insertRole.run(id, name, desc, now, now);
    }
  }

  // Seed default settings
  const settingsCount = database.prepare("SELECT COUNT(*) as count FROM settings").get() as { count: number };
  if (settingsCount.count === 0) {
    const insertSetting = database.prepare("INSERT INTO settings (key, value, value_type, description, updated_at) VALUES (?, ?, ?, ?, ?)");
    for (const [key, value, valueType, desc] of [
      ["rag_top_k", "5", "number", "默认检索 TopK"],
      ["rag_temperature", "0.2", "number", "默认模型温度"],
      ["rag_max_context_chars", "12000", "number", "RAG 最大上下文字符数"],
      ["embedding_model", "BAAI/bge-small-zh-v1.5", "string", "默认 embedding 模型"],
      ["chroma_collection", "battery_line_knowledge_v1", "string", "默认 ChromaDB collection"],
    ]) {
      insertSetting.run(key, value, valueType, desc, now);
    }
  }
}
