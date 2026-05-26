import type Database from "better-sqlite3";

export function createIdentityTables(database: Database.Database): void {
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
  `);
}

export function createIdentityIndexes(database: Database.Database): void {
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
  `);
}
