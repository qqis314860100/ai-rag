import type Database from "better-sqlite3";
import { createTablesV2 } from "./index";

export function migrate(database: Database.Database): void {
  const tableExists = database.prepare(
    "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='chat_messages'"
  ).get() as { c: number };

  if (tableExists.c === 0) return;

  const hasMessageSources = database.prepare(
    "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='message_sources'"
  ).get() as { c: number };

  if (hasMessageSources.c > 0) return;

  console.log("Migrating database to v2 schema...");

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

  database.exec(`
    ALTER TABLE documents RENAME TO documents_old;
    ALTER TABLE chat_messages RENAME TO chat_messages_old;
    ALTER TABLE chat_sessions RENAME TO chat_sessions_old;
    ALTER TABLE feedback RENAME TO feedback_old;
  `);

  createTablesV2(database);

  database.exec(`
    INSERT INTO documents SELECT * FROM documents_old;
    INSERT INTO chat_sessions SELECT * FROM chat_sessions_old;
    INSERT INTO chat_messages (id, session_id, role, content, sources_json, metadata_json, latency_ms, created_at)
      SELECT id, session_id, role, content, sources_json, metadata_json, latency_ms, created_at FROM chat_messages_old;
    INSERT INTO feedback (id, message_id, user_id, rating, reason, comment, status, resolution, handled_by, handled_at, created_at, updated_at)
      SELECT id, message_id, user_id, rating, reason, comment, status, resolution, handled_by, handled_at, created_at, updated_at FROM feedback_old;
  `);

  database.exec(`
    DROP TABLE documents_old;
    DROP TABLE chat_messages_old;
    DROP TABLE chat_sessions_old;
    DROP TABLE feedback_old;
  `);

  console.log("Migration to v2 complete.");
}
