import { Router, Request, Response, NextFunction } from "express";
import { searchDocuments, searchDebug } from "../services/ragClient";
import { sendSuccess } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";
import { getSecurityLevelsForRequest, requirePermission } from "../middleware/auth";
import { requireAuth } from "../middleware/jwtAuth";
import { auditFromRequest } from "../services/auditService";

const router = Router();

// POST /api/search - semantic search
router.post("/search", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query, top_k, mode, filters } = req.body;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "查询内容不能为空。", 400);
    }

    const allowedSecurityLevels = getSecurityLevelsForRequest(req);

    auditFromRequest(req, "search.execute", "search", undefined, {
      query: query.substring(0, 200),
      top_k,
      mode,
    });

    const result = await searchDocuments(
      query,
      allowedSecurityLevels,
      top_k,
      mode,
      filters ?? {},
      req.requestId
    );

    sendSuccess(res, result, req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/search/debug - search debugging
router.post(
  "/search/debug",
  requirePermission("search.debug"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { query, top_k, mode, filters, include_prompt } = req.body;

      if (!query || typeof query !== "string" || query.trim().length === 0) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "查询内容不能为空。", 400);
      }

      const allowedSecurityLevels = getSecurityLevelsForRequest(req);

      auditFromRequest(req, "search.debug", "search", undefined, {
        query: query.substring(0, 200),
      });

      const result = await searchDebug(
        query,
        allowedSecurityLevels,
        top_k,
        mode,
        filters ?? {},
        include_prompt ?? false,
        req.requestId
      );

      sendSuccess(res, result, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
