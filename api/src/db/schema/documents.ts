import type Database from "better-sqlite3";

export function createDocumentTables(database: Database.Database): void {
  database.exec(`
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

    CREATE TABLE IF NOT EXISTS doc_comments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_id TEXT,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','deleted')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function createDocumentIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_documents_index_status ON documents(index_status);
    CREATE INDEX IF NOT EXISTS idx_documents_security_level ON documents(security_level);
    CREATE INDEX IF NOT EXISTS idx_documents_created_by ON documents(created_by);
    CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
    CREATE INDEX IF NOT EXISTS idx_document_versions_document_id ON document_versions(document_id);
    CREATE INDEX IF NOT EXISTS idx_document_jobs_document_id ON document_jobs(document_id);
    CREATE INDEX IF NOT EXISTS idx_document_jobs_status ON document_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_doc_comments_doc ON doc_comments(document_id, chunk_id);
    CREATE INDEX IF NOT EXISTS idx_doc_comments_parent ON doc_comments(parent_id);
  `);
}
