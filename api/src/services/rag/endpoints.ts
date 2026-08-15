import { diagramIRSchema, parseRagContract, ragChatResponseSchema, ragKnowledgeGapClusterResultSchema } from "./schemas";
import { getRagServiceUrl, ragFetch, ragHeaders } from "./http";
import type {
  DiagramIR,
  DiagramType,
  RagChatRequest,
  RagChatResponse,
  RagDebugSearchResponse,
  RagImageArtifactContract,
  RagIngestRequest,
  RagIngestResponse,
  RagKnowledgeGapClusterRequest,
  RagKnowledgeGapClusterResult,
  RagKnowledgeAssetContext,
  RagSearchRequest,
  RagSearchResponse,
} from "./types";

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

export async function clusterKnowledgeGapDrafts(
  request: RagKnowledgeGapClusterRequest,
  requestId?: string,
  userId?: string
): Promise<RagKnowledgeGapClusterResult> {
  const payload = await ragFetch<unknown>(
    "/rag/knowledge-gaps/cluster-drafts",
    request,
    requestId,
    userId
  );
  return parseRagContract("RAG knowledge gap cluster result", ragKnowledgeGapClusterResultSchema, payload);
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
  userId?: string,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(`${getRagServiceUrl()}/rag/chat/stream`, {
    method: "POST",
    headers: ragHeaders(requestId, userId),
    body: JSON.stringify({
      query,
      top_k: topK ?? 5,
      allowed_security_levels: allowedSecurityLevels,
      filters: filters ?? {},
      history: history ?? [],
      knowledge_assets: knowledgeAssets ?? [],
    }),
    ...(signal ? { signal } : {}),
  });
}

export async function checkRagHealth(): Promise<{ status: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${getRagServiceUrl()}/rag/health`, { headers: ragHeaders(), signal: controller.signal });
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
