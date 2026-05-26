import { createOrUpdateKnowledgeFaq, formatKnowledgeFaq } from "../db/knowledgeFaqs";
import { listKnowledgeCards } from "../db/knowledgeCards";
import type { KnowledgeCardSourceRef } from "../db/knowledgeCards";
import { getMessageById } from "../db/chatMessages";
import { listMessagesBySession } from "../db/chatMessages";
import { getSessionById } from "../db/chatSessions";
import { listMessageSourceDetails } from "../db/messageSources";
import { AppError, ErrorCodes } from "../utils/errors";

const MIN_FAQ_CONFIDENCE = 0.55;
const INVALID_CONDITION_PATTERN = /(?:不适用|失效|除非|仅限|不能|禁止|前提|条件|异常|过期|版本不一致)/;

export interface KnowledgeFaqDraftUser {
  id: string;
  name: string;
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

function compactText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function splitSentences(text: string): string[] {
  return uniqueStrings(text.split(/[。！？!?；;\n]+/).map((item) => compactText(item, 180))).slice(0, 12);
}

function metadataConfidence(metadata: Record<string, unknown>): number {
  const answerIrSummary = isRecord(metadata.answer_ir_summary) ? metadata.answer_ir_summary : {};
  const confidence = metadata.confidence ?? answerIrSummary.confidence;
  return typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0;
}

function questionFromThread(sessionId: string, assistantMessageId: string, metadata: Record<string, unknown>): string {
  const query = isRecord(metadata.query) ? metadata.query : {};
  const rewritten = typeof query.rewritten_question === "string" ? query.rewritten_question.trim() : "";
  if (rewritten) return rewritten;

  const messages = listMessagesBySession(sessionId);
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId);
  const previous = assistantIndex >= 0 ? messages.slice(0, assistantIndex) : messages;
  return previous.reverse().find((message) => message.role === "user")?.content ?? "待审核 FAQ";
}

function sourceRefs(messageId: string): KnowledgeCardSourceRef[] {
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

function tagsFromText(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9_-]{1,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  return uniqueStrings(matches).slice(0, 12);
}

function invalidConditionsFromText(text: string): string[] {
  return splitSentences(text).filter((sentence) => INVALID_CONDITION_PATTERN.test(sentence)).slice(0, 5);
}

function relatedCards(question: string, answer: string): string[] {
  const corpus = `${question} ${answer}`.toLowerCase();
  return listKnowledgeCards({ status: "published", pageSize: 100 }).items
    .filter((card) => {
      const terms = [card.topic, ...(card.related_terms ?? [])].map((term) => term.toLowerCase()).filter(Boolean);
      return terms.some((term) => term.length >= 2 && corpus.includes(term));
    })
    .map((card) => card.id)
    .slice(0, 8);
}

function applicableScopeFromSources(refs: KnowledgeCardSourceRef[]): string {
  const titles = uniqueStrings(refs.map((ref) => ref.title || ref.section_path || ref.document_id || "").filter(Boolean));
  return titles.length ? `适用于引用资料：${titles.slice(0, 4).join("、")}` : "待人工补充适用范围";
}

export function createKnowledgeFaqDraftFromMessage(messageId: string, user: KnowledgeFaqDraftUser) {
  const message = getMessageById(messageId);
  if (!message) {
    throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
  }
  if (message.role !== "assistant") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "只能从 assistant 回答生成 FAQ 草稿。", 400);
  }

  const session = getSessionById(message.session_id);
  if (!session) {
    throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
  }

  const metadata = parseJson<Record<string, unknown>>(message.metadata_json, {});
  const confidence = metadataConfidence(metadata);
  const refs = sourceRefs(message.id);
  if (confidence < MIN_FAQ_CONFIDENCE || refs.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "当前回答缺少 FAQ 沉淀所需的置信度或引用证据。", 422, {
      confidence,
      min_confidence: MIN_FAQ_CONFIDENCE,
      source_count: refs.length,
    });
  }

  const question = compactText(questionFromThread(message.session_id, message.id, metadata), 180);
  const faq = createOrUpdateKnowledgeFaq({
    question,
    answer: compactText(message.content, 800),
    sourceRefs: refs,
    applicableScope: applicableScopeFromSources(refs),
    invalidConditions: invalidConditionsFromText(message.content),
    relatedCardIds: relatedCards(question, message.content),
    tags: tagsFromText(`${question} ${message.content}`),
    status: "ai_draft",
    createdBy: user.id,
    createdByName: user.name,
    metadata: {
      draft_source: "chat_answer",
      answer_message_id: message.id,
      session_id: message.session_id,
      confidence,
      min_confidence: MIN_FAQ_CONFIDENCE,
    },
  });

  return formatKnowledgeFaq(faq);
}
