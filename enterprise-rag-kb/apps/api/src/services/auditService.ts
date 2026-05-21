import { Request } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db";

export interface AuditEntry {
  operatorId?: string;
  operatorName?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  detail?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export function writeAuditLog(entry: AuditEntry): void {
  try {
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO audit_logs (id, operator_id, operator_name, action, resource_type, resource_id, detail_json, ip, user_agent, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      entry.operatorId ?? null,
      entry.operatorName ?? null,
      entry.action,
      entry.resourceType ?? null,
      entry.resourceId ?? null,
      JSON.stringify(entry.detail ?? {}),
      entry.ip ?? null,
      entry.userAgent ?? null,
      entry.requestId ?? null,
      now
    );
  } catch {
    // Audit logging should not break the main flow
  }
}

export function auditFromRequest(
  req: Request,
  action: string,
  resourceType?: string,
  resourceId?: string,
  detail?: Record<string, unknown>
): void {
  writeAuditLog({
    operatorId: req.user?.id,
    operatorName: req.user?.name,
    action,
    resourceType,
    resourceId,
    detail,
    ip: req.ip ?? undefined,
    userAgent: req.headers["user-agent"] as string | undefined,
    requestId: req.requestId,
  });
}
