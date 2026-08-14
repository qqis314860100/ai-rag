import { Router, Request, Response, NextFunction } from "express";
import { addFavorite, getFavoriteMessageIds, listFavorites, removeFavorite } from "../db/favorites";
import { getMessageById } from "../db/chatMessages";
import { auditFromRequest } from "../services/auditService";
import { AppError, ErrorCodes } from "../utils/errors";
import { requireAuth } from "../middleware/jwtAuth";
import { sendSuccess } from "../utils/response";

const router = Router();

// GET /api/favorites - list current user's saved answers
router.get("/favorites", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id || "anonymous";
    sendSuccess(res, { items: listFavorites(userId) }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/favorites/status?message_ids=id1,id2 - check saved answers in a thread
router.get("/favorites/status", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id || "anonymous";
    const messageIds = ((req.query.message_ids as string) || "").split(",").filter(Boolean);
    const savedIds = getFavoriteMessageIds(userId, messageIds);
    const status = Object.fromEntries(messageIds.map((id) => [id, savedIds.includes(id)]));

    sendSuccess(res, status, req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/favorites - save an assistant answer
router.post("/favorites", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message_id } = req.body;
    if (!message_id || typeof message_id !== "string") {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "缺少 message_id。", 400);
    }

    const message = getMessageById(message_id);
    if (!message || message.role !== "assistant") {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "回答消息不存在。", 404);
    }

    const userId = req.user?.id || "anonymous";
    const favorite = addFavorite(userId, message_id);

    auditFromRequest(req, "favorite.create", "chat_message", message_id, {
      session_id: message.session_id,
    });

    sendSuccess(res, favorite, req.requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/favorites/:messageId - remove a saved answer
router.delete("/favorites/:messageId", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id || "anonymous";
    const messageId = req.params.messageId as string;
    const deleted = removeFavorite(userId, messageId);

    auditFromRequest(req, "favorite.delete", "chat_message", messageId, {
      deleted,
    });

    sendSuccess(res, { deleted }, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
