import { Router, Request, Response, NextFunction } from "express";
import { sendSuccess } from "../../utils/response";
import { AppError, ErrorCodes } from "../../utils/errors";
import { getSessionById } from "../../db/chatSessions";
import { getMessageById } from "../../db/chatMessages";
import { getMessageSourceDetail, listMessageSourceDetails } from "../../db/messageSources";
import { canReadSession } from "./shared";

const router = Router();

// GET /api/chat/messages/:id/sources - list source details for one assistant message
router.get("/chat/messages/:id/sources", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messageId = req.params.id as string;
    const existing = getMessageById(messageId);
    if (!existing) {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
    }

    const session = getSessionById(existing.session_id);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    if (!canReadSession(req, session.user_id)) {
      throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权限查看该消息引用。", 403);
    }
    if (existing.role !== "assistant") {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "只有回答消息包含引用详情。", 400);
    }

    sendSuccess(res, { items: listMessageSourceDetails(messageId) }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/messages/:id/sources/:sourceId - read-only source detail
router.get("/chat/messages/:id/sources/:sourceId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messageId = req.params.id as string;
    const sourceId = req.params.sourceId as string;
    const existing = getMessageById(messageId);
    if (!existing) {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
    }

    const session = getSessionById(existing.session_id);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    if (!canReadSession(req, session.user_id)) {
      throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权限查看该消息引用。", 403);
    }
    if (existing.role !== "assistant") {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "只有回答消息包含引用详情。", 400);
    }

    const source = getMessageSourceDetail(messageId, sourceId);
    if (!source) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "引用来源不存在。", 404);
    }

    sendSuccess(res, source, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
