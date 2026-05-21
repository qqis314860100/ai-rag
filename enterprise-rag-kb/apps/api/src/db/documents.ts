import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export interface DocumentRow {
  id: string;
  title: string;
  category: string;
  process: string | null;
  station: string | null;
  version: string;
  owner: string | null;
  status: string;
  security_level: string;
  tags_json: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  file_hash: string | null;
  chunk_count: number;
  index_status: string;
  index_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentFilters {
  category?: string;
  status?: string;
  indexStatus?: string;
  securityLevel?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateDocumentInput {
  title: string;
  category: string;
  process?: string;
  station?: string;
  version?: string;
  owner?: string;
  securityLevel: string;
  tags?: string[];
  filePath: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileHash?: string;
  createdBy?: string;
}

export function listDocuments(filters: DocumentFilters = {}) {
  const db = getDb();
  const conditions: string[] = ["d.status != 'deleted'"];
  const params: unknown[] = [];

  if (filters.category) {
    conditions.push("d.category = ?");
    params.push(filters.category);
  }
  if (filters.status) {
    conditions.push("d.status = ?");
    params.push(filters.status);
  }
  if (filters.indexStatus) {
    conditions.push("d.index_status = ?");
    params.push(filters.indexStatus);
  }
  if (filters.securityLevel) {
    conditions.push("d.security_level = ?");
    params.push(filters.securityLevel);
  }
  if (filters.keyword) {
    conditions.push("d.title LIKE ?");
    params.push(`%${filters.keyword}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM documents d ${whereClause}`)
    .get(...params) as { total: number };

  const rows = db
    .prepare(
      `SELECT d.* FROM documents d ${whereClause} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset) as DocumentRow[];

  return {
    items: rows.map(formatDocument),
    total: countRow.total,
    page,
    pageSize,
  };
}

export function getDocumentById(id: string): DocumentRow | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | undefined;
  return row ?? null;
}

export function createDocument(input: CreateDocumentInput): DocumentRow {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO documents (id, title, category, process, station, version, owner, status, security_level, tags_json, file_path, file_name, file_type, file_size, file_hash, chunk_count, index_status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?)`
  ).run(
    id,
    input.title,
    input.category,
    input.process ?? null,
    input.station ?? null,
    input.version ?? "v1.0",
    input.owner ?? null,
    input.securityLevel,
    JSON.stringify(input.tags ?? []),
    input.filePath,
    input.fileName,
    input.fileType,
    input.fileSize,
    input.fileHash ?? null,
    input.createdBy ?? null,
    now,
    now
  );

  return getDocumentById(id)!;
}

export function updateDocument(id: string, updates: Partial<CreateDocumentInput> & { status?: string; indexStatus?: string; indexError?: string | null; chunkCount?: number }): DocumentRow | null {
  const db = getDb();
  const existing = getDocumentById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.title !== undefined) { fields.push("title = ?"); params.push(updates.title); }
  if (updates.category !== undefined) { fields.push("category = ?"); params.push(updates.category); }
  if (updates.process !== undefined) { fields.push("process = ?"); params.push(updates.process); }
  if (updates.station !== undefined) { fields.push("station = ?"); params.push(updates.station); }
  if (updates.version !== undefined) { fields.push("version = ?"); params.push(updates.version); }
  if (updates.owner !== undefined) { fields.push("owner = ?"); params.push(updates.owner); }
  if (updates.securityLevel !== undefined) { fields.push("security_level = ?"); params.push(updates.securityLevel); }
  if (updates.tags !== undefined) { fields.push("tags_json = ?"); params.push(JSON.stringify(updates.tags)); }
  if (updates.status !== undefined) { fields.push("status = ?"); params.push(updates.status); }
  if (updates.indexStatus !== undefined) { fields.push("index_status = ?"); params.push(updates.indexStatus); }
  if (updates.indexError !== undefined) { fields.push("index_error = ?"); params.push(updates.indexError); }
  if (updates.chunkCount !== undefined) { fields.push("chunk_count = ?"); params.push(updates.chunkCount); }
  if (updates.filePath !== undefined) { fields.push("file_path = ?"); params.push(updates.filePath); }

  if (fields.length === 0) return existing;

  fields.push("updated_at = ?");
  params.push(now);
  params.push(id);

  db.prepare(`UPDATE documents SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return getDocumentById(id);
}

export function softDeleteDocument(id: string): boolean {
  const db = getDb();
  const result = db.prepare(
    "UPDATE documents SET status = 'deleted', updated_at = ? WHERE id = ? AND status != 'deleted'"
  ).run(new Date().toISOString(), id);
  return result.changes > 0;
}

export function updateDocumentIndexStatus(
  id: string,
  indexStatus: string,
  chunkCount?: number,
  indexError?: string | null
): DocumentRow | null {
  return updateDocument(id, { indexStatus, chunkCount, indexError });
}

export function formatDocument(row: DocumentRow) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    process: row.process,
    station: row.station,
    version: row.version,
    owner: row.owner,
    status: row.status,
    security_level: row.security_level,
    tags: JSON.parse(row.tags_json || "[]") as string[],
    file_path: row.file_path,
    file_name: row.file_name,
    file_type: row.file_type,
    file_size: row.file_size,
    file_hash: row.file_hash,
    chunk_count: row.chunk_count,
    index_status: row.index_status,
    index_error: row.index_error,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
