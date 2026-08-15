import {
  formatKnowledgeCard,
  getKnowledgeCardById,
  listKnowledgeCardVersions,
  updateKnowledgeCard,
} from "../db/knowledgeCards";
import type {
  KnowledgeCardHandlingMethod,
  KnowledgeCardKeyParameter,
  KnowledgeCardRisk,
  KnowledgeCardSourceRef,
  KnowledgeCardStatus,
  KnowledgeCardStep,
  UpdateKnowledgeCardInput,
} from "../db/knowledgeCards";
import { AppError, ErrorCodes } from "../utils/errors";

export interface KnowledgeCardReviewer {
  id: string;
  name: string;
}

export interface KnowledgeCardRevisionInput {
  topic?: string;
  summary?: string;
  key_parameters?: KnowledgeCardKeyParameter[];
  steps?: KnowledgeCardStep[];
  risks?: KnowledgeCardRisk[];
  handling_methods?: KnowledgeCardHandlingMethod[];
  source_refs?: KnowledgeCardSourceRef[];
  related_terms?: string[];
  change_note?: string;
}

type ReviewAction = "revise" | "submit" | "publish" | "return" | "archive";

const ALLOWED_TRANSITIONS: Record<ReviewAction, KnowledgeCardStatus[]> = {
  revise: ["ai_draft", "pending_review", "returned"],
  submit: ["ai_draft", "returned"],
  publish: ["pending_review"],
  return: ["pending_review"],
  archive: ["ai_draft", "pending_review", "returned", "published"],
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value || "") as T;
  } catch {
    return fallback;
  }
}

function cleanText(value: unknown, fieldName: string, required = false): string | undefined {
  if (value === undefined) {
    if (required) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `${fieldName} 不能为空。`, 400);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `${fieldName} 必须是字符串。`, 400);
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `${fieldName} 不能为空。`, 400);
  }
  return trimmed;
}

function arrayValue<T>(value: unknown, fieldName: string): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `${fieldName} 必须是数组。`, 400);
  }
  return value as T[];
}

function currentSourceRefs(row: ReturnType<typeof getKnowledgeCardById>, revision?: KnowledgeCardRevisionInput) {
  if (!row) return [];
  if (revision?.source_refs !== undefined) return revision.source_refs;
  return parseJson<KnowledgeCardSourceRef[]>(row.source_refs_json, []);
}

function ensureTransition(action: ReviewAction, status: KnowledgeCardStatus) {
  if (!ALLOWED_TRANSITIONS[action].includes(status)) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `当前状态 ${status} 不能执行该知识卡审核动作。`,
      409,
      { action, allowed_from: ALLOWED_TRANSITIONS[action] }
    );
  }
}

function ensureEvidence(sourceRefs: KnowledgeCardSourceRef[]) {
  const hasEvidence = sourceRefs.some((ref) =>
    Boolean(ref.source_id || ref.chunk_id || ref.document_id || ref.snippet)
  );
  if (!hasEvidence) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      "知识卡发布前必须保留至少一条引用证据。",
      422,
      { required_field: "source_refs" }
    );
  }
}

function revisionFromBody(body: Record<string, unknown>): KnowledgeCardRevisionInput {
  return {
    topic: cleanText(body.topic, "topic"),
    summary: cleanText(body.summary, "summary"),
    key_parameters: arrayValue<KnowledgeCardKeyParameter>(body.key_parameters, "key_parameters"),
    steps: arrayValue<KnowledgeCardStep>(body.steps, "steps"),
    risks: arrayValue<KnowledgeCardRisk>(body.risks, "risks"),
    handling_methods: arrayValue<KnowledgeCardHandlingMethod>(body.handling_methods, "handling_methods"),
    source_refs: arrayValue<KnowledgeCardSourceRef>(body.source_refs, "source_refs"),
    related_terms: arrayValue<string>(body.related_terms, "related_terms")?.map((term) => String(term).trim()).filter(Boolean),
    change_note: cleanText(body.change_note, "change_note"),
  };
}

function updateInputFor(
  action: ReviewAction,
  row: NonNullable<ReturnType<typeof getKnowledgeCardById>>,
  reviewer: KnowledgeCardReviewer,
  revision: KnowledgeCardRevisionInput,
  status?: KnowledgeCardStatus,
  defaultNote?: string
): UpdateKnowledgeCardInput {
  const existingMetadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  const now = new Date().toISOString();
  return {
    topic: revision.topic,
    summary: revision.summary,
    keyParameters: revision.key_parameters,
    steps: revision.steps,
    risks: revision.risks,
    handlingMethods: revision.handling_methods,
    sourceRefs: revision.source_refs,
    relatedTerms: revision.related_terms,
    status,
    reviewerId: action === "revise" ? undefined : reviewer.id,
    reviewerName: action === "revise" ? undefined : reviewer.name,
    reviewedAt: action === "revise" || action === "submit" ? undefined : now,
    metadata: {
      ...existingMetadata,
      review_workflow: {
        action,
        actor_id: reviewer.id,
        actor_name: reviewer.name,
        at: now,
        note: revision.change_note || defaultNote || null,
      },
    },
    changedBy: reviewer.id,
    changedByName: reviewer.name,
    changeNote: revision.change_note || defaultNote || null,
  };
}

function getExistingCard(id: string) {
  const row = getKnowledgeCardById(id);
  if (!row) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "未找到对应知识卡。", 404);
  }
  return row;
}

export function parseKnowledgeCardRevisionBody(body: unknown): KnowledgeCardRevisionInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {};
  }
  return revisionFromBody(body as Record<string, unknown>);
}

export function reviseKnowledgeCard(id: string, reviewer: KnowledgeCardReviewer, revision: KnowledgeCardRevisionInput) {
  const row = getExistingCard(id);
  ensureTransition("revise", row.status);
  if (revision.topic !== undefined && !revision.topic) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识卡主题不能为空。", 400);
  }

  const updated = updateKnowledgeCard(
    id,
    updateInputFor("revise", row, reviewer, revision, undefined, "人工修订知识卡")
  );
  return formatKnowledgeCard(updated!, listKnowledgeCardVersions(id));
}

export function submitKnowledgeCardForReview(id: string, reviewer: KnowledgeCardReviewer, revision: KnowledgeCardRevisionInput) {
  const row = getExistingCard(id);
  ensureTransition("submit", row.status);
  ensureEvidence(currentSourceRefs(row, revision));

  const updated = updateKnowledgeCard(
    id,
    updateInputFor("submit", row, reviewer, revision, "pending_review", "提交知识卡审核")
  );
  return formatKnowledgeCard(updated!, listKnowledgeCardVersions(id));
}

export function publishKnowledgeCard(id: string, reviewer: KnowledgeCardReviewer, revision: KnowledgeCardRevisionInput) {
  const row = getExistingCard(id);
  ensureTransition("publish", row.status);
  ensureEvidence(currentSourceRefs(row, revision));

  const updated = updateKnowledgeCard(
    id,
    updateInputFor("publish", row, reviewer, revision, "published", "发布知识卡")
  );
  return formatKnowledgeCard(updated!, listKnowledgeCardVersions(id));
}

export function returnKnowledgeCard(id: string, reviewer: KnowledgeCardReviewer, revision: KnowledgeCardRevisionInput) {
  const row = getExistingCard(id);
  ensureTransition("return", row.status);
  const note = cleanText(revision.change_note, "change_note", true);

  const updated = updateKnowledgeCard(
    id,
    updateInputFor("return", row, reviewer, { ...revision, change_note: note }, "returned", "退回知识卡")
  );
  return formatKnowledgeCard(updated!, listKnowledgeCardVersions(id));
}

export function archiveKnowledgeCard(id: string, reviewer: KnowledgeCardReviewer, revision: KnowledgeCardRevisionInput) {
  const row = getExistingCard(id);
  ensureTransition("archive", row.status);

  const updated = updateKnowledgeCard(
    id,
    updateInputFor("archive", row, reviewer, revision, "archived", "归档知识卡")
  );
  return formatKnowledgeCard(updated!, listKnowledgeCardVersions(id));
}
