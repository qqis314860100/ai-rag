import { getDb } from "./index";
import { ChatMessageRow, getMessageById } from "./chatMessages";

export interface MessageSourceRow {
  id: string;
  message_id: string;
  chunk_id: string;
  document_id: string | null;
  document_title: string | null;
  section_path: string | null;
  score: number;
  snippet: string | null;
  created_at: string;
  document_category: string | null;
  document_process: string | null;
  document_station: string | null;
  document_version: string | null;
  document_status: string | null;
  document_security_level: string | null;
  document_file_name: string | null;
  document_file_type: string | null;
  document_file_size: number | null;
  document_index_status: string | null;
  document_updated_at: string | null;
}

interface SourceJson {
  chunk_id?: string;
  document_id?: string;
  document_title?: string;
  section_path?: string;
  page_number?: number;
  score?: number;
  snippet?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface MessageSourceDetail {
  id: string;
  message_id: string;
  chunk_id: string;
  document_id: string | null;
  document_title: string;
  section_path: string;
  score: number;
  snippet: string;
  content: string;
  page_number?: number;
  metadata: Record<string, unknown>;
  document: {
    id: string;
    title: string;
    category: string | null;
    process: string | null;
    station: string | null;
    version: string | null;
    status: string | null;
    security_level: string | null;
    file_name: string | null;
    file_type: string | null;
    file_size: number | null;
    index_status: string | null;
    updated_at: string | null;
  } | null;
  preview: {
    chunk_endpoint: string;
    raw_endpoint: string | null;
    file_endpoint: string | null;
    comments_endpoint: string | null;
  };
  missing_fields: string[];
  created_at: string | null;
}

function parseSourcesJson(message: ChatMessageRow): SourceJson[] {
  try {
    const parsed = JSON.parse(message.sources_json || "[]") as unknown;
    return Array.isArray(parsed) ? parsed as SourceJson[] : [];
  } catch {
    return [];
  }
}

function sourceJsonForRow(sources: SourceJson[], row: MessageSourceRow, index: number): SourceJson {
  return sources.find((source) => source.chunk_id && source.chunk_id === row.chunk_id) ?? sources[index] ?? {};
}

function listSourceRows(messageId: string): MessageSourceRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT
       ms.*,
       d.category AS document_category,
       d.process AS document_process,
       d.station AS document_station,
       d.version AS document_version,
       d.status AS document_status,
       d.security_level AS document_security_level,
       d.file_name AS document_file_name,
       d.file_type AS document_file_type,
       d.file_size AS document_file_size,
       d.index_status AS document_index_status,
       d.updated_at AS document_updated_at
     FROM message_sources ms
     LEFT JOIN documents d ON d.id = ms.document_id
     WHERE ms.message_id = ?
     ORDER BY ms.created_at ASC, ms.rowid ASC`
  ).all(messageId) as MessageSourceRow[];
}

function sourceJsonToRow(messageId: string, source: SourceJson, index: number): MessageSourceRow {
  const documentId = source.document_id ?? null;
  const db = getDb();
  const doc = documentId
    ? db.prepare(
      `SELECT
         category AS document_category,
         process AS document_process,
         station AS document_station,
         version AS document_version,
         status AS document_status,
         security_level AS document_security_level,
         file_name AS document_file_name,
         file_type AS document_file_type,
         file_size AS document_file_size,
         index_status AS document_index_status,
         updated_at AS document_updated_at
       FROM documents
       WHERE id = ?`
    ).get(documentId) as Omit<MessageSourceRow, "id" | "message_id" | "chunk_id" | "document_id" | "document_title" | "section_path" | "score" | "snippet" | "created_at"> | undefined
    : undefined;

  return {
    id: `source-${index + 1}`,
    message_id: messageId,
    chunk_id: source.chunk_id ?? `source-${index + 1}`,
    document_id: documentId,
    document_title: source.document_title ?? null,
    section_path: source.section_path ?? null,
    score: source.score ?? 0,
    snippet: source.snippet ?? source.content ?? null,
    created_at: "",
    document_category: doc?.document_category ?? null,
    document_process: doc?.document_process ?? null,
    document_station: doc?.document_station ?? null,
    document_version: doc?.document_version ?? null,
    document_status: doc?.document_status ?? null,
    document_security_level: doc?.document_security_level ?? null,
    document_file_name: doc?.document_file_name ?? null,
    document_file_type: doc?.document_file_type ?? null,
    document_file_size: doc?.document_file_size ?? null,
    document_index_status: doc?.document_index_status ?? null,
    document_updated_at: doc?.document_updated_at ?? null,
  };
}

function formatSourceDetail(row: MessageSourceRow, sourceJson: SourceJson): MessageSourceDetail {
  const documentId = row.document_id ?? sourceJson.document_id ?? null;
  const documentTitle = row.document_title || sourceJson.document_title || "未知文档";
  const sectionPath = row.section_path || sourceJson.section_path || "";
  const content = sourceJson.content || row.snippet || sourceJson.snippet || "";
  const snippet = row.snippet || sourceJson.snippet || content.slice(0, 200);
  const rawEndpoint = documentId
    ? `/api/documents/${encodeURIComponent(documentId)}/raw?section_path=${encodeURIComponent(sectionPath)}`
    : null;
  const missingFields = [
    !documentId ? "document_id" : null,
    !sectionPath ? "section_path" : null,
    !content ? "content" : null,
    sourceJson.page_number === undefined ? "page_number" : null,
    sourceJson.metadata?.offset === undefined ? "offset" : null,
  ].filter((field): field is string => Boolean(field));

  return {
    id: row.id,
    message_id: row.message_id,
    chunk_id: row.chunk_id,
    document_id: documentId,
    document_title: documentTitle,
    section_path: sectionPath,
    score: row.score || sourceJson.score || 0,
    snippet,
    content,
    ...(sourceJson.page_number !== undefined ? { page_number: sourceJson.page_number } : {}),
    metadata: sourceJson.metadata ?? {},
    document: documentId
      ? {
        id: documentId,
        title: documentTitle,
        category: row.document_category,
        process: row.document_process,
        station: row.document_station,
        version: row.document_version,
        status: row.document_status,
        security_level: row.document_security_level,
        file_name: row.document_file_name,
        file_type: row.document_file_type,
        file_size: row.document_file_size,
        index_status: row.document_index_status,
        updated_at: row.document_updated_at,
      }
      : null,
    preview: {
      chunk_endpoint: `/api/documents/chunks/${encodeURIComponent(row.chunk_id)}`,
      raw_endpoint: rawEndpoint,
      file_endpoint: documentId ? `/api/documents/${encodeURIComponent(documentId)}/file` : null,
      comments_endpoint: documentId
        ? `/api/documents/${encodeURIComponent(documentId)}/comments?chunk_id=${encodeURIComponent(row.chunk_id)}`
        : null,
    },
    missing_fields: missingFields,
    created_at: row.created_at || null,
  };
}

export function listMessageSourceDetails(messageId: string): MessageSourceDetail[] {
  const message = getMessageById(messageId);
  if (!message) return [];

  const sourceJson = parseSourcesJson(message);
  const rows = listSourceRows(messageId);
  const sourceRows = rows.length > 0
    ? rows
    : sourceJson.map((source, index) => sourceJsonToRow(messageId, source, index));

  return sourceRows.map((row, index) => formatSourceDetail(row, sourceJsonForRow(sourceJson, row, index)));
}

export function getMessageSourceDetail(messageId: string, sourceId: string): MessageSourceDetail | null {
  const sources = listMessageSourceDetails(messageId);
  return sources.find((source, index) =>
    source.id === sourceId ||
    source.chunk_id === sourceId ||
    String(index) === sourceId
  ) ?? null;
}
