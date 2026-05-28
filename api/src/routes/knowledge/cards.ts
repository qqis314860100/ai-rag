import { Router, Request, Response, NextFunction } from "express";
import {
  KNOWLEDGE_CARD_MODEL_CONTRACT,
  formatKnowledgeCard,
  formatKnowledgeCardVersion,
  getKnowledgeCardById,
  isKnowledgeCardStatus,
  listKnowledgeCardVersions,
  listKnowledgeCards,
} from "../../db/knowledgeCards";
import type { KnowledgeCardStatus } from "../../db/knowledgeCards";
import { getDb } from "../../db";
import { requirePermission } from "../../middleware/auth";
import { auditFromRequest } from "../../services/auditService";
import { createAsyncJob, runAsyncJob } from "../../services/asyncJobService";
import { createKnowledgeCardDraftFromMessage } from "../../services/knowledgeCardDraftService";
import {
  archiveKnowledgeCard,
  parseKnowledgeCardRevisionBody,
  publishKnowledgeCard,
  returnKnowledgeCard,
  reviseKnowledgeCard,
  submitKnowledgeCardForReview,
} from "../../services/knowledgeCardReviewService";
import { emitWebhookEvent } from "../../services/webhookService";
import { AppError, ErrorCodes } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";
import { currentUser, queryNumber, queryString, requireReadableMessage, sendQueuedJob } from "./shared";

function knowledgeAssetStatusesForMessages(messageIds: string[]) {
  const result: Record<string, { card?: string; faq?: string }> = {};
  const db = getDb();
  for (const messageId of messageIds) {
    const likePattern = `%"answer_message_id":"${messageId}"%`;
    const card = db.prepare(
      "SELECT status FROM knowledge_cards WHERE metadata_json LIKE ? ORDER BY updated_at DESC LIMIT 1"
    ).get(likePattern) as { status: string } | undefined;
    const faq = db.prepare(
      "SELECT status FROM knowledge_faqs WHERE metadata_json LIKE ? ORDER BY updated_at DESC LIMIT 1"
    ).get(likePattern) as { status: string } | undefined;
    if (card || faq) {
      result[messageId] = {
        ...(card ? { card: card.status } : {}),
        ...(faq ? { faq: faq.status } : {}),
      };
    }
  }
  return result;
}

export function registerKnowledgeCardRoutes(router: Router) {
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
            inputs: ["answer_message", "source_refs", "query_understanding_candidates", "failure_clusters", "chat_notes", "chat_artifacts"],
          },
        }, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/knowledge/assets/status-by-message",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const raw = typeof req.query.message_ids === "string" ? req.query.message_ids : "";
        const messageIds = raw.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 80);
        sendSuccess(res, knowledgeAssetStatusesForMessages(messageIds), req.requestId);
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
        const includeSessionNotes = req.body.include_session_notes === true;
        const job = createAsyncJob("knowledge_card.draft_from_message", {
          message_id: messageId,
          user_id: user.id,
          include_session_notes: includeSessionNotes,
        });

        runAsyncJob(job.id, async () => {
          const card = createKnowledgeCardDraftFromMessage(messageId, user, { includeSessionNotes });
          auditFromRequest(req, "knowledge_card.draft.create", "knowledge_card", card.id, {
            job_id: job.id,
            message_id: messageId,
            session_id: card.metadata.session_id,
            source_count: card.source_refs.length,
            note_count: card.metadata.note_count,
            artifact_count: card.metadata.artifact_count,
            confidence: card.metadata.confidence,
          });
          return card;
        });

        sendQueuedJob(res, job, req.requestId);
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
        emitWebhookEvent("knowledge_card.published", {
          card_id: card.id,
          topic: card.topic,
          summary: card.summary,
          version: card.current_version,
          source_count: card.source_refs.length,
          reviewer_id: req.user?.id,
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
}
