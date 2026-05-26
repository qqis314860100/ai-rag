import { Router, Request, Response, NextFunction } from "express";
import { createIntegrationToken, listIntegrationTokens, revokeIntegrationToken } from "../db/integrationTokens";
import { requirePermission } from "../middleware/auth";
import { auditFromRequest } from "../services/auditService";
import { sendSuccess } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";

const router = Router();

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function securityLevels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

router.get(
  "/integration/tokens",
  requirePermission("settings.update"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendSuccess(res, { items: listIntegrationTokens() }, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/integration/tokens",
  requirePermission("settings.update"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientId = cleanText(req.body.client_id);
      if (!clientId) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "client_id 不能为空。", 400);
      }
      const token = createIntegrationToken({
        clientId,
        allowedSecurityLevels: securityLevels(req.body.allowed_security_levels),
        createdBy: req.user?.id,
      });
      auditFromRequest(req, "integration_token.create", "integration_api_token", token.id, {
        client_id: token.client_id,
        allowed_security_levels: token.allowed_security_levels,
      });
      sendSuccess(res, token, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/integration/tokens/:id/revoke",
  requirePermission("settings.update"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = revokeIntegrationToken(String(req.params.id), req.user?.id);
      if (!token) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "集成 API Token 不存在。", 404);
      }
      auditFromRequest(req, "integration_token.revoke", "integration_api_token", token.id, {
        client_id: token.client_id,
      });
      sendSuccess(res, token, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

