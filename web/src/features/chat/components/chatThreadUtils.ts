import type { AnswerQualityTier, ChatArtifact, ChatMessage, DiagramType, QueryCandidateTerm } from "../types";

export type DiagramState = {
  loading: boolean;
  data?: ChatArtifact;
  error?: string;
};

export type QueryUnderstandingNotice = {
  tone: "confirmed" | "inferred" | "confirmation";
  label: string;
  text: string;
  terms: string[];
};

export type AnswerQualityNotice = {
  tone: AnswerQualityTier;
  label: string;
  text: string;
  reasons: string[];
  confidence?: number;
};

export type AnswerTrustTone = "strong" | "medium" | "weak" | "danger" | "neutral";

export type AnswerTrustWarning = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  citationIds: string[];
};

export type AnswerTrustSummary = {
  tone: AnswerTrustTone;
  confidence?: number;
  confidenceLabel: string;
  claimCount: number;
  supportedClaimCount: number;
  claimCoverageRatio?: number;
  sourceCount: number;
  citedSourceCount: number;
  warnings: AnswerTrustWarning[];
  conflictCount: number;
  conflictLabels: string[];
  hasTrustMetadata: boolean;
};

const UNCERTAIN_ANSWER_PATTERN = /(?:暂时无法确认|无法确认|无法回答|没有足够(?:信息|证据)|信息不足|不能确定|请补充|问题不够具体)/;
const INFERRED_TERM_KINDS = new Set(["spell_correction", "history_question", "document_title", "section_title"]);
const CONFLICT_WARNING_PATTERN = /(?:context_conflict|contradictory_evidence|version_conflict|evidence_conflict|conflict|contradict|冲突)/i;

export function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function canUsePersistedAssistantActions(messageId: string) {
  return !messageId.startsWith("stream-") && !messageId.startsWith("interrupted-");
}

export function canUsePersistedUserActions(messageId: string) {
  return !messageId.startsWith("user-") && !messageId.startsWith("pending-");
}

export function getPersistedMessageId(message: ChatMessage) {
  return message.persistedId || message.id;
}

export function getDiagramKey(messageId: string, diagramType: DiagramType) {
  return `${messageId}:${diagramType}`;
}

export function getDiagramButtonLabel(diagramType: DiagramType, hasData: boolean) {
  if (diagramType === "mindmap") return hasData ? "查看思维导图" : "生成思维导图";
  return hasData ? "查看流程图" : "生成流程图";
}

export function getDiagramActionLabel(diagramType: DiagramType, hasData: boolean) {
  if (diagramType === "mindmap") return hasData ? "查看导图" : "思维导图";
  return hasData ? "查看流程" : "流程图";
}

export function assetStatusLabel(status?: string) {
  if (status === "queued" || status === "running") return "生成中";
  if (status === "published") return "已发布";
  if (status === "pending_review") return "待审核";
  if (status === "returned") return "已退回";
  if (status === "archived") return "已归档";
  if (status === "ai_draft") return "AI 草稿";
  return "";
}

export function isAnswerReadyForRefinement(message: ChatMessage) {
  const answerSummary = isRecord(message.metadata?.answer_ir_summary) ? message.metadata.answer_ir_summary : null;
  const status = typeof answerSummary?.status === "string" ? answerSummary.status : "";
  if (status && status !== "answered") return false;
  if (typeof message.confidence === "number" && message.confidence > 0 && message.confidence < 0.6) return false;
  return !UNCERTAIN_ANSWER_PATTERN.test(message.content);
}

export function isConfirmedAnswer(message: ChatMessage) {
  const quality = message.metadata?.answer_quality;
  if (quality?.tier && quality.tier !== "answerable") return false;
  const status = answerStatus(message);
  if (status && status !== "answered") return false;
  return !UNCERTAIN_ANSWER_PATTERN.test(message.content);
}

export function mergeArtifacts(base: ChatArtifact[] | undefined, extra: ChatArtifact[] | undefined) {
  const byId = new Map<string, ChatArtifact>();
  [...(base || []), ...(extra || [])].forEach((artifact) => {
    if (artifact.status !== "deleted") byId.set(artifact.id, artifact);
  });
  return Array.from(byId.values());
}

export function getQueryUnderstandingNotice(message: ChatMessage): QueryUnderstandingNotice | null {
  const understanding = message.metadata?.query_understanding;
  if (!understanding) return null;

  const candidateTerms = Array.isArray(understanding.candidate_terms) ? understanding.candidate_terms : [];
  const spellCorrections = Array.isArray(understanding.spell_corrections) ? understanding.spell_corrections : [];
  const ambiguity = understanding.ambiguity ?? null;
  const terms = uniqueStrings(candidateTerms.map((term) => term.term)).slice(0, 3);
  const correctionText = spellCorrections
    .map((item) => {
      if (!item.original || !item.correction) return "";
      return `${item.original} -> ${item.correction}`;
    })
    .filter(Boolean)
    .join("、");
  const hint = typeof understanding.grey_answer_hint === "string" ? understanding.grey_answer_hint.trim() : "";

  if (understanding.needs_confirmation || ambiguity?.is_ambiguous) {
    const candidates = Array.isArray(ambiguity?.candidates) ? uniqueStrings(ambiguity.candidates).slice(0, 3) : [];
    return {
      tone: "confirmation",
      label: "需要用户确认",
      text: hint || (typeof ambiguity?.reason === "string" && ambiguity.reason.trim()) || "当前问题存在歧义，建议确认术语或对象后再继续。",
      terms: candidates.length > 0 ? candidates : terms,
    };
  }

  if (spellCorrections.length > 0 || hasOnlyInferredTerms(candidateTerms)) {
    const rewritten = typeof understanding.rewritten_query === "string" ? understanding.rewritten_query.trim() : "";
    return {
      tone: "inferred",
      label: "系统推测",
      text: hint || (correctionText ? `系统按术语库推测为 ${correctionText}。` : rewritten ? `按多轮上下文理解为「${rewritten}」。` : "系统基于上下文推测了查询对象。"),
      terms,
    };
  }

  if (terms.length > 0) {
    return {
      tone: "confirmed",
      label: "已确认术语命中",
      text: hint || `已命中术语：${terms.join("、")}。`,
      terms,
    };
  }

  return null;
}

export function getAnswerQualityNotice(message: ChatMessage): AnswerQualityNotice | null {
  const quality = message.metadata?.answer_quality;
  if (!quality || !quality.tier) {
    if (typeof message.confidence === "number" && message.confidence > 0 && message.confidence < 0.6) {
      return {
        tone: "partial_answer",
        label: "部分回答",
        text: `回答可信度 ${Math.round(message.confidence * 100)}%，请人工核对原文。`,
        reasons: [],
        confidence: message.confidence,
      };
    }
    return null;
  }

  const reasons = Array.isArray(quality.reasons)
    ? quality.reasons.map((reason) => reason.message).filter(Boolean).slice(0, 3)
    : [];
  return {
    tone: quality.tier,
    label: quality.label || qualityLabel(quality.tier),
    text: quality.reason || reasons[0] || qualityLabel(quality.tier),
    reasons: reasons.filter((reason) => reason !== quality.reason),
    confidence: typeof quality.confidence === "number" ? quality.confidence : message.confidence,
  };
}

export function getAnswerTrustSummary(message: ChatMessage): AnswerTrustSummary | null {
  if (message.role !== "assistant") return null;

  const verification = isRecord(message.metadata?.answer_verification) ? message.metadata.answer_verification : {};
  const citationCoverage = isRecord(message.metadata?.citation_coverage) ? message.metadata.citation_coverage : {};
  const quality = message.metadata?.answer_quality;
  const confidence =
    numberValue(verification.confidence) ??
    (quality && typeof quality.confidence === "number" ? quality.confidence : null) ??
    message.confidence;
  const claimCount = numberValue(verification.claim_count) ?? numberValue(citationCoverage.claim_count) ?? 0;
  const supportedClaimCount =
    numberValue(verification.supported_claim_count) ??
    numberValue(citationCoverage.covered_claim_count) ??
    0;
  const claimCoverageRatio =
    numberValue(verification.claim_coverage_ratio) ??
    numberValue(citationCoverage.claim_coverage_ratio) ??
    (claimCount > 0 ? supportedClaimCount / claimCount : undefined);
  const citedSourceCount = numberValue(citationCoverage.cited_source_count) ?? 0;
  const sourceCount = message.sources?.length ?? numberValue(citationCoverage.returned_source_count) ?? 0;
  const warnings = trustWarnings(message);
  const conflictLabels = conflictSummaryLabels(verification, warnings);
  const tone = trustTone(confidence, warnings, conflictLabels.length, quality?.tier);
  const hasTrustMetadata = Boolean(
    confidence ||
    sourceCount > 0 ||
    claimCount > 0 ||
    warnings.length > 0 ||
    conflictLabels.length > 0 ||
    isRecord(message.metadata?.answer_verification) ||
    isRecord(message.metadata?.citation_coverage)
  );

  if (!hasTrustMetadata) return null;

  return {
    tone,
    confidence,
    confidenceLabel: confidence !== undefined && confidence > 0 ? `${Math.round(confidence * 100)}%` : "待核验",
    claimCount,
    supportedClaimCount,
    claimCoverageRatio,
    sourceCount,
    citedSourceCount,
    warnings,
    conflictCount: conflictLabels.length,
    conflictLabels,
    hasTrustMetadata,
  };
}

function answerStatus(message: ChatMessage) {
  const answerSummary = isRecord(message.metadata?.answer_ir_summary) ? message.metadata.answer_ir_summary : null;
  return typeof answerSummary?.status === "string" ? answerSummary.status : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasOnlyInferredTerms(candidateTerms: QueryCandidateTerm[]) {
  if (candidateTerms.length === 0) return false;
  return candidateTerms.every((term) => INFERRED_TERM_KINDS.has(term.matched_kind || ""));
}

function qualityLabel(tier: AnswerQualityTier) {
  if (tier === "refused") return "拒答";
  if (tier === "partial_answer") return "部分回答";
  if (tier === "grey_answer") return "灰度回答";
  return "可回答";
}

function trustWarnings(message: ChatMessage): AnswerTrustWarning[] {
  const verification = isRecord(message.metadata?.answer_verification) ? message.metadata.answer_verification : {};
  const answerSummary = isRecord(message.metadata?.answer_ir_summary) ? message.metadata.answer_ir_summary : {};
  const rawWarnings = [
    ...recordList(verification.warnings),
    ...recordList(answerSummary.warnings),
  ];
  const qualityReasons = Array.isArray(message.metadata?.answer_quality?.reasons)
    ? message.metadata.answer_quality.reasons
    : [];
  const warningReasons = qualityReasons
    .filter((reason) => reason.severity === "warning" || reason.severity === "error")
    .map((reason) => ({
      code: reason.code,
      message: reason.message,
      severity: reason.severity,
      citation_ids: [],
    }));

  const seen = new Set<string>();
  return [...rawWarnings, ...warningReasons]
    .map((warning): AnswerTrustWarning | null => {
      const code = stringValue(warning.code) || "answer_warning";
      const message = stringValue(warning.message) || warningLabel(code);
      const rawSeverity = stringValue(warning.severity);
      const severity = rawSeverity === "error" ? "error" : rawSeverity === "info" ? "info" : "warning";
      const citationIds = Array.isArray(warning.citation_ids)
        ? warning.citation_ids.map(stringValue).filter(Boolean)
        : [];
      if (!message) return null;
      return { code, message, severity, citationIds };
    })
    .filter((warning): warning is AnswerTrustWarning => Boolean(warning))
    .filter((warning) => {
      const key = `${warning.code}:${warning.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function warningLabel(code: string) {
  if (code === "context_conflict" || code === "contradictory_evidence") return "引用之间存在冲突，需要人工复核。";
  if (code === "version_conflict") return "引用版本存在差异，请核对最新版本。";
  if (code === "unsupported_claims") return "部分结论缺少绑定引用支撑。";
  if (code === "expired_sources" || code === "deprecated_sources") return "部分来源可能过期或已废弃。";
  if (code === "no_citations" || code === "missing_citations") return "回答缺少可追溯引用。";
  if (code === "low_confidence") return "回答可信度偏低，请核对原文。";
  return code;
}

function conflictSummaryLabels(verification: Record<string, unknown>, warnings: AnswerTrustWarning[]) {
  const labels: string[] = [];
  if (recordList(verification.conflict_sources).length > 0 || recordList(verification.contradictory_evidence).length > 0) {
    labels.push("证据冲突");
  }
  if (recordList(verification.version_conflicts).length > 0) {
    labels.push("版本冲突");
  }
  if (warnings.some((warning) => CONFLICT_WARNING_PATTERN.test(`${warning.code} ${warning.message}`))) {
    labels.push("冲突提示");
  }
  return Array.from(new Set(labels));
}

function trustTone(confidence: number | undefined, warnings: AnswerTrustWarning[], conflictCount: number, tier?: AnswerQualityTier): AnswerTrustTone {
  if (tier === "refused" || warnings.some((warning) => warning.severity === "error")) return "danger";
  if (conflictCount > 0 || tier === "partial_answer" || (confidence !== undefined && confidence > 0 && confidence < 0.6)) return "weak";
  if (tier === "grey_answer" || (confidence !== undefined && confidence < 0.8)) return "medium";
  if (confidence !== undefined && confidence >= 0.8) return "strong";
  return "neutral";
}
