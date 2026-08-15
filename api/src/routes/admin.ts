import { Router, Request, Response, NextFunction } from "express";
import { getAllSettings, getAllSettingsFlat, setMultipleSettings } from "../db/settings";
import { listAuditLogs } from "../db/auditLogs";
import { sendSuccess, sendPaginated } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";
import { requirePermission } from "../middleware/auth";
import { auditFromRequest } from "../services/auditService";
import { getRollingMetrics } from "../services/metricsService";

const router = Router();

// GET /api/admin/metrics - rolling runtime metrics for system admins
router.get("/admin/metrics", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== "system_admin") {
      throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权限查看运行指标。", 403);
    }

    sendSuccess(res, getRollingMetrics(), req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/settings - get all settings
router.get(
  "/admin/settings",
  requirePermission("settings.update"),
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = getAllSettingsFlat();
    sendSuccess(res, settings, req.requestId);
  } catch (err) {
    next(err);
  }
});

// PUT /api/admin/settings - update settings
router.put(
  "/admin/settings",
  requirePermission("settings.update"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updates = req.body;
      if (!updates || typeof updates !== "object" || Object.keys(updates).length === 0) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "请提供要更新的设置项。", 400);
      }

      // Only allow known setting keys
      const knownKeys = ["rag_top_k", "rag_temperature", "rag_max_context_chars", "embedding_model", "chroma_collection"];
      const stringUpdates: Record<string, string> = {};
      for (const key of knownKeys) {
        if (updates[key] !== undefined) {
          stringUpdates[key] = String(updates[key]);
        }
      }

      // Validate values before persisting
      if (stringUpdates.rag_top_k !== undefined) {
        const v = Number(stringUpdates.rag_top_k);
        if (!Number.isInteger(v) || v < 1 || v > 50) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "rag_top_k 必须是 1-50 的整数。", 400);
        }
      }
      if (stringUpdates.rag_temperature !== undefined) {
        const v = Number(stringUpdates.rag_temperature);
        if (!Number.isFinite(v) || v < 0 || v > 1) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "rag_temperature 必须在 0-1 之间。", 400);
        }
      }
      if (stringUpdates.rag_max_context_chars !== undefined) {
        const v = Number(stringUpdates.rag_max_context_chars);
        if (!Number.isInteger(v) || v < 1000 || v > 100000) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "rag_max_context_chars 必须是 1000-100000 的整数。", 400);
        }
      }

      setMultipleSettings(stringUpdates, req.user?.id);

      auditFromRequest(req, "settings.update", "settings", undefined, {
        keys: Object.keys(stringUpdates),
      });

      // Return updated settings
      const updatedSettings = getAllSettings();
      sendSuccess(res, updatedSettings, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/admin/audit-logs - list audit logs
router.get(
  "/admin/audit-logs",
  requirePermission("audit.read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { action, operator_id, resource_type, resource_id, page, page_size } = req.query;

      const result = listAuditLogs({
        action: action as string | undefined,
        operatorId: operator_id as string | undefined,
        resourceType: resource_type as string | undefined,
        resourceId: resource_id as string | undefined,
        page: page ? parseInt(page as string, 10) : 1,
        pageSize: page_size ? parseInt(page_size as string, 10) : 20,
      });

      sendPaginated(res, result.items, result.page, result.pageSize, result.total, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
