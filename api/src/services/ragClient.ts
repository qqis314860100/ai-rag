import { loadConfig, Config } from "../config";
import { AppError, ErrorCodes } from "../utils/errors";
import { z } from "zod";

let config: Config;

function getConfig(): Config {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

interface RagIngestRequest {
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

interface RagIngestResponse {
  document_id: string;
  chunk_count: number;
  index_status: string;
}

interface RagSearchRequest {
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

interface RagSearchResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  section_path?: string;
  page_number?: number;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface RagSearchResponse {
  query: string;
  results: RagSearchResult[];
  latency_ms: number;
}

interface RagDebugSearchResponse {
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

interface RagChatRequest {
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

interface RagChatResponse {
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

type DiagramType = "mindmap" | "flowchart";

interface DiagramNode {
  id: string;
  label: string;
  kind: string;
  description?: string;
  source_ids: string[];
  metadata: Record<string, unknown>;
}

interface DiagramEdge {
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

const unknownRecordSchema = z.record(z.unknown());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ragSearchResultSchema = z.object({
  chunk_id: z.string(),
  document_id: z.string(),
  document_title: z.string(),
  section_path: z.string().optional(),
  page_number: z.number().optional(),
  content: z.string(),
  score: z.number(),
  metadata: unknownRecordSchema.default({}),
}).passthrough();

const ragAnswerWarningSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  severity: z.string().optional(),
  citation_ids: z.array(z.string()).optional(),
}).passthrough();

const ragAnswerIRSchema = z.object({
  schema_version: z.string().optional(),
  status: z.string().optional(),
  claims: z.array(z.object({
    id: z.string().optional(),
    text: z.string().optional(),
    citation_ids: z.array(z.string()).optional(),
    confidence: z.number().optional(),
    kind: z.string().optional(),
  }).passthrough()).optional(),
  citations: z.array(z.object({
    id: z.string().optional(),
    source_index: z.number().optional(),
    chunk_id: z.string().optional(),
    document_id: z.string().optional(),
    document_title: z.string().optional(),
    section_path: z.string().optional(),
    page_number: z.number().optional(),
    score: z.number().optional(),
  }).passthrough()).optional(),
  query_rewrite: z.object({
    original_query: z.string().optional(),
    rewritten_query: z.string().optional(),
    changed: z.boolean().optional(),
    strategy: z.string().optional(),
    reason: z.string().optional(),
    signals: z.array(z.string()).optional(),
    history_turns: z.number().optional(),
  }).passthrough().optional(),
  confidence: z.number().optional(),
  warnings: z.array(ragAnswerWarningSchema).optional(),
  metadata: unknownRecordSchema.optional(),
}).passthrough();

const ragVisualPlanSchema = z.object({
  schema_version: z.string().optional(),
  can_generate: z.boolean().optional(),
  artifacts: z.array(z.object({
    type: z.string(),
    artifact_type: z.string().optional(),
    auto_generate: z.boolean().optional(),
    title: z.string().optional(),
    reason: z.string().optional(),
    confidence: z.number().optional(),
    priority: z.number().optional(),
    source_ids: z.array(z.string()).optional(),
    metadata: unknownRecordSchema.optional(),
  }).passthrough()).optional(),
  warnings: z.array(ragAnswerWarningSchema).optional(),
  metadata: unknownRecordSchema.optional(),
}).passthrough();

const ragChatResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(ragSearchResultSchema),
  confidence: z.number().optional(),
  followups: z.array(z.string()).optional(),
  trace: z.object({
    retrieval_ms: z.number(),
    llm_ms: z.number(),
    total_ms: z.number(),
    knowledge_asset_count: z.number().optional(),
  }).passthrough().optional(),
  answer_ir: ragAnswerIRSchema.nullable().optional(),
  visual_plan: ragVisualPlanSchema.nullable().optional(),
}).passthrough();

const diagramWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.string().optional(),
  node_ids: z.array(z.string()).optional(),
  edge_ids: z.array(z.string()).optional(),
  source_ids: z.array(z.string()).optional(),
}).passthrough();

const diagramIRSchema = z.object({
  title: z.string(),
  objective: z.string(),
  type: z.string(),
  diagram_type: z.string().optional(),
  layout_hint: z.string(),
  nodes: z.array(z.object({
    id: z.string(),
    label: z.string(),
    kind: z.string(),
    description: z.string().optional(),
    source_ids: z.array(z.string()),
    metadata: unknownRecordSchema,
  }).passthrough()),
  edges: z.array(z.object({
    source: z.string(),
    target: z.string(),
    relation: z.string(),
    label: z.string().optional(),
    metadata: unknownRecordSchema,
  }).passthrough()),
  notes: z.array(z.string()),
  renderer: z.string().optional(),
  reason: z.string().optional(),
  confidence: z.number().optional(),
  can_generate: z.boolean().optional(),
  quality_score: z.number().optional(),
  quality_warnings: z.array(diagramWarningSchema).optional(),
  validation: z.object({
    can_generate: z.boolean().optional(),
    quality_score: z.number().optional(),
    warnings: z.array(diagramWarningSchema).optional(),
    errors: z.array(diagramWarningSchema).optional(),
    required_source_ids: z.array(z.string()).optional(),
    covered_source_ids: z.array(z.string()).optional(),
    missing_source_ids: z.array(z.string()).optional(),
    citation_coverage_ratio: z.number().optional(),
    node_count: z.number().optional(),
    edge_count: z.number().optional(),
  }).passthrough().nullable().optional(),
  source_evidence: z.array(unknownRecordSchema).optional(),
  excalidraw_scene: unknownRecordSchema.nullable().optional(),
  metadata: unknownRecordSchema,
}).passthrough();

function parseRagContract<T>(label: string, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data;

  // RAG 契约错误必须停在 API 边界，避免坏结构继续渗到前端。
  throw new AppError(ErrorCodes.RAG_SERVICE_ERROR, `${label} 契约校验失败。`, 502, {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    })),
  });
}

async function ragFetch<T>(
  path: string,
  body: unknown,
  requestId?: string,
  userId?: string
): Promise<T> {
  const cfg = getConfig();
  const url = `${cfg.ragServiceUrl}${path}`;

  let lastError: Error | null = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestId ? { "X-Request-Id": requestId } : {}),
          ...(userId ? { "X-User-Id": userId } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorDetail: Record<string, unknown> | undefined;
        try {
          errorDetail = JSON.parse(errorText);
        } catch {
          // Not JSON
        }

        if (response.status === 503 || response.status === 502) {
          throw new AppError(
            ErrorCodes.VECTOR_STORE_UNAVAILABLE,
            "向量库不可用，请稍后重试。",
            503,
            errorDetail
          );
        }
        if (response.status === 429) {
          const detail = isRecord(errorDetail?.detail)
            ? errorDetail.detail
            : isRecord(errorDetail)
              ? errorDetail
              : undefined;
          const message = typeof detail?.message === "string" ? detail.message : "LLM 使用量已达到本地限制。";
          throw new AppError(
            ErrorCodes.LLM_BUDGET_EXCEEDED,
            message,
            429,
            detail
          );
        }

        throw new AppError(
          ErrorCodes.RAG_SERVICE_ERROR,
          `RAG 服务返回错误: ${response.status}`,
          502,
          errorDetail
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (err instanceof AppError) {
        // Don't retry client errors
        if (err.statusCode < 500) throw err;
      }

      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError || new AppError(ErrorCodes.RAG_SERVICE_ERROR, "RAG 服务调用失败。", 502);
}

export async function ingestDocument(
  documentId: string,
  filePath: string,
  metadata: RagIngestRequest["metadata"],
  requestId?: string
): Promise<RagIngestResponse> {
  return ragFetch<RagIngestResponse>(
    "/rag/documents/ingest",
    {
      document_id: documentId,
      file_path: filePath,
      metadata,
    },
    requestId
  );
}

export async function searchDocuments(
  query: string,
  allowedSecurityLevels: string[],
  topK?: number,
  mode?: string,
  filters?: RagSearchRequest["filters"],
  requestId?: string
): Promise<RagSearchResponse> {
  return ragFetch<RagSearchResponse>(
    "/rag/search",
    {
      query,
      top_k: topK ?? 5,
      mode: mode ?? "vector",
      allowed_security_levels: allowedSecurityLevels,
      filters: filters ?? {},
    },
    requestId
  );
}

export async function searchDebug(
  query: string,
  allowedSecurityLevels: string[],
  topK?: number,
  mode?: string,
  filters?: RagSearchRequest["filters"],
  includePrompt?: boolean,
  requestId?: string
): Promise<RagDebugSearchResponse> {
  return ragFetch<RagDebugSearchResponse>(
    "/rag/search/debug",
    {
      query,
      top_k: topK ?? 8,
      mode: mode ?? "vector",
      allowed_security_levels: allowedSecurityLevels,
      filters: filters ?? {},
      include_prompt: includePrompt ?? false,
    },
    requestId
  );
}

export async function chatWithRag(
  query: string,
  allowedSecurityLevels: string[],
  topK?: number,
  filters?: RagChatRequest["filters"],
  history?: Array<{ role: string; content: string }>,
  knowledgeAssets?: RagKnowledgeAssetContext[],
  requestId?: string,
  userId?: string
): Promise<RagChatResponse> {
  const payload = await ragFetch<unknown>(
    "/rag/chat",
    {
      query,
      top_k: topK ?? 5,
      allowed_security_levels: allowedSecurityLevels,
      filters: filters ?? {},
      history: history ?? [],
      knowledge_assets: knowledgeAssets ?? [],
    },
    requestId,
    userId
  );
  return parseRagContract("RAG chat response", ragChatResponseSchema, payload);
}

export async function generateDiagramIR(
  title: string,
  content: string,
  diagramType: DiagramType,
  sourceIds: string[],
  requestId?: string,
  userId?: string
): Promise<DiagramIR> {
  const payload = await ragFetch<unknown>(
    "/rag/diagram/generate",
    {
      title,
      content,
      type: diagramType,
      source_ids: sourceIds,
      max_steps: 10,
    },
    requestId,
    userId
  );
  return parseRagContract("RAG DiagramIR", diagramIRSchema, payload);
}

export async function buildImageArtifactContract(
  question: string,
  answer: string,
  sources: Array<Record<string, unknown>>,
  requestedByUser: boolean,
  requestId?: string,
  userId?: string
): Promise<RagImageArtifactContract> {
  return ragFetch<RagImageArtifactContract>(
    "/rag/artifacts/image/contract",
    {
      question,
      answer,
      sources,
      requested_by_user: requestedByUser,
    },
    requestId,
    userId
  );
}

export async function reindexDocument(
  documentId: string,
  filePath: string,
  metadata: RagIngestRequest["metadata"],
  requestId?: string
): Promise<RagIngestResponse> {
  return ragFetch<RagIngestResponse>(
    "/rag/documents/reindex",
    {
      document_id: documentId,
      file_path: filePath,
      metadata,
    },
    requestId
  );
}

export function chatWithRagStream(
  query: string,
  allowedSecurityLevels: string[],
  topK?: number,
  filters?: RagChatRequest["filters"],
  history?: Array<{ role: string; content: string }>,
  knowledgeAssets?: RagKnowledgeAssetContext[],
  requestId?: string,
  userId?: string
): Promise<Response> {
  const cfg = getConfig();
  const url = `${cfg.ragServiceUrl}/rag/chat/stream`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestId ? { "X-Request-Id": requestId } : {}),
      ...(userId ? { "X-User-Id": userId } : {}),
    },
    body: JSON.stringify({
      query,
      top_k: topK ?? 5,
      allowed_security_levels: allowedSecurityLevels,
      filters: filters ?? {},
      history: history ?? [],
      knowledge_assets: knowledgeAssets ?? [],
    }),
  });
}

export async function checkRagHealth(): Promise<{ status: string }> {
  const cfg = getConfig();
  const url = `${cfg.ragServiceUrl}/rag/health`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { status: "error" };
    }
    const data = (await response.json()) as { status?: string };
    return { status: data.status ?? "ok" };
  } catch {
    clearTimeout(timeoutId);
    return { status: "unreachable" };
  }
}
