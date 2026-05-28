import type { RagAnswerIR, RagAnswerQueryRewrite, RagQueryUnderstanding, RagVisualPlan } from "../../services/ragClient";

type AnswerMessageMetadataInput = {
  originalQuestion: string;
  sources?: unknown[];
  confidence?: number;
  followups?: string[];
  trace?: Record<string, unknown>;
  answerIr?: RagAnswerIR | null;
  queryRewrite?: RagAnswerQueryRewrite | null;
  visualPlan?: RagVisualPlan | null;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceIdentity(source: Record<string, unknown>, fallbackIndex: number): string {
  return stringValue(source.id) || stringValue(source.chunk_id) || `source-${fallbackIndex}`;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildCitationCoverage(answerIr: RagAnswerIR | null | undefined, sources: unknown[]) {
  const sourceRecords = sources.filter(isRecord);
  const sourceIds = uniqueValues(sourceRecords.map((source, index) => sourceIdentity(source, index + 1)));
  const citations = answerIr?.citations ?? [];
  const citationIds = uniqueValues(
    citations.map((citation, index) => citation.id || citation.chunk_id || `source-${citation.source_index || index + 1}`)
  );
  const claims = answerIr?.claims ?? [];
  const citedIdSet = new Set(citationIds);
  const coveredClaims = claims.filter((claim) => (claim.citation_ids ?? []).some((id) => citedIdSet.has(id)));
  const missingCitationClaimIds = claims
    .filter((claim) => (claim.citation_ids ?? []).length === 0 || !(claim.citation_ids ?? []).some((id) => citedIdSet.has(id)))
    .map((claim, index) => claim.id || `claim-${index + 1}`);

  return {
    returned_source_count: sourceRecords.length,
    returned_source_ids: sourceIds,
    cited_source_count: citationIds.length,
    cited_source_ids: citationIds,
    claim_count: claims.length,
    covered_claim_count: coveredClaims.length,
    claim_coverage_ratio: claims.length > 0 ? coveredClaims.length / claims.length : 0,
    source_coverage_ratio: sourceIds.length > 0 ? citationIds.filter((id) => sourceIds.includes(id)).length / sourceIds.length : 0,
    missing_citation_claim_ids: missingCitationClaimIds,
  };
}

function buildAnswerIrSummary(answerIr: RagAnswerIR | null | undefined) {
  if (!answerIr) return null;

  return {
    schema_version: answerIr.schema_version,
    status: answerIr.status,
    confidence: answerIr.confidence,
    claim_count: answerIr.claims?.length ?? 0,
    citation_count: answerIr.citations?.length ?? 0,
    warning_count: answerIr.warnings?.length ?? 0,
    primary_claim: answerIr.claims?.[0]?.text ?? "",
    warnings: (answerIr.warnings ?? []).map((warning) => ({
      code: warning.code,
      severity: warning.severity,
      citation_ids: warning.citation_ids ?? [],
    })),
  };
}

function buildQueryUnderstandingSummary(queryUnderstanding: RagQueryUnderstanding | null | undefined) {
  if (!queryUnderstanding) return null;

  return {
    original_query: queryUnderstanding.original_query ?? "",
    rewritten_query: queryUnderstanding.rewritten_query ?? "",
    intent: queryUnderstanding.intent ?? "general",
    candidate_terms: queryUnderstanding.candidate_terms ?? [],
    spell_corrections: queryUnderstanding.spell_corrections ?? [],
    ambiguity: queryUnderstanding.ambiguity ?? { is_ambiguous: false, candidates: [], reason: "" },
    confidence: queryUnderstanding.confidence ?? 0,
    needs_confirmation: queryUnderstanding.needs_confirmation ?? false,
    grey_answer_hint: queryUnderstanding.grey_answer_hint ?? "",
    trace: queryUnderstanding.trace ?? [],
  };
}

function displayConfidence(input: AnswerMessageMetadataInput): number {
  if (input.answerIr?.status && input.answerIr.status !== "answered") return 0;
  if (typeof input.answerIr?.confidence === "number") return input.answerIr.confidence;
  return input.confidence ?? 0;
}

export function buildAnswerMessageMetadata(input: AnswerMessageMetadataInput): Record<string, unknown> {
  const queryRewrite = input.answerIr?.query_rewrite ?? input.queryRewrite ?? null;
  const queryUnderstanding = buildQueryUnderstandingSummary(
    input.answerIr?.query_understanding ?? queryRewrite?.query_understanding ?? null
  );
  const rewrittenQuestion = queryRewrite?.rewritten_query || input.originalQuestion;
  const confidence = displayConfidence(input);

  return {
    confidence,
    retrieval_confidence: input.confidence ?? null,
    followups: input.followups,
    trace: input.trace,
    query: {
      original_question: queryRewrite?.original_query || input.originalQuestion,
      rewritten_question: rewrittenQuestion,
      rewrite_changed: queryRewrite?.changed ?? rewrittenQuestion !== input.originalQuestion,
      rewrite_strategy: queryRewrite?.strategy ?? "none",
      rewrite_reason: queryRewrite?.reason ?? "",
      rewrite_signals: queryRewrite?.signals ?? [],
      history_turns: queryRewrite?.history_turns ?? 0,
      understanding_confidence: queryUnderstanding?.confidence ?? 0,
      needs_confirmation: queryUnderstanding?.needs_confirmation ?? false,
      grey_answer_hint: queryUnderstanding?.grey_answer_hint ?? "",
    },
    query_understanding: queryUnderstanding,
    answer_ir_summary: buildAnswerIrSummary(input.answerIr),
    citation_coverage: buildCitationCoverage(input.answerIr, input.sources ?? []),
    visual_plan: input.visualPlan ?? null,
    knowledge_assets: input.answerIr?.metadata?.knowledge_assets ?? input.visualPlan?.metadata?.knowledge_assets ?? [],
  };
}
