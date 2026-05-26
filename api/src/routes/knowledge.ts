import { Router, Request, Response, NextFunction } from "express";
import {
  KNOWLEDGE_CARD_MODEL_CONTRACT,
  formatKnowledgeCard,
  formatKnowledgeCardVersion,
  getKnowledgeCardById,
  isKnowledgeCardStatus,
  listKnowledgeCardVersions,
  listKnowledgeCards,
} from "../db/knowledgeCards";
import type { KnowledgeCardStatus } from "../db/knowledgeCards";
import {
  TERMINOLOGY_CONTRACT,
  formatTerminologyTerm,
  getTerminologyTermByCanonicalTerm,
  getTerminologyTermById,
  isTerminologyStatus,
  listTerminologyTerms,
} from "../db/terminology";
import type { TerminologyStatus } from "../db/terminology";
import { requirePermission } from "../middleware/auth";
import { getSessionById } from "../db/chatSessions";
import { getMessageById } from "../db/chatMessages";
import { createKnowledgeCardDraftFromMessage } from "../services/knowledgeCardDraftService";
import {
  archiveKnowledgeCard,
  parseKnowledgeCardRevisionBody,
  publishKnowledgeCard,
  returnKnowledgeCard,
  reviseKnowledgeCard,
  submitKnowledgeCardForReview,
} from "../services/knowledgeCardReviewService";
import { auditFromRequest } from "../services/auditService";
import { sendSuccess } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";

const router = Router();

function canReadSession(req: Request, sessionUserId: string): boolean {
  const userId = req.user?.id || "anonymous";
  const isOwner = sessionUserId === userId;
  const isAdmin = req.user?.role === "system_admin" || req.user?.role === "knowledge_admin";
  return isOwner || isAdmin;
}

function currentUser(req: Request): { id: string; name: string } {
  return {
    id: req.user?.id || "anonymous",
    name: req.user?.name || "匿名",
  };
}

function requireReadableMessage(req: Request, messageId: string) {
  const message = getMessageById(messageId);
  if (!message) {
    throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
  }
  const session = getSessionById(message.session_id);
  if (!session) {
    throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
  }
  if (!canReadSession(req, session.user_id)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权限访问该会话。", 403);
  }
  return message;
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function queryNumber(value: unknown, fallback: number): number {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

router.get(
  "/knowledge/terms/contract",
  requirePermission("document.read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, {
        contract: TERMINOLOGY_CONTRACT,
        seed_terms: ["OCV", "DCR", "EOL", "SOC", "SOP", "CCD", "Busbar"],
      }, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/knowledge/terms",
  requirePermission("document.read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, q, related_topic } = req.query;
      const statusValue = typeof status === "string" ? status : undefined;
      let requestedStatus: TerminologyStatus | undefined;
      if (statusValue !== undefined) {
        if (!isTerminologyStatus(statusValue)) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "术语状态必须是 draft、published 或 archived。", 400);
        }
        requestedStatus = statusValue;
      } else if (status !== undefined) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "术语状态必须是 draft、published 或 archived。", 400);
      }

      const terms = listTerminologyTerms({
        status: requestedStatus ?? "published",
        query: typeof q === "string" ? q : undefined,
        relatedTopic: typeof related_topic === "string" ? related_topic : undefined,
      });
      sendSuccess(res, { items: terms, total: terms.length }, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/knowledge/cards/contract",
  requirePermission("document.read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, {
        contract: KNOWLEDGE_CARD_MODEL_CONTRACT,
        review_workflow: {
          revise: "PATCH /api/knowledge/cards/:id",
          submit: "POST /api/knowledge/cards/:id/submit",
          publish: "POST /api/knowledge/cards/:id/publish",
          return: "POST /api/knowledge/cards/:id/return",
          archive: "POST /api/knowledge/cards/:id/archive",
          required_evidence_before_publish: true,
          version_compare: "GET /api/knowledge/cards/:id/versions",
        },
        draft_generation: {
          endpoint: "POST /api/knowledge/cards/draft/from-message",
          required_message_role: "assistant",
          min_confidence: 0.65,
          requires_answer_status: "answered",
          requires_citations: true,
          blocks: ["low_confidence", "refusal_answer", "missing_citations", "evidence_conflict"],
          inputs: ["answer_message", "source_refs", "chat_notes", "chat_artifacts"],
        },
      }, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/knowledge/cards",
  requirePermission("document.read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = queryString(req.query.status);
      let requestedStatus: KnowledgeCardStatus | undefined;
      if (status !== undefined) {
        if (!isKnowledgeCardStatus(status)) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识卡状态不合法。", 400);
        }
        requestedStatus = status;
      }

      const result = listKnowledgeCards({
        status: requestedStatus,
        topic: queryString(req.query.topic ?? req.query.q),
        relatedTerm: queryString(req.query.related_term),
        reviewerId: queryString(req.query.reviewer_id),
        page: queryNumber(req.query.page, 1),
        pageSize: queryNumber(req.query.page_size, 20),
      });
      sendSuccess(res, result, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/knowledge/cards/:id",
  requirePermission("document.read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = getKnowledgeCardById(String(req.params.id));
      if (!row) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "未找到对应知识卡。", 404);
      }
      const versions = listKnowledgeCardVersions(row.id);
      sendSuccess(res, formatKnowledgeCard(row, versions), req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/knowledge/cards/:id/versions",
  requirePermission("document.read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = getKnowledgeCardById(String(req.params.id));
      if (!row) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "未找到对应知识卡。", 404);
      }
      const versions = listKnowledgeCardVersions(row.id).map(formatKnowledgeCardVersion);
      sendSuccess(res, { items: versions, total: versions.length }, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/knowledge/cards/draft/from-message",
  requirePermission("evaluation.run"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const messageId = typeof req.body.message_id === "string" ? req.body.message_id.trim() : "";
      if (!messageId) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "必须指定 message_id。", 400);
      }

      requireReadableMessage(req, messageId);
      const user = currentUser(req);
      const card = createKnowledgeCardDraftFromMessage(messageId, user, {
        includeSessionNotes: req.body.include_session_notes === true,
      });

      auditFromRequest(req, "knowledge_card.draft.create", "knowledge_card", card.id, {
        message_id: messageId,
        session_id: card.metadata.session_id,
        source_count: card.source_refs.length,
        note_count: card.metadata.note_count,
        artifact_count: card.metadata.artifact_count,
        confidence: card.metadata.confidence,
      });

      sendSuccess(res, card, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  "/knowledge/cards/:id",
  requirePermission("evaluation.run"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const card = reviseKnowledgeCard(String(req.params.id), currentUser(req), parseKnowledgeCardRevisionBody(req.body));
      auditFromRequest(req, "knowledge_card.revise", "knowledge_card", card.id, {
        status: card.status,
        version: card.current_version,
        source_count: card.source_refs.length,
      });
      sendSuccess(res, card, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/knowledge/cards/:id/submit",
  requirePermission("evaluation.run"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const card = submitKnowledgeCardForReview(String(req.params.id), currentUser(req), parseKnowledgeCardRevisionBody(req.body));
      auditFromRequest(req, "knowledge_card.submit_review", "knowledge_card", card.id, {
        status: card.status,
        version: card.current_version,
        source_count: card.source_refs.length,
      });
      sendSuccess(res, card, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/knowledge/cards/:id/publish",
  requirePermission("evaluation.run"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const card = publishKnowledgeCard(String(req.params.id), currentUser(req), parseKnowledgeCardRevisionBody(req.body));
      auditFromRequest(req, "knowledge_card.publish", "knowledge_card", card.id, {
        status: card.status,
        version: card.current_version,
        source_count: card.source_refs.length,
      });
      sendSuccess(res, card, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/knowledge/cards/:id/return",
  requirePermission("evaluation.run"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const card = returnKnowledgeCard(String(req.params.id), currentUser(req), parseKnowledgeCardRevisionBody(req.body));
      auditFromRequest(req, "knowledge_card.return", "knowledge_card", card.id, {
        status: card.status,
        version: card.current_version,
        source_count: card.source_refs.length,
      });
      sendSuccess(res, card, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/knowledge/cards/:id/archive",
  requirePermission("evaluation.run"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const card = archiveKnowledgeCard(String(req.params.id), currentUser(req), parseKnowledgeCardRevisionBody(req.body));
      auditFromRequest(req, "knowledge_card.archive", "knowledge_card", card.id, {
        status: card.status,
        version: card.current_version,
        source_count: card.source_refs.length,
      });
      sendSuccess(res, card, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  "/knowledge/terms/:idOrTerm",
  requirePermission("document.read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idOrTerm = String(req.params.idOrTerm).trim();
      const row = getTerminologyTermById(idOrTerm) ?? getTerminologyTermByCanonicalTerm(idOrTerm);
      if (!row) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "未找到对应术语。", 404);
      }

      sendSuccess(res, formatTerminologyTerm(row), req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
