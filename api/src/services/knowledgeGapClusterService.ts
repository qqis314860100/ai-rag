import {
  attachFailedQuestionsToGap,
  createKnowledgeGap,
  formatKnowledgeGap,
  getKnowledgeGapByKey,
  isKnowledgeGapSeverity,
  isKnowledgeGapType,
  listFailedQuestions,
  updateKnowledgeGap,
} from "../db/knowledgeGaps";
import type { RetrievalEvidenceRef } from "../db/knowledgeGaps";
import { clusterKnowledgeGapDrafts } from "./rag/endpoints";
import type {
  RagFailedQuestionSignal,
  RagKnowledgeGapClusterDraft,
  RagKnowledgeGapClusterResult,
} from "./rag/types";

export interface KnowledgeGapClusterOptions {
  minFrequency?: number;
  maxClusters?: number;
  sampleLimit?: number;
  persist?: boolean;
  requestId?: string;
  userId?: string;
}

export interface PersistedKnowledgeGapCluster {
  cluster: RagKnowledgeGapClusterDraft;
  gap: ReturnType<typeof formatKnowledgeGap>;
  attached_failed_question_count: number;
}

export interface KnowledgeGapClusterServiceResult {
  schema_version: string;
  clusters: RagKnowledgeGapClusterDraft[];
  persisted: PersistedKnowledgeGapCluster[];
  ignored_count: number;
  metadata: Record<string, unknown>;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value as number)));
}

function toFailedQuestionSignal(item: Record<string, unknown>): RagFailedQuestionSignal {
  return {
    id: String(item.id || ""),
    question: String(item.question || ""),
    event_type: String(item.event_type || "refusal"),
    confidence: typeof item.confidence === "number" ? item.confidence : null,
    feedback_reason: String(item.feedback_reason || ""),
    feedback_comment: String(item.feedback_comment || ""),
    answer_snapshot: String(item.answer_snapshot || ""),
    query_understanding: Array.isArray(item.query_understanding) ? item.query_understanding as Array<Record<string, unknown>> : [],
    retrieval_evidence: Array.isArray(item.retrieval_evidence) ? item.retrieval_evidence as Array<Record<string, unknown>> : [],
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {},
    created_at: String(item.created_at || ""),
  };
}

function normalizeClusterMetadata(cluster: RagKnowledgeGapClusterDraft, ragResult: RagKnowledgeGapClusterResult) {
  return {
    draft_suggestions: {
      schema_version: ragResult.schema_version ?? "knowledge-gap-cluster/v1",
      cluster_id: cluster.cluster_id,
      term_candidates: cluster.term_candidates ?? [],
      alias_candidates: cluster.alias_candidates ?? [],
      faq_drafts: cluster.faq_drafts ?? [],
      knowledge_card_drafts: cluster.knowledge_card_drafts ?? [],
      document_supplement_suggestions: cluster.document_supplement_suggestions ?? [],
      generated_at: new Date().toISOString(),
      generator: "rag.knowledge_gap_cluster_drafts",
    },
    cluster_metadata: cluster.metadata ?? {},
  };
}

function persistCluster(cluster: RagKnowledgeGapClusterDraft, ragResult: RagKnowledgeGapClusterResult): PersistedKnowledgeGapCluster {
  const failedQuestionIds = cluster.sample_failed_question_ids ?? [];
  const gapType = isKnowledgeGapType(cluster.gap_type) ? cluster.gap_type : "mixed";
  const severity = isKnowledgeGapSeverity(cluster.severity) ? cluster.severity : "medium";
  const retrievalEvidence = (cluster.retrieval_evidence ?? []) as RetrievalEvidenceRef[];
  const metadata = normalizeClusterMetadata(cluster, ragResult);
  const existing = getKnowledgeGapByKey(cluster.normalized_key);

  const row = existing
    ? updateKnowledgeGap(existing.id, {
        title: cluster.title,
        representativeQuestion: cluster.representative_question,
        gapType,
        status: "draft_generated",
        severity,
        frequencyCount: cluster.frequency_count,
        sampleFailedQuestionIds: failedQuestionIds,
        retrievalEvidence,
        metadata,
      })
    : createKnowledgeGap({
        title: cluster.title,
        gapKey: cluster.normalized_key,
        representativeQuestion: cluster.representative_question,
        gapType,
        status: "draft_generated",
        severity,
        frequencyCount: cluster.frequency_count,
        sampleFailedQuestionIds: failedQuestionIds,
        retrievalEvidence,
        metadata,
      });

  if (!row) {
    throw new Error(`Failed to persist knowledge gap cluster ${cluster.cluster_id}`);
  }

  const attached = attachFailedQuestionsToGap(row.id, failedQuestionIds);
  return {
    cluster,
    gap: formatKnowledgeGap(row),
    attached_failed_question_count: attached,
  };
}

export async function generateKnowledgeGapClusterDrafts(options: KnowledgeGapClusterOptions = {}): Promise<KnowledgeGapClusterServiceResult> {
  const sampleLimit = clamp(options.sampleLimit, 100, 10, 100);
  const minFrequency = clamp(options.minFrequency, 2, 1, 20);
  const maxClusters = clamp(options.maxClusters, 20, 1, 100);
  const failedQuestions = listFailedQuestions({ pageSize: sampleLimit }).items.map((item) =>
    toFailedQuestionSignal(item as Record<string, unknown>)
  );

  const ragResult = await clusterKnowledgeGapDrafts(
    {
      failed_questions: failedQuestions,
      min_frequency: minFrequency,
      max_clusters: maxClusters,
    },
    options.requestId,
    options.userId
  );
  const clusters = ragResult.clusters ?? [];
  const persisted = options.persist === false
    ? []
    : clusters.map((cluster) => persistCluster(cluster, ragResult));

  return {
    schema_version: ragResult.schema_version ?? "knowledge-gap-cluster/v1",
    clusters,
    persisted,
    ignored_count: ragResult.ignored_count ?? 0,
    metadata: {
      ...(ragResult.metadata ?? {}),
      sample_limit: sampleLimit,
      persisted_count: persisted.length,
    },
  };
}
