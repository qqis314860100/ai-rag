import type { ChatArtifact, ChatMessage, DiagramType } from "../types";

export type DiagramState = {
  loading: boolean;
  data?: ChatArtifact;
  error?: string;
};

const UNCERTAIN_ANSWER_PATTERN = /(?:暂时无法确认|无法确认|无法回答|没有足够(?:信息|证据)|信息不足|不能确定|请补充|问题不够具体)/;

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

function answerStatus(message: ChatMessage) {
  const answerSummary = isRecord(message.metadata?.answer_ir_summary) ? message.metadata.answer_ir_summary : null;
  return typeof answerSummary?.status === "string" ? answerSummary.status : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
