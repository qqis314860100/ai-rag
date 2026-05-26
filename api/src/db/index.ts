import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { createTables } from "./schema";
import { migrate } from "./schema/migrations";
import { seedData } from "./schema/seed";

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
