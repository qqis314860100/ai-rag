import { z } from "zod";
import { AppError, ErrorCodes } from "../../utils/errors";

const unknownRecordSchema = z.record(z.unknown());

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

const ragQueryUnderstandingSchema = z.object({
  original_query: z.string().optional(),
  rewritten_query: z.string().optional(),
  intent: z.string().optional(),
  candidate_terms: z.array(z.object({
    term: z.string().optional(),
    matched_text: z.string().optional(),
    matched_kind: z.string().optional(),
    source: z.string().optional(),
    confidence: z.number().optional(),
    reason: z.string().optional(),
  }).passthrough()).optional(),
  spell_corrections: z.array(z.object({
    original: z.string().optional(),
    correction: z.string().optional(),
    source: z.string().optional(),
    confidence: z.number().optional(),
    reason: z.string().optional(),
  }).passthrough()).optional(),
  ambiguity: z.object({
    is_ambiguous: z.boolean().optional(),
    candidates: z.array(z.string()).optional(),
    reason: z.string().optional(),
  }).passthrough().optional(),
  confidence: z.number().optional(),
  needs_confirmation: z.boolean().optional(),
  grey_answer_hint: z.string().optional(),
  trace: z.array(unknownRecordSchema).optional(),
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
    query_understanding: ragQueryUnderstandingSchema.optional(),
  }).passthrough().optional(),
  query_understanding: ragQueryUnderstandingSchema.optional(),
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

export const ragChatResponseSchema = z.object({
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

const ragDraftCandidateSchema = z.object({
  title: z.string(),
  summary: z.string().optional(),
  confidence: z.number().optional(),
  source_failed_question_ids: z.array(z.string()).optional(),
  metadata: unknownRecordSchema.optional(),
}).passthrough();

export const ragKnowledgeGapClusterResultSchema = z.object({
  schema_version: z.string().optional(),
  clusters: z.array(z.object({
    cluster_id: z.string(),
    title: z.string(),
    representative_question: z.string(),
    normalized_key: z.string(),
    gap_type: z.string(),
    severity: z.string(),
    frequency_count: z.number(),
    sample_failed_question_ids: z.array(z.string()).optional(),
    questions: z.array(z.string()).optional(),
    event_types: z.array(z.string()).optional(),
    related_terms: z.array(z.string()).optional(),
    retrieval_evidence: z.array(unknownRecordSchema).optional(),
    term_candidates: z.array(ragDraftCandidateSchema.extend({
      canonical_term: z.string(),
      aliases: z.array(z.string()).optional(),
      retrieval_terms: z.array(z.string()).optional(),
    }).passthrough()).optional(),
    alias_candidates: z.array(ragDraftCandidateSchema.extend({
      canonical_term: z.string(),
      alias: z.string(),
      reason: z.string().optional(),
    }).passthrough()).optional(),
    faq_drafts: z.array(ragDraftCandidateSchema.extend({
      question: z.string(),
      answer_outline: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }).passthrough()).optional(),
    knowledge_card_drafts: z.array(ragDraftCandidateSchema.extend({
      topic: z.string(),
      related_terms: z.array(z.string()).optional(),
      missing_evidence: z.array(z.string()).optional(),
    }).passthrough()).optional(),
    document_supplement_suggestions: z.array(ragDraftCandidateSchema.extend({
      target_topic: z.string(),
      suggested_sections: z.array(z.string()).optional(),
      evidence_gaps: z.array(z.string()).optional(),
    }).passthrough()).optional(),
    metadata: unknownRecordSchema.optional(),
  }).passthrough()),
  ignored_count: z.number().optional(),
  metadata: unknownRecordSchema.optional(),
}).passthrough();

const diagramWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.string().optional(),
  node_ids: z.array(z.string()).optional(),
  edge_ids: z.array(z.string()).optional(),
  source_ids: z.array(z.string()).optional(),
}).passthrough();

const diagramLaneSchema = z.object({
  id: z.string(),
  label: z.string(),
  order: z.number().optional(),
  metadata: unknownRecordSchema.optional(),
}).passthrough();

const diagramNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  description: z.string().optional(),
  source_ids: z.array(z.string()),
  metadata: unknownRecordSchema,
}).passthrough();

const diagramEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  relation: z.string(),
  label: z.string().optional(),
  metadata: unknownRecordSchema,
}).passthrough();

const FLOWCHART_NODE_KINDS = new Set(["start", "end", "input", "output", "step", "action", "decision", "subflow"]);

export const diagramIRSchema = z.object({
  title: z.string(),
  objective: z.string(),
  type: z.string(),
  diagram_type: z.string().optional(),
  layout_hint: z.string(),
  nodes: z.array(diagramNodeSchema),
  edges: z.array(diagramEdgeSchema),
  lanes: z.array(diagramLaneSchema).optional(),
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
}).passthrough().superRefine((diagram, ctx) => {
  if (diagram.type !== "flowchart" || !diagram.lanes || diagram.lanes.length === 0) return;

  const laneIds = new Set<string>();
  diagram.lanes.forEach((lane, index) => {
    if (!lane.id.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lanes", index, "id"],
        message: "泳道 id 不能为空。",
      });
      return;
    }
    if (laneIds.has(lane.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lanes", index, "id"],
        message: "泳道 id 必须唯一。",
      });
    }
    laneIds.add(lane.id);
  });

  diagram.nodes.forEach((node, index) => {
    if (!FLOWCHART_NODE_KINDS.has(node.kind)) return;
    const laneId = node.metadata.lane_id;
    if (typeof laneId !== "string" || !laneId.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes", index, "metadata", "lane_id"],
        message: "带泳道的流程图节点必须声明 metadata.lane_id。",
      });
      return;
    }
    if (!laneIds.has(laneId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes", index, "metadata", "lane_id"],
        message: "节点 metadata.lane_id 必须引用已声明的泳道。",
      });
    }
  });
});

export function parseRagContract<T>(label: string, schema: z.ZodType<T>, payload: unknown): T {
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
