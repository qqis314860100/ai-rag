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

export function updateUser(id: string, updates: { role?: string; status?: string }): UserRow | null {
  const db = getDb();
  const existing = getUserById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const params: unknown[] = [];
  if (updates.role !== undefined) { fields.push("role = ?"); params.push(updates.role); }
  if (updates.status !== undefined) { fields.push("status = ?"); params.push(updates.status); }
  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return getUserById(id);
}
