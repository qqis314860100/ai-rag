import { Router, Request, Response, NextFunction } from "express";
import { getAllSettings, getAllSettingsFlat, setMultipleSettings } from "../db/settings";
import { listAuditLogs } from "../db/auditLogs";
import { sendSuccess, sendPaginated } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";
import { requirePermission } from "../middleware/auth";
import { auditFromRequest } from "../services/auditService";

const router = Router();

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

      // Convert all values to strings for storage
      const stringUpdates: Record<string, string> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          stringUpdates[key] = String(value);
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
