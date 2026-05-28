import { getDb } from "../db";
import type { ChatMessageRow } from "../db/chatMessages";
import { listMessagesBySession } from "../db/chatMessages";
import { createFailedQuestion } from "../db/knowledgeGaps";
import type { FailedQuestionEventType } from "../db/knowledgeGaps";

interface FeedbackFailureInput {
  id: string;
  reason?: string | null;
  comment?: string | null;
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input || "") as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function answerQualityTier(metadata: Record<string, unknown>): string {
  const quality = isRecord(metadata.answer_quality) ? metadata.answer_quality : {};
  return stringValue(quality.tier);
}

function previousUserMessage(assistantMessage: ChatMessageRow): ChatMessageRow | null {
  const messages = listMessagesBySession(assistantMessage.session_id);
  const index = messages.findIndex((message) => message.id === assistantMessage.id);
  if (index === -1) return null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === "user") return messages[cursor];
  }
  return null;
}

function eventTypeFromMetadata(metadata: Record<string, unknown>): FailedQuestionEventType | null {
  const tier = answerQualityTier(metadata);
  const confidence = numberValue(metadata.confidence);
  if (tier === "refused") return "refusal";
  if (tier === "partial_answer" || (confidence !== null && confidence > 0 && confidence < 0.6)) return "low_confidence";
  return null;
}

function retrievalEvidenceFromSources(sources: unknown[]): Array<Record<string, unknown>> {
  return sources.filter(isRecord).slice(0, 8).map((source, index) => ({
    document_id: stringValue(source.document_id),
    chunk_id: stringValue(source.chunk_id) || stringValue(source.id),
    source_id: stringValue(source.id) || stringValue(source.chunk_id),
    title: stringValue(source.document_title) || stringValue(source.title),
    section_path: stringValue(source.section_path),
    snippet: stringValue(source.snippet) || stringValue(source.content).slice(0, 240),
    score: numberValue(source.score) ?? 0,
    rank: index + 1,
    retrieval_type: "semantic_candidate",
  }));
}

function queryUnderstandingFromMetadata(metadata: Record<string, unknown>): Array<Record<string, unknown>> {
  const queryUnderstanding = isRecord(metadata.query_understanding) ? metadata.query_understanding : {};
  const query = isRecord(metadata.query) ? metadata.query : {};
  return [{
    raw_query: stringValue(query.original_question),
    rewritten_query: stringValue(query.rewritten_question),
    intent: stringValue(queryUnderstanding.intent) || "general",
    terms: Array.isArray(queryUnderstanding.candidate_terms)
      ? queryUnderstanding.candidate_terms
        .filter(isRecord)
        .map((item) => stringValue(item.term) || stringValue(item.matched_text))
        .filter(Boolean)
      : [],
    confidence: numberValue(queryUnderstanding.confidence) ?? 0,
    source: "answer_metadata",
    candidate_terms: Array.isArray(queryUnderstanding.candidate_terms) ? queryUnderstanding.candidate_terms : [],
  }];
}

function alreadyRecorded(assistantMessageId: string, eventType: FailedQuestionEventType, feedbackId?: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id
       FROM failed_questions
       WHERE assistant_message_id = ?
         AND event_type = ?
         AND (? = '' OR feedback_id = ?)
       LIMIT 1`
    )
    .get(assistantMessageId, eventType, feedbackId ?? "", feedbackId ?? "") as { id: string } | undefined;
  return Boolean(row);
}

export function recordFailureSignalFromAssistantMessage(
  assistantMessage: ChatMessageRow,
  userId: string | null,
  eventType?: FailedQuestionEventType,
  feedback?: FeedbackFailureInput
) {
  if (assistantMessage.role !== "assistant") return null;

  const metadata = parseJson<Record<string, unknown>>(assistantMessage.metadata_json, {});
  const derivedEventType = eventType ?? eventTypeFromMetadata(metadata);
  if (!derivedEventType) return null;
  if (alreadyRecorded(assistantMessage.id, derivedEventType, feedback?.id)) return null;

  const userMessage = previousUserMessage(assistantMessage);
  const question = userMessage?.content || stringValue((isRecord(metadata.query) ? metadata.query : {}).original_question);
  if (!question.trim()) return null;

  const sources = parseJson<unknown[]>(assistantMessage.sources_json, []);
  return createFailedQuestion({
    eventType: derivedEventType,
    question,
    userId,
    sessionId: assistantMessage.session_id,
    userMessageId: userMessage?.id ?? null,
    assistantMessageId: assistantMessage.id,
    feedbackId: feedback?.id ?? null,
    answerSnapshot: assistantMessage.content.slice(0, 2000),
    confidence: numberValue(metadata.confidence),
    feedbackReason: feedback?.reason ?? "",
    feedbackComment: feedback?.comment ?? "",
    queryUnderstanding: queryUnderstandingFromMetadata(metadata),
    retrievalEvidence: retrievalEvidenceFromSources(sources),
    metadata: {
      source: feedback ? "negative_feedback" : "answer_quality",
      answer_quality: isRecord(metadata.answer_quality) ? metadata.answer_quality : {},
    },
  });
}
