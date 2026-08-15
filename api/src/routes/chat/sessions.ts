import { Router, Request, Response, NextFunction } from "express";
import { sendSuccess } from "../../utils/response";
import { AppError, ErrorCodes } from "../../utils/errors";
import { createSession, getSessionById, listSessions, updateSession } from "../../db/chatSessions";
import { formatMessage, listMessagesBySession } from "../../db/chatMessages";
import { getDb } from "../../db/index";
import { canReadSession } from "./shared";

const router = Router();

// POST /api/chat/sessions - create a new session
router.post("/chat/sessions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title } = req.body;
    const userId = req.user?.id || "anonymous";

    const session = createSession(userId, title || "新对话");

    sendSuccess(
      res,
      {
        id: session.id,
        title: session.title,
        created_at: session.created_at,
      },
      req.requestId
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/sessions - list sessions
router.get("/chat/sessions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id || "anonymous";
    const sessions = listSessions(userId);

    const items = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      pinned: Boolean(s.pinned),
      updated_at: s.updated_at,
      created_at: s.created_at,
    }));

    sendSuccess(res, { items }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/sessions/:id - session with messages
router.get("/chat/sessions/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const session = getSessionById(sessionId);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    if (!canReadSession(req, session.user_id)) {
      throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权访问该会话。", 403);
    }

    const messages = listMessagesBySession(sessionId).map(formatMessage);

    sendSuccess(
      res,
      {
        id: session.id,
        title: session.title,
        pinned: Boolean(session.pinned),
        messages,
        created_at: session.created_at,
        updated_at: session.updated_at,
      },
      req.requestId
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/sessions/:id/messages - messages for a session
router.get("/chat/sessions/:id/messages", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const session = getSessionById(sessionId);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    if (!canReadSession(req, session.user_id)) {
      throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权访问该会话。", 403);
    }

    const messages = listMessagesBySession(sessionId).map(formatMessage);

    sendSuccess(res, { items: messages }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/chat/sessions/:id - update session (title, pinned)
router.patch("/chat/sessions/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const session = getSessionById(sessionId);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    if (!canReadSession(req, session.user_id)) {
      throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权访问该会话。", 403);
    }

    const { title, pinned } = req.body;
    const updates: { title?: string; pinned?: number } = {};
    if (title !== undefined) updates.title = title;
    if (pinned !== undefined) updates.pinned = pinned ? 1 : 0;

    const updated = updateSession(sessionId, updates);
    sendSuccess(res, updated, req.requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/sessions/:id - delete session
router.delete("/chat/sessions/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const session = getSessionById(sessionId);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    if (!canReadSession(req, session.user_id)) {
      throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权访问该会话。", 403);
    }

    const db = getDb();
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);

    sendSuccess(res, { deleted: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
