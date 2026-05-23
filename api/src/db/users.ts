import { getDb } from "./index";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function getUserByName(name: string): UserRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE name = ? AND status = 'active'").get(name) as UserRow | undefined;
  return row ?? null;
}

export function getUserById(id: string): UserRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ?? null;
}

export function listUsers(): UserRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
}
