import { Router, Request, Response, NextFunction } from "express";
import {
  KNOWLEDGE_FAQ_CONTRACT,
  createKnowledgeFaq,
  formatKnowledgeFaq,
  getKnowledgeFaqById,
  isKnowledgeFaqStatus,
  listKnowledgeFaqs,
} from "../../db/knowledgeFaqs";
import type { KnowledgeFaqStatus } from "../../db/knowledgeFaqs";
import { requirePermission } from "../../middleware/auth";
import { auditFromRequest } from "../../services/auditService";
import { createAsyncJob, runAsyncJob } from "../../services/asyncJobService";
import { createKnowledgeFaqDraftFromMessage } from "../../services/knowledgeFaqDraftService";
import { AppError, ErrorCodes } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";
import { currentUser, queryNumber, queryString, requireReadableMessage, sendQueuedJob } from "./shared";

export function registerKnowledgeFaqRoutes(router: Router) {
  router.get(
    "/knowledge/faqs/contract",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        sendSuccess(res, {
          contract: KNOWLEDGE_FAQ_CONTRACT,
          draft_generation: {
            endpoint: "POST /api/knowledge/faqs/draft/from-message",
            required_message_role: "assistant",
            min_confidence: 0.55,
            requires_citations: true,
            duplicate_policy: "按 normalized_question 合并并增加 frequency_count",
            inputs: ["answer_message", "source_refs", "query_understanding_candidates", "failure_clusters", "chat_notes"],
          },
        }, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/knowledge/faqs",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const status = queryString(req.query.status);
        let requestedStatus: KnowledgeFaqStatus | undefined;
        if (status !== undefined) {
          if (!isKnowledgeFaqStatus(status)) {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, "FAQ 状态不合法。", 400);
          }
          requestedStatus = status;
        }

        const result = listKnowledgeFaqs({
          status: requestedStatus,
          query: queryString(req.query.q),
          relatedCardId: queryString(req.query.related_card_id),
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
    "/knowledge/faqs/:id",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const row = getKnowledgeFaqById(String(req.params.id));
        if (!row) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "未找到对应 FAQ。", 404);
        }
        sendSuccess(res, formatKnowledgeFaq(row), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/knowledge/faqs",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const question = typeof req.body.question === "string" ? req.body.question.trim() : "";
        const answer = typeof req.body.answer === "string" ? req.body.answer.trim() : "";
        if (!question || !answer) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "FAQ 必须包含问题和答案。", 400);
        }
        const faq = createKnowledgeFaq({
          question,
          answer,
          sourceRefs: Array.isArray(req.body.source_refs) ? req.body.source_refs : [],
          applicableScope: typeof req.body.applicable_scope === "string" ? req.body.applicable_scope.trim() : "",
          invalidConditions: Array.isArray(req.body.invalid_conditions) ? req.body.invalid_conditions.map(String) : [],
          relatedCardIds: Array.isArray(req.body.related_card_ids) ? req.body.related_card_ids.map(String) : [],
          tags: Array.isArray(req.body.tags) ? req.body.tags.map(String) : [],
          status: "ai_draft",
          createdBy: currentUser(req).id,
          createdByName: currentUser(req).name,
        });
        auditFromRequest(req, "knowledge_faq.create", "knowledge_faq", faq.id, {
          source_count: JSON.parse(faq.source_refs_json || "[]").length,
        });
        sendSuccess(res, formatKnowledgeFaq(faq), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/knowledge/faqs/draft/from-message",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const messageId = typeof req.body.message_id === "string" ? req.body.message_id.trim() : "";
        if (!messageId) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "必须指定 message_id。", 400);
        }
        requireReadableMessage(req, messageId);
        const user = currentUser(req);
        const job = createAsyncJob("knowledge_faq.draft_from_message", {
          message_id: messageId,
          user_id: user.id,
        });

        runAsyncJob(job.id, async () => {
          const faq = createKnowledgeFaqDraftFromMessage(messageId, user);
          auditFromRequest(req, "knowledge_faq.draft.create", "knowledge_faq", faq.id, {
            job_id: job.id,
            message_id: messageId,
            source_count: faq.source_refs.length,
            frequency_count: faq.frequency_count,
          });
          return faq;
        });

        sendQueuedJob(res, job, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );
}
