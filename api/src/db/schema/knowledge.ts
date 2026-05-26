import type Database from "better-sqlite3";

export function createKnowledgeTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS terminology_terms (
      id TEXT PRIMARY KEY,
      canonical_term TEXT NOT NULL UNIQUE,
      abbreviation TEXT NOT NULL DEFAULT '',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      synonyms_json TEXT NOT NULL DEFAULT '[]',
      definition TEXT NOT NULL DEFAULT '',
      applicable_scenarios_json TEXT NOT NULL DEFAULT '[]',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      related_topics_json TEXT NOT NULL DEFAULT '[]',
      retrieval_terms_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','archived')),
      source TEXT NOT NULL DEFAULT 'manual',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_cards (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      key_parameters_json TEXT NOT NULL DEFAULT '[]',
      steps_json TEXT NOT NULL DEFAULT '[]',
      risks_json TEXT NOT NULL DEFAULT '[]',
      handling_methods_json TEXT NOT NULL DEFAULT '[]',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      related_terms_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'ai_draft' CHECK(status IN ('ai_draft','pending_review','returned','published','archived')),
      reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewer_name TEXT,
      reviewed_at TEXT,
      current_version INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_card_versions (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES knowledge_cards(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      change_note TEXT,
      changed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      changed_by_name TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(card_id, version)
    );

    CREATE TABLE IF NOT EXISTS knowledge_faqs (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      applicable_scope TEXT NOT NULL DEFAULT '',
      invalid_conditions_json TEXT NOT NULL DEFAULT '[]',
      related_card_ids_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'ai_draft' CHECK(status IN ('ai_draft','pending_review','returned','published','archived')),
      frequency_count INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by_name TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export function createKnowledgeIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_terminology_terms_status ON terminology_terms(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_terminology_terms_canonical ON terminology_terms(canonical_term);
    CREATE INDEX IF NOT EXISTS idx_knowledge_cards_status ON knowledge_cards(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_cards_topic ON knowledge_cards(topic);
    CREATE INDEX IF NOT EXISTS idx_knowledge_cards_reviewer ON knowledge_cards(reviewer_id, status);
    CREATE INDEX IF NOT EXISTS idx_knowledge_card_versions_card_id ON knowledge_card_versions(card_id, version);
    CREATE INDEX IF NOT EXISTS idx_knowledge_faqs_status ON knowledge_faqs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_faqs_question ON knowledge_faqs(normalized_question);
  `);
}
