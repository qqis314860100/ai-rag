import { loadConfig, Config } from "../config";
import { AppError, ErrorCodes } from "../utils/errors";

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
  };
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

async function ragFetch<T>(
  path: string,
  body: unknown,
  requestId?: string
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
  requestId?: string
): Promise<RagChatResponse> {
  return ragFetch<RagChatResponse>(
    "/rag/chat",
    {
      query,
      top_k: topK ?? 5,
      allowed_security_levels: allowedSecurityLevels,
      filters: filters ?? {},
      history: history ?? [],
    },
    requestId
  );
}

export async function generateDiagramIR(
  title: string,
  content: string,
  diagramType: DiagramType,
  sourceIds: string[],
  requestId?: string
): Promise<DiagramIR> {
  return ragFetch<DiagramIR>(
    "/rag/diagram/generate",
    {
      title,
      content,
      diagram_type: diagramType,
      source_ids: sourceIds,
      max_steps: 8,
    },
    requestId
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
  requestId?: string
): Promise<Response> {
  const cfg = getConfig();
  const url = `${cfg.ragServiceUrl}/rag/chat/stream`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestId ? { "X-Request-Id": requestId } : {}),
    },
    body: JSON.stringify({
      query,
      top_k: topK ?? 5,
      allowed_security_levels: allowedSecurityLevels,
      filters: filters ?? {},
      history: history ?? [],
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
