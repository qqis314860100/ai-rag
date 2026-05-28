import {
  createKnowledgeCard,
  formatKnowledgeCard,
  type KnowledgeCardSourceRef,
  type KnowledgeCardStep,
} from "../db/knowledgeCards";
import { createOrUpdateKnowledgeFaq, formatKnowledgeFaq } from "../db/knowledgeFaqs";
import {
  attachFailedQuestionsToGap,
  canTransitionKnowledgeGapStatus,
  formatKnowledgeGap,
  getFailedQuestionById,
  getKnowledgeGapById,
  listFailedQuestions,
  updateKnowledgeGapStatus,
  type KnowledgeGapRow,
  type RetrievalEvidenceRef,
} from "../db/knowledgeGaps";
import { formatTerminologyTerm, upsertTerminologyTerm, type TerminologySourceRef } from "../db/terminology";
import { AppError, ErrorCodes } from "../utils/errors";

interface GovernanceUser {
  id: string;
  name: string;
}

type DraftSuggestion = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map(String).map((item) => item.trim()).filter(Boolean))) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function draftSuggestions(gap: KnowledgeGapRow) {
  const metadata = recordValue(formatKnowledgeGap(gap).metadata);
  return recordValue(metadata.draft_suggestions);
}

function draftItems(value: unknown): DraftSuggestion[] {
  return Array.isArray(value) ? value.filter((item): item is DraftSuggestion => Object.keys(recordValue(item)).length > 0) : [];
}

function sourceRefsFromEvidence(evidence: RetrievalEvidenceRef[]): TerminologySourceRef[] {
  return evidence.slice(0, 8).map((item) => ({
    document_id: item.document_id,
    title: item.title,
    section_path: item.section_path,
    chunk_id: item.chunk_id,
  }));
}

function cardSourceRefsFromEvidence(evidence: RetrievalEvidenceRef[]): KnowledgeCardSourceRef[] {
  return evidence.slice(0, 8).map((item) => ({
    document_id: item.document_id,
    chunk_id: item.chunk_id,
    source_id: item.source_id,
    title: item.title,
    section_path: item.section_path,
    snippet: item.snippet,
    score: item.score,
  }));
}

function ensureGap(gapId: string): KnowledgeGapRow {
  const gap = getKnowledgeGapById(gapId);
  if (!gap) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识缺口不存在。", 404);
  }
  return gap;
}

function failedQuestionForGap(gap: KnowledgeGapRow, failedQuestionId?: string) {
  const fallback = listFailedQuestions({ gapId: gap.id, page: 1, pageSize: 1 }).items[0];
  if (!failedQuestionId) return fallback;

  const failedQuestion = getFailedQuestionById(failedQuestionId);
  const sampleIds = new Set(JSON.parse(gap.sample_failed_question_ids_json || "[]") as string[]);
  if (!failedQuestion || (failedQuestion.gap_id !== gap.id && !sampleIds.has(failedQuestion.id))) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "失败问题不属于当前知识缺口。", 400);
  }
  return failedQuestion;
}

function updateGapAfterDraft(gap: KnowledgeGapRow, user: GovernanceUser, assetId: string, action: string) {
  const nextStatus = canTransitionKnowledgeGapStatus(gap.status, "draft_generated") ? "draft_generated" : gap.status;
  const updated = updateKnowledgeGapStatus(gap.id, {
    status: nextStatus,
    reason: action,
    operatorId: user.id,
    operatorName: user.name,
    draftAssetIds: [assetId],
    metadata: {
      last_governance_action: {
        action,
        asset_id: assetId,
        operator_id: user.id,
        operator_name: user.name,
        changed_at: new Date().toISOString(),
      },
    },
  });
  return updated ? formatKnowledgeGap(updated) : null;
}

export function acceptKnowledgeGapAliasCandidates(gapId: string, user: GovernanceUser) {
  const gap = ensureGap(gapId);
  const suggestions = draftSuggestions(gap);
  const aliasCandidates = draftItems(suggestions.alias_candidates);
  if (aliasCandidates.length === 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "当前知识缺口没有可接受的候选别名。", 400);
  }

  const evidence = JSON.parse(gap.retrieval_evidence_json || "[]") as RetrievalEvidenceRef[];
  const sourceRefs = sourceRefsFromEvidence(evidence);
  const terms = aliasCandidates.map((candidate) => {
    const canonicalTerm = stringValue(candidate.canonical_term);
    const aliases = stringArray(candidate.aliases);
    const singleAlias = stringValue(candidate.alias);
    const acceptedAliases = Array.from(new Set([...aliases, singleAlias].filter(Boolean)));
    if (!canonicalTerm || acceptedAliases.length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "候选别名必须包含 canonical_term 和 alias/aliases。", 400);
    }
    return upsertTerminologyTerm({
      canonicalTerm,
      aliases: acceptedAliases,
      retrievalTerms: stringArray(candidate.retrieval_terms),
      sourceRefs,
      relatedTopics: [gap.title],
      status: "published",
      source: "knowledge_gap_governance",
      confidence: typeof candidate.confidence === "number" ? candidate.confidence : undefined,
      reviewerId: user.id,
      reviewerName: user.name,
      feedbackStatus: "fed_back",
      metadata: {
        source_gap_id: gap.id,
        accepted_from: "alias_candidate",
      },
    });
  });

  const updated = updateKnowledgeGapStatus(gap.id, {
    status: canTransitionKnowledgeGapStatus(gap.status, "draft_generated") ? "draft_generated" : gap.status,
    reason: "批量接受候选别名",
    operatorId: user.id,
    operatorName: user.name,
    draftAssetIds: terms.map((term) => term.id),
    metadata: {
      accepted_alias_term_ids: terms.map((term) => term.id),
    },
  });

  return {
    accepted_terms: terms.map(formatTerminologyTerm),
    gap: updated ? formatKnowledgeGap(updated) : formatKnowledgeGap(gap),
  };
}

export function mergeKnowledgeGapIntoTarget(gapId: string, targetGapId: string, user: GovernanceUser) {
  const gap = ensureGap(gapId);
  const target = ensureGap(targetGapId);
  if (gap.id === target.id) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识缺口不能合并到自身。", 400);
  }
  if (!canTransitionKnowledgeGapStatus(gap.status, "merged")) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "当前状态不能合并到其他缺口。", 400);
  }

  const sampleIds = JSON.parse(gap.sample_failed_question_ids_json || "[]") as string[];
  const attached = attachFailedQuestionsToGap(target.id, sampleIds);
  const updated = updateKnowledgeGapStatus(gap.id, {
    status: "merged",
    reason: `合并到相似缺口：${target.title}`,
    operatorId: user.id,
    operatorName: user.name,
    mergedToGapId: target.id,
    metadata: {
      merged_sample_count: sampleIds.length,
      attached_failed_question_count: attached,
    },
  });

  return {
    gap: updated ? formatKnowledgeGap(updated) : formatKnowledgeGap(gap),
    target_gap: formatKnowledgeGap(target),
    attached_failed_question_count: attached,
  };
}

export function createFaqFromKnowledgeGap(gapId: string, user: GovernanceUser, failedQuestionId?: string) {
  const gap = ensureGap(gapId);
  const suggestions = draftSuggestions(gap);
  const faqDraft = draftItems(suggestions.faq_drafts)[0] ?? {};
  const failedQuestion = failedQuestionForGap(gap, failedQuestionId);

  const question = stringValue(faqDraft.question) || failedQuestion?.question || gap.representative_question;
  const answer = stringValue(faqDraft.answer) || failedQuestion?.answer_snapshot || "";
  if (!question || !answer) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "转 FAQ 需要问题和可追溯回答快照。", 400);
  }

  const evidence = JSON.parse(gap.retrieval_evidence_json || "[]") as RetrievalEvidenceRef[];
  const faq = createOrUpdateKnowledgeFaq({
    question,
    answer,
    sourceRefs: cardSourceRefsFromEvidence(evidence),
    applicableScope: stringValue(faqDraft.applicable_scope) || gap.title,
    invalidConditions: stringArray(faqDraft.invalid_conditions),
    tags: Array.from(new Set(["知识缺口", gap.gap_type, ...stringArray(faqDraft.tags)])),
    status: "ai_draft",
    frequencyCount: gap.frequency_count,
    createdBy: user.id,
    createdByName: user.name,
    metadata: {
      source_gap_id: gap.id,
      source_failed_question_id: failedQuestionId || failedQuestion?.id,
      source: "knowledge_gap_governance",
    },
  });

  return {
    faq: formatKnowledgeFaq(faq),
    gap: updateGapAfterDraft(gap, user, faq.id, "将失败问题转 FAQ"),
  };
}

export function createSopSnippetFromKnowledgeGap(gapId: string, user: GovernanceUser, failedQuestionId?: string) {
  const gap = ensureGap(gapId);
  const suggestions = draftSuggestions(gap);
  const cardDraft = draftItems(suggestions.knowledge_card_drafts)[0] ?? {};
  const failedQuestion = failedQuestionForGap(gap, failedQuestionId);
  const evidence = JSON.parse(gap.retrieval_evidence_json || "[]") as RetrievalEvidenceRef[];
  const answerSnapshot = failedQuestion?.answer_snapshot || "";
  const summary = stringValue(cardDraft.summary) || answerSnapshot.slice(0, 360);
  if (!summary) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "转 SOP 片段需要回答快照或知识卡草稿摘要。", 400);
  }

  const steps = Array.isArray(cardDraft.steps)
    ? (cardDraft.steps as KnowledgeCardStep[])
    : answerSnapshot
      .split(/[。；;\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((description, index) => ({ title: `步骤 ${index + 1}`, description, order: index + 1 }));

  // SOP 片段先复用知识卡模型，避免在没有审核流的情况下新增正式 SOP 表。
  const card = createKnowledgeCard({
    topic: stringValue(cardDraft.title) || `SOP 片段：${gap.title}`,
    summary,
    steps,
    sourceRefs: cardSourceRefsFromEvidence(evidence),
    relatedTerms: stringArray(cardDraft.related_terms),
    status: "ai_draft",
    createdBy: user.id,
    createdByName: user.name,
    metadata: {
      asset_type: "sop_snippet",
      source_gap_id: gap.id,
      source_failed_question_id: failedQuestionId || failedQuestion?.id,
      source: "knowledge_gap_governance",
    },
    changeNote: "从知识缺口治理创建 SOP 片段草稿",
  });

  return {
    card: formatKnowledgeCard(card),
    gap: updateGapAfterDraft(gap, user, card.id, "将回答转 SOP 片段"),
  };
}
