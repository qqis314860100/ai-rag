import { Router, Request, Response, NextFunction } from "express";
import {
  isFailedQuestionEventType,
  canTransitionKnowledgeGapStatus,
  formatKnowledgeGap,
  getKnowledgeGapById,
  getKnowledgeGapStatusContract,
  isKnowledgeGapStatus,
  isKnowledgeGapType,
  listFailedQuestions,
  listKnowledgeGaps,
  updateKnowledgeGapStatus,
} from "../../db/knowledgeGaps";
import type { FailedQuestionEventType, KnowledgeGapStatus, KnowledgeGapType } from "../../db/knowledgeGaps";
import { requirePermission } from "../../middleware/auth";
import { auditFromRequest } from "../../services/auditService";
import { createAsyncJob, runAsyncJob } from "../../services/asyncJobService";
import { generateKnowledgeGapClusterDrafts } from "../../services/knowledgeGapClusterService";
import {
  acceptKnowledgeGapAliasCandidates,
  createFaqFromKnowledgeGap,
  createSopSnippetFromKnowledgeGap,
  mergeKnowledgeGapIntoTarget,
} from "../../services/knowledgeGapGovernanceService";
import { AppError, ErrorCodes } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";
import { bodyString, bodyStringArray, currentUser, queryNumber, queryString, sendQueuedJob } from "./shared";

export function registerKnowledgeGapRoutes(router: Router) {
  router.get(
    "/knowledge/gaps/status-flow",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        sendSuccess(res, getKnowledgeGapStatusContract(), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    "/knowledge/gaps/:id/status",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const gapId = String(req.params.id || "").trim();
        const gap = getKnowledgeGapById(gapId);
        if (!gap) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识缺口不存在。", 404);
        }

        const status = bodyString(req.body.status);
        if (!isKnowledgeGapStatus(status)) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识缺口状态不合法。", 400);
        }

        if (!canTransitionKnowledgeGapStatus(gap.status, status)) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识缺口状态迁移不合法。", 400, {
            current_status: gap.status,
            requested_status: status,
            allowed_statuses: getKnowledgeGapStatusContract().transitions[gap.status],
          });
        }

        const mergedToGapId = bodyString(req.body.merged_to_gap_id || req.body.merge_target_gap_id);
        if (status === "merged") {
          if (!mergedToGapId) {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, "合并知识缺口必须指定目标缺口。", 400);
          }
          if (mergedToGapId === gap.id) {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识缺口不能合并到自身。", 400);
          }
          if (!getKnowledgeGapById(mergedToGapId)) {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, "目标知识缺口不存在。", 400);
          }
        }

        const updated = updateKnowledgeGapStatus(gap.id, {
          status,
          reason: bodyString(req.body.reason),
          operatorId: req.user?.id ?? null,
          operatorName: req.user?.name ?? null,
          mergedToGapId: mergedToGapId || null,
          draftAssetIds: bodyStringArray(req.body.draft_asset_ids),
          publishedAssetIds: bodyStringArray(req.body.published_asset_ids),
        });
        if (!updated) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识缺口不存在。", 404);
        }

        auditFromRequest(req, "knowledge_gap.status.update", "knowledge_gap", gap.id, {
          old_status: gap.status,
          new_status: status,
          reason: bodyString(req.body.reason),
          merged_to_gap_id: mergedToGapId || undefined,
          draft_asset_ids: bodyStringArray(req.body.draft_asset_ids),
          published_asset_ids: bodyStringArray(req.body.published_asset_ids),
        });

        sendSuccess(res, {
          gap: formatKnowledgeGap(updated),
          transition: {
            old_status: gap.status,
            new_status: status,
            allowed_next_statuses: getKnowledgeGapStatusContract().transitions[status],
          },
        }, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/knowledge/gaps",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const status = queryString(req.query.status);
        let requestedStatus: KnowledgeGapStatus | undefined;
        if (status !== undefined) {
          if (!isKnowledgeGapStatus(status)) {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识缺口状态不合法。", 400);
          }
          requestedStatus = status;
        }
        const gapType = queryString(req.query.gap_type);
        let requestedGapType: KnowledgeGapType | undefined;
        if (gapType !== undefined) {
          if (!isKnowledgeGapType(gapType)) {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, "知识缺口类型不合法。", 400);
          }
          requestedGapType = gapType;
        }

        sendSuccess(res, listKnowledgeGaps({
          status: requestedStatus,
          gapType: requestedGapType,
          query: queryString(req.query.q),
          page: queryNumber(req.query.page, 1),
          pageSize: queryNumber(req.query.page_size, 20),
        }), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/knowledge/failed-questions",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const eventType = queryString(req.query.event_type);
        let requestedEventType: FailedQuestionEventType | undefined;
        if (eventType !== undefined) {
          if (!isFailedQuestionEventType(eventType)) {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, "失败问题事件类型不合法。", 400);
          }
          requestedEventType = eventType;
        }

        sendSuccess(res, listFailedQuestions({
          gapId: queryString(req.query.gap_id),
          eventType: requestedEventType,
          sessionId: queryString(req.query.session_id),
          userId: queryString(req.query.user_id),
          page: queryNumber(req.query.page, 1),
          pageSize: queryNumber(req.query.page_size, 20),
        }), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/knowledge/gaps/cluster-drafts",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const options = {
          minFrequency: queryNumber(req.body.min_frequency, 2),
          maxClusters: queryNumber(req.body.max_clusters, 20),
          sampleLimit: queryNumber(req.body.sample_limit, 200),
          persist: req.body.persist !== false,
          requestId: req.requestId,
          userId: req.user?.id,
        };
        const job = createAsyncJob("knowledge_gap.cluster_drafts", {
          min_frequency: options.minFrequency,
          max_clusters: options.maxClusters,
          sample_limit: options.sampleLimit,
          persist: options.persist,
        });

        runAsyncJob(job.id, async () => {
          const result = await generateKnowledgeGapClusterDrafts(options);
          auditFromRequest(req, "knowledge_gap.cluster_drafts.generate", "knowledge_gap", "batch", {
            job_id: job.id,
            cluster_count: result.clusters.length,
            persisted_count: result.persisted.length,
            ignored_count: result.ignored_count,
          });
          return result;
        });

        sendQueuedJob(res, job, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/knowledge/gaps/:id/actions/accept-aliases",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = acceptKnowledgeGapAliasCandidates(String(req.params.id), currentUser(req));
        auditFromRequest(req, "knowledge_gap.aliases.accept", "knowledge_gap", String(req.params.id), {
          accepted_count: result.accepted_terms.length,
        });
        sendSuccess(res, result, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/knowledge/gaps/:id/actions/merge",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const targetGapId = bodyString(req.body.target_gap_id || req.body.merged_to_gap_id);
        if (!targetGapId) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "合并知识缺口必须指定 target_gap_id。", 400);
        }
        const result = mergeKnowledgeGapIntoTarget(String(req.params.id), targetGapId, currentUser(req));
        auditFromRequest(req, "knowledge_gap.merge", "knowledge_gap", String(req.params.id), {
          target_gap_id: result.target_gap.id,
          attached_failed_question_count: result.attached_failed_question_count,
        });
        sendSuccess(res, result, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/knowledge/gaps/:id/actions/create-faq",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = createFaqFromKnowledgeGap(
          String(req.params.id),
          currentUser(req),
          bodyString(req.body.failed_question_id) || undefined
        );
        auditFromRequest(req, "knowledge_gap.faq.create", "knowledge_gap", String(req.params.id), {
          faq_id: result.faq.id,
          failed_question_id: bodyString(req.body.failed_question_id) || undefined,
        });
        sendSuccess(res, result, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/knowledge/gaps/:id/actions/create-sop-snippet",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = createSopSnippetFromKnowledgeGap(
          String(req.params.id),
          currentUser(req),
          bodyString(req.body.failed_question_id) || undefined
        );
        auditFromRequest(req, "knowledge_gap.sop_snippet.create", "knowledge_gap", String(req.params.id), {
          card_id: result.card.id,
          failed_question_id: bodyString(req.body.failed_question_id) || undefined,
        });
        sendSuccess(res, result, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );
}
