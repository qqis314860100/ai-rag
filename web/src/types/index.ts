export interface Document {
  id: string;
  title: string;
  category: string;
  process?: string;
  station?: string;
  version?: string;
  owner?: string;
  status: "active" | "archived" | "deleted";
  security_level: "public" | "internal" | "confidential" | "restricted";
  index_status: "pending" | "processing" | "ready" | "failed";
  chunk_count: number;
  tags: string[];
  file_type?: string;
  created_at: string;
  updated_at: string;
}

export type PreviewView = "text" | "markdown" | "raw" | "file" | "pdf" | "html" | "code" | "download";

export interface DocumentPreviewContract {
  file_type: string;
  mime_type: string;
  content_kind: "markdown" | "text" | "pdf" | "html" | "code" | "docx" | "binary" | "unknown";
  preferred_view: PreviewView;
  supported_views: PreviewView[];
  capabilities: Partial<Record<PreviewView, boolean>>;
  endpoints: {
    raw: string | null;
    file: string | null;
    chunk: string | null;
    comments: string | null;
  };
  disabled_reasons?: Partial<Record<PreviewView, string>>;
  chunk_endpoint?: string;
  raw_endpoint?: string | null;
  file_endpoint?: string | null;
  comments_endpoint?: string | null;
}

export interface SourceMetadataContract {
  document?: {
    file_type?: string;
    mime_type?: string;
  };
  chunk?: {
    type?: string;
  };
  format?: {
    name?: string;
    mime_type?: string;
  };
  content_kind?: string;
}

export interface Source {
  chunk_id: string;
  document_id: string;
  document_title: string;
  section_path: string;
  page_number?: number;
  score: number;
  snippet: string; content?: string;
  version?: string;
  document_type?: string;
  source_format?: string;
  file_type?: string;
  mime_type?: string;
  format?: string;
  content_kind?: string;
  category?: string;
  metadata?: Record<string, unknown>;
  source_metadata?: SourceMetadataContract;
  preview?: DocumentPreviewContract;
}

export interface ChatMessageTrace {
  retrieval_ms?: number;
  llm_ms?: number;
  total_ms?: number;
  hit_count?: number;
}

export interface ChatMessage {
  id: string;
  persistedId?: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  confidence?: number;
  followups?: string[];
  metadata?: Record<string, unknown> & { trace?: ChatMessageTrace };
  latency_ms?: number | null;
  created_at: string;
  streaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatNote {
  id: string;
  scope: "session" | "message" | "source";
  session_id: string;
  message_id: string | null;
  source_id: string | null;
  document_id: string | null;
  chunk_id: string | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type DiagramType = "mindmap" | "flowchart";

export interface DiagramNode {
  id: string;
  label: string;
  kind: string;
  description?: string;
  source_ids: string[];
  metadata: Record<string, unknown>;
}

export interface DiagramEdge {
  source: string;
  target: string;
  relation: string;
  label?: string;
  metadata: Record<string, unknown>;
}

export interface DiagramIR {
  title: string;
  objective: string;
  diagram_type: DiagramType | string;
  layout_hint: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  notes: string[];
  metadata: Record<string, unknown>;
}

export interface SearchHit {
  chunk_id: string;
  document_id: string;
  document_title: string;
  section_path: string;
  page_number?: number;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  query: string;
  results: SearchHit[];
  latency_ms: number;
}

export interface DebugResult {
  query: string;
  normalized_query: string;
  filters: Record<string, unknown>;
  retrieval: {
    mode: string;
    top_k: number;
    latency_ms: number;
    results: SearchHit[];
  };
  prompt_preview?: string;
  context_chars: number;
  estimated_tokens: number;
}

export interface Feedback {
  id: string;
  message_id: string;
  rating: "up" | "down";
  reason?: string;
  comment?: string;
  status: "open" | "in_progress" | "resolved" | "ignored";
  created_at: string;
}

export interface FavoriteItem {
  id: string;
  message_id: string;
  session_id: string;
  session_title: string;
  question: string;
  answer: string;
  sources: Source[];
  confidence?: number;
  created_at: string;
  saved_at: string;
}

export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: Pagination;
}

export interface ApiResponse<T> {
  data: T;
  request_id?: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  };
  request_id?: string;
}

export interface IndexStatus {
  collection: string;
  document_count: number;
  chunk_count: number;
  embedding_model: string;
  last_rebuild_at?: string;
}

export interface DocComment {
  id: string;
  document_id: string;
  chunk_id: string | null;
  user_id: string;
  user_name: string;
  content: string;
  parent_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export type DocumentStatus = Document["status"];
export type IndexStatusType = Document["index_status"];
export type SecurityLevel = Document["security_level"];
