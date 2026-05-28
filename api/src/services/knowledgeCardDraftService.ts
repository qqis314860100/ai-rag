import { createKnowledgeCard, formatKnowledgeCard } from "../db/knowledgeCards";
import type {
  KnowledgeCardHandlingMethod,
  KnowledgeCardKeyParameter,
  KnowledgeCardRisk,
  KnowledgeCardSourceRef,
  KnowledgeCardStep,
} from "../db/knowledgeCards";
import { getMessageById, listMessagesBySession } from "../db/chatMessages";
import { getSessionById } from "../db/chatSessions";
import { listMessageSourceDetails } from "../db/messageSources";
import { formatArtifact, listArtifactsByMessage } from "../db/chatArtifacts";
import { emitWebhookEvent } from "./webhookService";
import { buildKnowledgeDraftContext } from "./knowledgeDraftContextService";
import { AppError, ErrorCodes } from "../utils/errors";

const MIN_KNOWLEDGE_CARD_CONFIDENCE = 0.65;
const CONFLICT_WARNING_PATTERN = /(?:conflict|contradict|context_conflict|evidence_conflict|证据冲突|上下文冲突)/i;
const REFUSAL_PATTERN = /(?:无法回答|无法确认|没有足够(?:信息|证据)|信息不足|不能确定|请补充)/;
const STEP_PATTERN = /(?:先|再|然后|随后|最后|检查|复核|记录|通知|隔离|调整|确认|执行|上传)/;
const RISK_PATTERN = /(?:风险|异常|冲突|不合格|失效|报警|偏差|超限|不足|错误|禁止)/;
const HANDLING_PATTERN = /(?:处理|检查|复核|调整|隔离|通知|记录|确认|排查|复测|更换|校准)/;
const PARAMETER_PATTERN = /([A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fff]{2,12})(?:\s*(?:[:：=]|为|是|不低于|低于|范围为|应为)\s*)([0-9]+(?:\.[0-9]+)?\s*[A-Za-z%Ωμ℃°-]*)/g;

export interface KnowledgeCardDraftUser {
  id: string;
  name: string;
}

export interface KnowledgeCardDraftOptions {
  includeSessionNotes?: boolean;
}

interface DraftBlockReason {
  code: string;
  message: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value || "") as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compactText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function splitSentences(text: string): string[] {
  return uniqueStrings(text.split(/[。！？!?；;\n]+/).map((item) => compactText(item, 180))).slice(0, 12);
}

function extractRelatedTerms(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  return uniqueStrings(matches).slice(0, 16);
}

function warningCodes(answerIrSummary: Record<string, unknown>, metadata: Record<string, unknown>): string[] {
  const answerWarnings = Array.isArray(answerIrSummary.warnings) ? answerIrSummary.warnings : [];
  const visualPlan = isRecord(metadata.visual_plan) ? metadata.visual_plan : {};
  const visualWarnings = Array.isArray(visualPlan.warnings) ? visualPlan.warnings : [];
  return [...answerWarnings, ...visualWarnings]
    .filter(isRecord)
    .map((warning) => stringValue(warning.code))
    .filter(Boolean);
}

function hasEvidenceConflict(answerIrSummary: Record<string, unknown>, metadata: Record<string, unknown>): boolean {
  const codes = warningCodes(answerIrSummary, metadata);
  const metadataText = JSON.stringify({
    status: answerIrSummary.status,
    warnings: codes,
    citation_coverage: metadata.citation_coverage,
  });
  return CONFLICT_WARNING_PATTERN.test(metadataText);
}

function confidenceFromMetadata(metadata: Record<string, unknown>, answerIrSummary: Record<string, unknown>): number {
  return numberValue(metadata.confidence) ?? numberValue(answerIrSummary.confidence) ?? 0;
}

function getQuestionFromThread(sessionId: string, assistantMessageId: string, metadata: Record<string, unknown>): string {
  const query = isRecord(metadata.query) ? metadata.query : {};
  const rewrittenQuestion = stringValue(query.rewritten_question);
  if (rewrittenQuestion) return rewrittenQuestion;

  const messages = listMessagesBySession(sessionId);
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId);
  const beforeAssistant = assistantIndex >= 0 ? messages.slice(0, assistantIndex) : messages;
  return beforeAssistant.reverse().find((message) => message.role === "user")?.content ?? "待审核知识卡";
}

function buildSourceRefs(messageId: string): KnowledgeCardSourceRef[] {
  return listMessageSourceDetails(messageId).map((source) => ({
    source_id: source.id,
    chunk_id: source.chunk_id,
    document_id: source.document_id ?? undefined,
    message_id: messageId,
    title: source.document_title,
    section_path: source.section_path,
    snippet: compactText(source.snippet || source.content, 260),
    score: source.score,
  }));
}

function artifactsForDraft(messageId: string) {
  return listArtifactsByMessage(messageId)
    .filter((artifact) => artifact.status === "ready")
    .map(formatArtifact);
}

function buildKeyParameters(text: string): KnowledgeCardKeyParameter[] {
  const parameters: KnowledgeCardKeyParameter[] = [];
  for (const match of text.matchAll(PARAMETER_PATTERN)) {
    const name = compactText(match[1] ?? "", 40);
    const value = compactText(match[2] ?? "", 40);
    if (!name || !value) continue;
    parameters.push({ name, value });
  }
  return parameters.slice(0, 8);
}

function buildSteps(sentences: string[]): KnowledgeCardStep[] {
  return sentences
    .filter((sentence) => STEP_PATTERN.test(sentence))
    .slice(0, 8)
    .map((sentence, index) => ({ title: sentence, order: index + 1 }));
}

function buildRisks(sentences: string[]): KnowledgeCardRisk[] {
  return sentences
    .filter((sentence) => RISK_PATTERN.test(sentence))
    .slice(0, 6)
    .map((sentence) => ({ title: sentence, level: "medium" }));
}

function buildHandlingMethods(sentences: string[]): KnowledgeCardHandlingMethod[] {
  return sentences
    .filter((sentence) => HANDLING_PATTERN.test(sentence))
    .slice(0, 8)
    .map((sentence) => ({ title: sentence }));
}

function blockReasons(input: {
  answer: string;
  answerIrSummary: Record<string, unknown>;
  metadata: Record<string, unknown>;
  confidence: number;
  sourceRefs: KnowledgeCardSourceRef[];
}): DraftBlockReason[] {
  const reasons: DraftBlockReason[] = [];
  const status = stringValue(input.answerIrSummary.status);
  const coverage = isRecord(input.metadata.citation_coverage) ? input.metadata.citation_coverage : {};
  const citedSourceCount = numberValue(coverage.cited_source_count) ?? 0;

  if (status !== "answered") {
    reasons.push({ code: "answer_not_ready", message: "回答不是 answered 状态，不能沉淀为知识卡草稿。" });
  }
  if (input.confidence < MIN_KNOWLEDGE_CARD_CONFIDENCE) {
    reasons.push({ code: "confidence_too_low", message: "回答置信度低于知识卡草稿阈值。" });
  }
  if (input.sourceRefs.length === 0 || citedSourceCount === 0) {
    reasons.push({ code: "missing_citations", message: "回答缺少可追溯引用，不能生成知识卡草稿。" });
  }
  if (hasEvidenceConflict(input.answerIrSummary, input.metadata)) {
    reasons.push({ code: "evidence_conflict", message: "回答存在证据冲突风险，必须人工复核后再沉淀。" });
  }
  if (REFUSAL_PATTERN.test(input.answer)) {
    reasons.push({ code: "refusal_answer", message: "回答呈现拒答或信息不足表达，不能生成知识卡草稿。" });
  }

  return reasons;
}

export function createKnowledgeCardDraftFromMessage(
  messageId: string,
  user: KnowledgeCardDraftUser,
  options: KnowledgeCardDraftOptions = {}
) {
  const message = getMessageById(messageId);
  if (!message) {
    throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
  }
  if (message.role !== "assistant") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "只能从 assistant 回答生成知识卡草稿。", 400);
  }

  const session = getSessionById(message.session_id);
  if (!session) {
    throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
  }

  const metadata = parseJson<Record<string, unknown>>(message.metadata_json, {});
  const answerIrSummary = isRecord(metadata.answer_ir_summary) ? metadata.answer_ir_summary : {};
  const confidence = confidenceFromMetadata(metadata, answerIrSummary);
  const sourceRefs = buildSourceRefs(message.id);
  const reasons = blockReasons({
    answer: message.content,
    answerIrSummary,
    metadata,
    confidence,
    sourceRefs,
  });

  if (reasons.length > 0) {
    if (reasons.some((reason) => reason.code === "evidence_conflict")) {
      emitWebhookEvent("document.conflict", {
        message_id: message.id,
        session_id: message.session_id,
        confidence,
        source_count: sourceRefs.length,
        reason_codes: reasons.map((reason) => reason.code),
        document_ids: uniqueStrings(sourceRefs.map((source) => source.document_id ?? "").filter(Boolean)),
      });
    }
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "当前回答不满足知识卡草稿生成条件。", 422, {
      blocked_reasons: reasons,
      confidence,
      message_id: message.id,
    });
  }

  const artifacts = artifactsForDraft(message.id);
  const artifactText = artifacts.map((artifact) => `${artifact.title}。${artifact.summary}`).join("。");
  const sourceText = sourceRefs.map((source) => source.snippet ?? "").join("。");
  const topic = getQuestionFromThread(message.session_id, message.id, metadata);
  const draftContext = buildKnowledgeDraftContext({
    sessionId: message.session_id,
    messageId: message.id,
    userId: user.id,
    metadata,
    question: topic,
    answer: message.content,
    includeSessionNotes: options.includeSessionNotes ?? false,
  });
  const corpus = [message.content, sourceText, draftContext.contextText, artifactText].filter(Boolean).join("。");
  const sentences = splitSentences(corpus);
  const sourceIds = sourceRefs.map((source) => source.source_id || source.chunk_id || "").filter(Boolean);
  const artifactIds = artifacts.map((artifact) => artifact.id);

  const card = createKnowledgeCard({
    topic: compactText(topic, 80),
    summary: compactText(message.content, 280),
    keyParameters: buildKeyParameters(corpus),
    steps: buildSteps(sentences),
    risks: buildRisks(sentences),
    handlingMethods: buildHandlingMethods(sentences),
    sourceRefs,
    relatedTerms: extractRelatedTerms(`${topic} ${corpus} ${draftContext.termText}`),
    status: "ai_draft",
    createdBy: user.id,
    createdByName: user.name,
    metadata: {
      draft_source: "chat_answer",
      answer_message_id: message.id,
      session_id: message.session_id,
      confidence,
      source_ids: uniqueStrings(sourceIds),
      note_ids: draftContext.noteIds,
      artifact_ids: artifactIds,
      note_count: draftContext.noteIds.length,
      artifact_count: artifacts.length,
      min_confidence: MIN_KNOWLEDGE_CARD_CONFIDENCE,
      draft_context: draftContext.metadata,
    },
    changeNote: "从高置信回答生成 AI 知识卡草稿",
  });

  return formatKnowledgeCard(card);
}
