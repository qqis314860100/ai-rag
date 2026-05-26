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
  artifacts?: ChatArtifact[];
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

export interface ChatNoteSourceAggregate {
  id: string;
  chunk_id: string;
  document_id: string | null;
  document_title: string;
  section_path: string;
  score: number;
  snippet: string;
  notes: ChatNote[];
  comments: Array<{
    id: string;
    user_name: string;
    content: string;
    parent_id: string | null;
    created_at: string;
    updated_at: string;
  }>;
}

export interface ChatNoteAggregateItem {
  message_id: string;
  question: string;
  answer_preview: string;
  confidence: number;
  notes: ChatNote[];
  sources: ChatNoteSourceAggregate[];
  risks: Array<Record<string, unknown>>;
  manual_note_count: number;
  source_comment_count: number;
  created_at: string;
}

export interface ChatNoteAggregate {
  session_notes: ChatNote[];
  items: ChatNoteAggregateItem[];
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

export interface DiagramQualityWarning {
  code: string;
  message: string;
  severity?: string;
  node_ids?: string[];
  edge_ids?: string[];
  source_ids?: string[];
}

export interface DiagramValidationResult {
  can_generate?: boolean;
  quality_score?: number;
  warnings?: DiagramQualityWarning[];
  errors?: DiagramQualityWarning[];
  required_source_ids?: string[];
  covered_source_ids?: string[];
  missing_source_ids?: string[];
  citation_coverage_ratio?: number;
  node_count?: number;
  edge_count?: number;
}

export interface DiagramIR {
  title: string;
  objective: string;
  type: DiagramType | string;
  diagram_type?: DiagramType | string;
  layout_hint: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  notes: string[];
  renderer?: string;
  reason?: string;
  confidence?: number;
  can_generate?: boolean;
  quality_score?: number;
  quality_warnings?: DiagramQualityWarning[];
  validation?: DiagramValidationResult | null;
  source_evidence?: Record<string, unknown>[];
  excalidraw_scene?: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export type ArtifactStatus = "pending" | "ready" | "failed" | "deleted";

export interface ChatArtifact {
  id: string;
  session_id: string;
  message_id: string;
  type: string;
  renderer: string;
  title: string;
  summary: string;
  reason: string;
  status: ArtifactStatus;
  confidence: number;
  payload: unknown;
  source_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type KnowledgeCardStatus = "ai_draft" | "pending_review" | "returned" | "published" | "archived";

export interface KnowledgeCardSourceRef {
  document_id?: string;
  chunk_id?: string;
  message_id?: string;
  source_id?: string;
  title?: string;
  section_path?: string;
  snippet?: string;
  score?: number;
}

export interface KnowledgeCardKeyParameter {
  name: string;
  value?: string;
  unit?: string;
  range?: string;
  description?: string;
}

export interface KnowledgeCardStep {
  title: string;
  description?: string;
  order?: number;
}

export interface KnowledgeCardRisk {
  title: string;
  level?: "low" | "medium" | "high" | "critical";
  description?: string;
}

export interface KnowledgeCardHandlingMethod {
  title: string;
  description?: string;
  related_risk?: string;
}

export interface KnowledgeCardVersion {
  id: string;
  card_id: string;
  version: number;
  snapshot: Record<string, unknown>;
  change_note: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  created_at: string;
}

export interface KnowledgeCard {
  id: string;
  topic: string;
  summary: string;
  key_parameters: KnowledgeCardKeyParameter[];
  steps: KnowledgeCardStep[];
  risks: KnowledgeCardRisk[];
  handling_methods: KnowledgeCardHandlingMethod[];
  source_refs: KnowledgeCardSourceRef[];
  related_terms: string[];
  status: KnowledgeCardStatus;
  reviewer_id: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  current_version: number;
  created_by: string | null;
  created_by_name: string | null;
  metadata: Record<string, unknown>;
  version_history: KnowledgeCardVersion[];
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFaq {
  id: string;
  question: string;
  answer: string;
  source_refs: KnowledgeCardSourceRef[];
  applicable_scope: string;
  invalid_conditions: string[];
  related_card_ids: string[];
  tags: string[];
  status: KnowledgeCardStatus;
  frequency_count: number;
  created_by: string | null;
  created_by_name: string | null;
  metadata: Record<string, unknown>;
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
