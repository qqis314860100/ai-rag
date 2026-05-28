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

const UNCERTAIN_ANSWER_PATTERN = /(?:暂时无法确认|无法确认|无法回答|没有足够(?:信息|证据)|信息不足|不能确定|请补充|问题不够具体)/;
const INFERRED_TERM_KINDS = new Set(["spell_correction", "history_question", "document_title", "section_title"]);

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
