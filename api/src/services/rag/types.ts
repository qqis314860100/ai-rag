export interface RagIngestRequest {
  document_id: string;
  file_path: string;
  metadata: {
    title: string;
    category: string;
    security_level: string;
    process?: string;
    station?: string;
    version?: string;
    tags?: string[];
  };
}

export interface RagIngestResponse {
  document_id: string;
  chunk_count: number;
  index_status: string;
}

export interface RagSearchRequest {
  query: string;
  top_k?: number;
  mode?: string;
  allowed_security_levels: string[];
  filters?: {
    category?: string;
    process?: string;
    station?: string;
    tags?: string[];
    document_id?: string;
  };
}

export interface RagSearchResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  section_path?: string;
  page_number?: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface RagSearchResponse {
  query: string;
  results: RagSearchResult[];
  latency_ms: number;
}

export interface RagDebugSearchResponse {
  query: string;
  normalized_query: string;
  filters: Record<string, unknown>;
  retrieval: {
    mode: string;
    top_k: number;
    latency_ms: number;
    results: RagSearchResult[];
  };
  prompt_preview?: string;
  context_chars: number;
  estimated_tokens: number;
}

export interface RagChatRequest {
  query: string;
  top_k?: number;
  allowed_security_levels: string[];
  filters?: {
    category?: string;
    process?: string;
    tags?: string[];
  };
  history?: Array<{ role: string; content: string }>;
  knowledge_assets?: RagKnowledgeAssetContext[];
  stream?: boolean;
}

export interface RagChatResponse {
  answer: string;
  sources: RagSearchResult[];
  confidence?: number;
  followups?: string[];
  trace?: {
    retrieval_ms: number;
    llm_ms: number;
    total_ms: number;
    knowledge_asset_count?: number;
  };
  answer_ir?: RagAnswerIR | null;
  visual_plan?: RagVisualPlan | null;
}

export interface RagAnswerQueryRewrite {
  original_query?: string;
  rewritten_query?: string;
  changed?: boolean;
  strategy?: string;
  reason?: string;
  signals?: string[];
  history_turns?: number;
}

export interface RagAnswerCitation {
  id?: string;
  source_index?: number;
  chunk_id?: string;
  document_id?: string;
  document_title?: string;
  section_path?: string;
  page_number?: number;
  score?: number;
}

export interface RagAnswerClaim {
  id?: string;
  text?: string;
  citation_ids?: string[];
  confidence?: number;
  kind?: string;
}

export interface RagAnswerWarning {
  code?: string;
  message?: string;
  severity?: string;
  citation_ids?: string[];
}

export interface RagAnswerIR {
  schema_version?: string;
  status?: string;
  claims?: RagAnswerClaim[];
  citations?: RagAnswerCitation[];
  query_rewrite?: RagAnswerQueryRewrite;
  confidence?: number;
  warnings?: RagAnswerWarning[];
  metadata?: Record<string, unknown>;
}

export type RagVisualArtifactType = "diagram" | "flowchart" | "mindmap" | "chart" | "table" | "image";

export interface RagVisualArtifactPlan {
  type?: RagVisualArtifactType | string;
  artifact_type?: RagVisualArtifactType | string;
  auto_generate?: boolean;
  title?: string;
  reason?: string;
  confidence?: number;
  priority?: number;
  source_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface RagVisualPlan {
  schema_version?: string;
  can_generate?: boolean;
  artifacts?: RagVisualArtifactPlan[];
  warnings?: RagAnswerWarning[];
  metadata?: Record<string, unknown>;
}

export interface RagKnowledgeAssetContext {
  asset_type: string;
  id: string;
  label: string;
  summary?: string;
  retrieval_terms?: string[];
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface RagImageArtifactContract {
  schema_version?: string;
  renderer?: string;
  status?: string;
  allowed?: boolean;
  async_required?: boolean;
  sanitized_prompt?: string;
  inherited_source_ids?: string[];
  inherited_document_ids?: string[];
  redaction_report?: Record<string, number>;
  safety_warnings?: RagAnswerWarning[];
  failure_fallback?: string;
  metadata?: Record<string, unknown>;
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

export interface DiagramLane {
  id: string;
  label: string;
  order?: number;
  metadata?: Record<string, unknown>;
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
  lanes?: DiagramLane[];
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
