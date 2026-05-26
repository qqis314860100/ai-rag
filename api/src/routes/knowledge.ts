import { Router, Request, Response, NextFunction } from "express";
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
import { sendSuccess } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";

const router = Router();

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
