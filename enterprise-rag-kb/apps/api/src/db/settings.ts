import { getDb } from "./index";

export interface SettingRow {
  key: string;
  value: string;
  value_type: string;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export function getAllSettings(): Record<string, { value: string; value_type: string; description: string | null }> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM settings").all() as SettingRow[];
  const result: Record<string, { value: string; value_type: string; description: string | null }> = {};
  for (const row of rows) {
    result[row.key] = {
      value: row.value,
      value_type: row.value_type,
      description: row.description,
    };
  }
  return result;
}

export function getSetting(key: string): SettingRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM settings WHERE key = ?").get(key) as SettingRow | undefined;
  return row ?? null;
}

export function setSetting(key: string, value: string, updatedBy?: string): SettingRow {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getSetting(key);

  if (existing) {
    db.prepare(
      "UPDATE settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?"
    ).run(value, updatedBy ?? null, now, key);
  } else {
    db.prepare(
      "INSERT INTO settings (key, value, value_type, updated_by, updated_at) VALUES (?, ?, 'string', ?, ?)"
    ).run(key, value, updatedBy ?? null, now);
  }

  return getSetting(key)!;
}

export function getAllSettingsFlat(): Array<{ key: string; value: string }> {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  return rows;
}

export function setMultipleSettings(
  updates: Record<string, string>,
  updatedBy?: string
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const upsert = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      const existing = db.prepare("SELECT key FROM settings WHERE key = ?").get(key);
      if (existing) {
        db.prepare(
          "UPDATE settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?"
        ).run(value, updatedBy ?? null, now, key);
      } else {
        db.prepare(
          "INSERT INTO settings (key, value, value_type, updated_by, updated_at) VALUES (?, ?, 'string', ?, ?)"
        ).run(key, value, updatedBy ?? null, now);
      }
    }
  });

  upsert();
}
