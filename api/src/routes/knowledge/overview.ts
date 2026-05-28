import { Router, Request, Response, NextFunction } from "express";
import { requirePermission } from "../../middleware/auth";
import { formatAsyncJob, getAsyncJob } from "../../services/asyncJobService";
import { buildKnowledgeGovernanceView } from "../../services/knowledgeGovernanceService";
import { buildKnowledgeGraph } from "../../services/knowledgeGraphService";
import { AppError, ErrorCodes } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

export function registerKnowledgeOverviewRoutes(router: Router) {
  router.get(
    "/knowledge/jobs/:id",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const job = getAsyncJob(String(req.params.id));
        if (!job) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "异步任务不存在或已过期。", 404);
        }
        sendSuccess(res, formatAsyncJob(job), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/knowledge/graph",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        sendSuccess(res, buildKnowledgeGraph(), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/knowledge/governance",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        sendSuccess(res, buildKnowledgeGovernanceView(), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );
}
