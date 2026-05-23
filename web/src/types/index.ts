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
  category?: string;
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
  created_at: string;
  streaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
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
