import { randomBytes, createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

const VALID_SECURITY_LEVELS = new Set(["public", "internal", "confidential", "restricted"]);

export interface IntegrationApiTokenRow {
  id: string;
  client_id: string;
  token_hash: string;
  status: "active" | "revoked";
  allowed_security_levels_json: string;
  created_by: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeLevels(levels?: string[]): string[] {
  const normalized = (levels ?? ["public", "internal"]).filter((level) => VALID_SECURITY_LEVELS.has(level));
  return normalized.length > 0 ? normalized : ["public"];
}

function formatToken(row: IntegrationApiTokenRow) {
  return {
    id: row.id,
    client_id: row.client_id,
    token_hash_prefix: row.token_hash.slice(0, 16),
    status: row.status,
    allowed_security_levels: JSON.parse(row.allowed_security_levels_json || "[]") as string[],
    created_by: row.created_by,
    revoked_by: row.revoked_by,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listIntegrationTokens() {
  const rows = getDb()
    .prepare("SELECT * FROM integration_api_tokens ORDER BY updated_at DESC")
    .all() as IntegrationApiTokenRow[];
  return rows.map(formatToken);
}

export function createIntegrationToken(input: {
  clientId: string;
  allowedSecurityLevels?: string[];
  createdBy?: string;
}) {
  const now = new Date().toISOString();
  const id = uuidv4();
  const token = `rag_${randomBytes(24).toString("base64url")}`;
  const tokenHash = hashToken(token);
  const levels = normalizeLevels(input.allowedSecurityLevels);
  getDb()
    .prepare(
      `INSERT INTO integration_api_tokens (
         id, client_id, token_hash, status, allowed_security_levels_json,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`
    )
    .run(id, input.clientId, tokenHash, JSON.stringify(levels), input.createdBy ?? null, now, now);

  const row = getDb().prepare("SELECT * FROM integration_api_tokens WHERE id = ?").get(id) as IntegrationApiTokenRow;
  return {
    ...formatToken(row),
    token,
  };
}

export function revokeIntegrationToken(id: string, revokedBy?: string) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE integration_api_tokens
       SET status = 'revoked', revoked_by = ?, revoked_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(revokedBy ?? null, now, now, id);
  const row = getDb().prepare("SELECT * FROM integration_api_tokens WHERE id = ?").get(id) as IntegrationApiTokenRow | undefined;
  return row ? formatToken(row) : null;
}

export function findActiveIntegrationTokenByHash(tokenHash: string): IntegrationApiTokenRow | null {
  const row = getDb()
    .prepare("SELECT * FROM integration_api_tokens WHERE token_hash = ? AND status = 'active' LIMIT 1")
    .get(tokenHash) as IntegrationApiTokenRow | undefined;
  return row ?? null;
}

export function markIntegrationTokenUsed(id: string): void {
  const now = new Date().toISOString();
  getDb().prepare("UPDATE integration_api_tokens SET last_used_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
}

export function parseAllowedLevels(row: IntegrationApiTokenRow): string[] {
  try {
    return normalizeLevels(JSON.parse(row.allowed_security_levels_json || "[]") as string[]);
  } catch {
    return ["public"];
  }
}

export { hashToken as hashIntegrationToken };

