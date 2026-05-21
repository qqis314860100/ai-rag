import { getDb } from "./index";

export interface AuditLogRow {
  id: string;
  operator_id: string | null;
  operator_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail_json: string;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
}

export interface AuditLogFilters {
  action?: string;
  operatorId?: string;
  resourceType?: string;
  resourceId?: string;
  page?: number;
  pageSize?: number;
}

export function listAuditLogs(filters: AuditLogFilters = {}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.action) {
    conditions.push("action = ?");
    params.push(filters.action);
  }
  if (filters.operatorId) {
    conditions.push("operator_id = ?");
    params.push(filters.operatorId);
  }
  if (filters.resourceType) {
    conditions.push("resource_type = ?");
    params.push(filters.resourceType);
  }
  if (filters.resourceId) {
    conditions.push("resource_id = ?");
    params.push(filters.resourceId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM audit_logs ${whereClause}`)
    .get(...params) as { total: number };

  const rows = db
    .prepare(`SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as AuditLogRow[];

  return {
    items: rows.map(formatAuditLog),
    total: countRow.total,
    page,
    pageSize,
  };
}

export function formatAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    action: row.action,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    detail: JSON.parse(row.detail_json || "{}"),
    ip: row.ip,
    user_agent: row.user_agent,
    request_id: row.request_id,
    created_at: row.created_at,
  };
}
