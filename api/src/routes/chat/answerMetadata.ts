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

type AnswerQualityTier = "answerable" | "grey_answer" | "partial_answer" | "refused";

type AnswerQualityReason = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
};

type VerificationWarning = {
  code: string;
  message: string;
  severity: string;
  citation_ids: string[];
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function sourceIdentity(source: Record<string, unknown>, fallbackIndex: number): string {
  return stringValue(source.id) || stringValue(source.chunk_id) || `source-${fallbackIndex}`;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueReasons(reasons: AnswerQualityReason[]): AnswerQualityReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.code}:${reason.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function qualityLabel(tier: AnswerQualityTier): string {
  if (tier === "refused") return "拒答";
  if (tier === "partial_answer") return "部分回答";
  if (tier === "grey_answer") return "灰度回答";
  return "可回答";
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
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

function answerWarnings(answerIr: RagAnswerIR | null | undefined): VerificationWarning[] {
  return (answerIr?.warnings ?? []).map((warning) => ({
    code: warning.code || "answer_warning",
    message: warning.message || "",
    severity: warning.severity || "warning",
    citation_ids: warning.citation_ids ?? [],
  }));
}

function buildConflictSources(answerVerification: Record<string, unknown>): Record<string, unknown>[] {
  const contradictoryEvidence = recordList(answerVerification.contradictory_evidence);
  const versionConflicts = recordList(answerVerification.version_conflicts);

  return [
    ...contradictoryEvidence.map((item) => ({
      type: "contradictory_evidence",
      positive: isRecord(item.positive) ? item.positive : {},
      negative: isRecord(item.negative) ? item.negative : {},
      confidence: stringValue(item.confidence) || "candidate",
    })),
    ...versionConflicts.map((item) => ({
      type: "version_conflict",
      document_id: stringValue(item.document_id),
      versions: isRecord(item.versions) ? item.versions : {},
    })),
  ];
}

function buildAnswerVerification(
  answerIr: RagAnswerIR | null | undefined,
  citationCoverage: ReturnType<typeof buildCitationCoverage>
) {
  if (!answerIr) return null;

  const rawVerification = isRecord(answerIr?.metadata?.answer_verification)
    ? answerIr.metadata.answer_verification
    : {};
  const rawDecision = isRecord(answerIr?.metadata?.verification_decision)
    ? answerIr.metadata.verification_decision
    : isRecord(rawVerification.decision)
      ? rawVerification.decision
      : {};
  const claimCoverageRatio = numberValue(rawVerification.claim_coverage_ratio)
    ?? numberValue(answerIr?.metadata?.claim_coverage_ratio)
    ?? citationCoverage.claim_coverage_ratio;
  const expiredSources = recordList(rawVerification.expired_sources);
  const deprecatedSources = recordList(rawVerification.deprecated_sources);
  const unsupportedClaims = recordList(rawVerification.unsupported_claims);
  const versionConflicts = recordList(rawVerification.version_conflicts);
  const contradictoryEvidence = recordList(rawVerification.contradictory_evidence);
  const warnings = answerWarnings(answerIr);

  return {
    schema_version: stringValue(rawVerification.schema_version) || "answer-verification/api-v1",
    status: answerIr?.status ?? "unknown",
    confidence: answerIr?.confidence ?? null,
    claim_count: numberValue(rawVerification.claim_count) ?? citationCoverage.claim_count,
    supported_claim_count: numberValue(rawVerification.supported_claim_count) ?? citationCoverage.covered_claim_count,
    claim_coverage_ratio: claimCoverageRatio,
    source_coverage_ratio: citationCoverage.source_coverage_ratio,
    decision: {
      downgraded: typeof rawDecision.downgraded === "boolean" ? rawDecision.downgraded : false,
      previous_status: stringValue(rawDecision.previous_status),
      status: stringValue(rawDecision.status) || answerIr?.status || "unknown",
      reason: stringValue(rawDecision.reason),
      confidence: numberValue(rawDecision.confidence) ?? answerIr?.confidence ?? null,
      confidence_cap: numberValue(rawDecision.confidence_cap),
    },
    warnings,
    warning_codes: uniqueValues(warnings.map((warning) => warning.code)),
    unsupported_claims: unsupportedClaims,
    expired_sources: expiredSources,
    deprecated_sources: deprecatedSources,
    version_conflicts: versionConflicts,
    contradictory_evidence: contradictoryEvidence,
    conflict_sources: buildConflictSources(rawVerification),
  };
}

export function buildAnswerVerificationAuditDetail(metadata: Record<string, unknown>): Record<string, unknown> | null {
  const verification = isRecord(metadata.answer_verification) ? metadata.answer_verification : null;
  if (!verification) return null;
  const decision = isRecord(verification.decision) ? verification.decision : {};
  const warnings = recordList(verification.warnings);

  return {
    schema_version: stringValue(verification.schema_version),
    status: stringValue(verification.status),
    confidence: numberValue(verification.confidence),
    claim_count: numberValue(verification.claim_count),
    supported_claim_count: numberValue(verification.supported_claim_count),
    claim_coverage_ratio: numberValue(verification.claim_coverage_ratio),
    source_coverage_ratio: numberValue(verification.source_coverage_ratio),
    warning_count: warnings.length,
    warning_codes: Array.isArray(verification.warning_codes) ? verification.warning_codes.map(stringValue).filter(Boolean) : [],
    decision: {
      downgraded: typeof decision.downgraded === "boolean" ? decision.downgraded : false,
      previous_status: stringValue(decision.previous_status),
      status: stringValue(decision.status),
      reason: stringValue(decision.reason),
      confidence: numberValue(decision.confidence),
      confidence_cap: numberValue(decision.confidence_cap),
    },
    unsupported_claim_count: recordList(verification.unsupported_claims).length,
    conflict_sources: recordList(verification.conflict_sources),
    expired_sources: recordList(verification.expired_sources),
    deprecated_sources: recordList(verification.deprecated_sources),
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

function warningReasons(answerIr: RagAnswerIR | null | undefined): AnswerQualityReason[] {
  return (answerIr?.warnings ?? [])
    .map((warning) => ({
      code: warning.code || "answer_warning",
      message: warning.message || "",
      severity: warning.severity === "error" ? "error" as const : warning.severity === "info" ? "info" as const : "warning" as const,
    }))
    .filter((warning) => warning.message.trim().length > 0);
}

function refusalReasons(answerIr: RagAnswerIR | null | undefined): AnswerQualityReason[] {
  const metadata = answerIr?.metadata ?? {};
  const reasons = Array.isArray(metadata.refusal_reasons) ? metadata.refusal_reasons : [];
  const singleReason = stringValue(metadata.refusal_reason);
  return uniqueValues([...reasons.map((reason) => stringValue(reason)), singleReason])
    .map((reason) => ({
      code: reason || "insufficient_context",
      message: reason ? `拒答原因：${reason}` : "当前知识库信息不足，无法给出可追溯回答。",
      severity: "error" as const,
    }));
}

function greyAnswerReasons(queryUnderstanding: ReturnType<typeof buildQueryUnderstandingSummary>): AnswerQualityReason[] {
  if (!queryUnderstanding) return [];

  const reasons: AnswerQualityReason[] = [];
  const ambiguity = queryUnderstanding.ambiguity;
  if (queryUnderstanding.needs_confirmation) {
    reasons.push({
      code: "needs_confirmation",
      message: queryUnderstanding.grey_answer_hint || "当前问题存在歧义，回答基于系统推测，建议用户确认后继续。",
      severity: "warning",
    });
  }
  if (isRecord(ambiguity) && ambiguity.is_ambiguous) {
    reasons.push({
      code: "query_ambiguous",
      message: stringValue(ambiguity.reason) || "查询对象存在多个候选含义。",
      severity: "warning",
    });
  }
  if (queryUnderstanding.grey_answer_hint && reasons.length === 0) {
    reasons.push({
      code: "grey_answer_hint",
      message: queryUnderstanding.grey_answer_hint,
      severity: "info",
    });
  }

  return reasons;
}

function buildAnswerQuality(input: AnswerMessageMetadataInput, confidence: number, queryUnderstanding: ReturnType<typeof buildQueryUnderstandingSummary>) {
  const answerIrStatus = input.answerIr?.status ?? "";
  const warnings = warningReasons(input.answerIr);
  const greyReasons = greyAnswerReasons(queryUnderstanding);
  let tier: AnswerQualityTier = "answerable";
  let reasons: AnswerQualityReason[] = [];

  if (answerIrStatus === "insufficient_context" || answerIrStatus === "error") {
    tier = "refused";
    reasons = uniqueReasons([
      ...refusalReasons(input.answerIr),
      ...warnings,
      {
        code: answerIrStatus || "refused",
        message: answerIrStatus === "error" ? "回答生成异常，未形成可用结论。" : "当前知识库信息不足，系统已拒答。",
        severity: "error",
      },
    ]);
  } else if (answerIrStatus === "partial" || (confidence > 0 && confidence < 0.6)) {
    tier = "partial_answer";
    reasons = uniqueReasons([
      ...warnings,
      {
        code: "low_confidence",
        message: confidence > 0 ? `回答可信度 ${percent(confidence)}，只能作为部分结论参考。` : "回答证据覆盖不足，只能作为部分结论参考。",
        severity: "warning",
      },
    ]);
  } else if (greyReasons.length > 0) {
    tier = "grey_answer";
    reasons = uniqueReasons(greyReasons);
  } else {
    tier = "answerable";
    reasons = [{
      code: "evidence_supported",
      message: confidence > 0 ? `回答可信度 ${percent(confidence)}，证据支持当前结论。` : "回答已形成可追溯结论。",
      severity: "info",
    }];
  }

  return {
    tier,
    label: qualityLabel(tier),
    reason: reasons[0]?.message ?? "",
    reasons,
    confidence,
    answer_ir_status: answerIrStatus || "unknown",
  };
}

export function buildAnswerMessageMetadata(input: AnswerMessageMetadataInput): Record<string, unknown> {
  const queryRewrite = input.answerIr?.query_rewrite ?? input.queryRewrite ?? null;
  const queryUnderstanding = buildQueryUnderstandingSummary(
    input.answerIr?.query_understanding ?? queryRewrite?.query_understanding ?? null
  );
  const rewrittenQuestion = queryRewrite?.rewritten_query || input.originalQuestion;
  const confidence = displayConfidence(input);
  const citationCoverage = buildCitationCoverage(input.answerIr, input.sources ?? []);
  const answerVerification = buildAnswerVerification(input.answerIr, citationCoverage);

  return {
    confidence,
    retrieval_confidence: input.confidence ?? null,
    answer_quality: buildAnswerQuality(input, confidence, queryUnderstanding),
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
    citation_coverage: citationCoverage,
    answer_verification: answerVerification,
    visual_plan: input.visualPlan ?? null,
    knowledge_assets: input.answerIr?.metadata?.knowledge_assets ?? input.visualPlan?.metadata?.knowledge_assets ?? [],
  };
}
