import { Router, Request, Response, NextFunction } from "express";
import { chatWithRag, chatWithRagStream } from "../services/ragClient";
import { sendSuccess } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";
import { getSecurityLevelsForRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/jwtAuth";
import { auditFromRequest } from "../services/auditService";
import { listSessions, getSessionById, createSession, updateSession, ChatSessionRow } from "../db/chatSessions";
import { listMessagesBySession, createMessage, formatMessage, deleteMessageAndTruncateSession, getMessageById, updateMessageAndTruncateSession } from "../db/chatMessages";

const router = Router();

const MAX_MESSAGE_LENGTH = 20000;

function isAdminRole(role: string | undefined): boolean {
  return role === "system_admin" || role === "knowledge_admin";
}

/** Sessions are private: only the owner (or an admin) may access them. */
function assertSessionOwner(req: Request, session: ChatSessionRow): void {
  const isOwner = session.user_id === req.user?.id;
  if (!isOwner && !isAdminRole(req.user?.role)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权访问该会话。", 403);
  }
}

// POST /api/chat - send a message and get RAG answer
router.post("/chat", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { session_id, message, message_id, top_k, filters, stream } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "消息内容不能为空。", 400);
    }
    if (message.trim().length > MAX_MESSAGE_LENGTH) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, `消息内容过长（上限 ${MAX_MESSAGE_LENGTH} 字符）。`, 400);
    }
    const topK = top_k === undefined ? 5 : Number(top_k);
    if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "top_k 必须是 1-20 的整数。", 400);
    }

    const userId = req.user!.id;

    // Get or create session
    let sessionId = session_id as string | undefined;

    // Regeneration path: update an existing user message in place (edit + truncate),
    // then answer it — no duplicate user message is created.
    if (message_id) {
      const existing = getMessageById(message_id as string);
      if (!existing) {
        throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
      }
      const session = getSessionById(existing.session_id);
      if (!session) {
        throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
      }
      assertSessionOwner(req, session);
      updateMessageAndTruncateSession(existing.id, message.trim());
      sessionId = existing.session_id;
    } else {
      if (!sessionId) {
        const newSession = createSession(userId, message.substring(0, 50));
        sessionId = newSession.id;
      } else {
        const session = getSessionById(sessionId);
        if (!session) {
          throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
        }
        assertSessionOwner(req, session);
      }

      // Save user message
      createMessage({
        sessionId,
        role: "user",
        content: message,
        metadata: { filters: filters ?? {} },
      });
    }

    const allowedSecurityLevels = getSecurityLevelsForRequest(req);

    // Get chat history for context (last 10 messages, excluding the current one)
    const history = listMessagesBySession(sessionId)
      .slice(-11, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    // Streaming mode
    if (stream) {
      let fullAnswer = "";
      let meta: { sources?: unknown[]; confidence?: number; followups?: string[]; trace?: unknown } = {};
      let streamFailed = false;
      let clientGone = false;

      // Abort the upstream RAG stream as soon as the client disconnects,
      // so we stop paying for LLM tokens nobody will see.
      const abortController = new AbortController();
      req.on("close", () => {
        clientGone = true;
        abortController.abort();
      });

      const ragStream = await chatWithRagStream(
        message,
        allowedSecurityLevels,
        topK,
        filters ?? {},
        history,
        req.requestId,
        abortController.signal
      );

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const reader = ragStream.body?.getReader();
      if (!reader) {
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          // Aborting the upstream fetch (via abortController) rejects this read
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "token") {
                  fullAnswer += parsed.content;
                } else if (parsed.type === "done") {
                  meta = {
                    sources: parsed.sources,
                    confidence: parsed.confidence,
                    followups: parsed.followups,
                  };
                } else if (parsed.type === "error") {
                  streamFailed = true;
                }
              } catch {
                // ignore parse errors
              }
              if (!clientGone) {
                res.write(`${line}\n\n`);
              }
            }
          }
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          streamFailed = true; // client disconnected or upstream aborted — nothing to save
        } else {
          streamFailed = true;
          if (!clientGone) {
            res.write(`data: ${JSON.stringify({ type: "error", message: "生成过程中发生错误，请重试。" })}\n\n`);
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (clientGone) {
        // Client left mid-stream: no assistant message to persist reliably;
        // the user message stays for context continuity.
        try { res.end(); } catch { /* socket already closed */ }
        return;
      }

      if (streamFailed) {
        res.write(`data: ${JSON.stringify({ type: "error", message: "生成失败，请稍后重试。" })}\n\n`);
        res.end();
        return;
      }

      // Save assistant message after stream completes
      const assistantMessage = createMessage({
        sessionId,
        role: "assistant",
        content: fullAnswer,
        sources: meta.sources as Array<Record<string, unknown>> | undefined,
        metadata: {
          confidence: meta.confidence,
          followups: meta.followups,
        },
        latencyMs: 0,
      });

      // Update session title from first message
      if (history.length === 0 && !message_id) {
        updateSession(sessionId, { title: message.substring(0, 50) });
      }

      auditFromRequest(req, "chat.send", "chat_message", assistantMessage.id, {
        session_id: sessionId,
        query: message.substring(0, 200),
        answer_length: fullAnswer.length,
        source_count: meta.sources?.length ?? 0,
        regenerated: Boolean(message_id),
      });

      // Send final event with message_id and session_id
      res.write(`data: ${JSON.stringify({ type: "saved", message_id: assistantMessage.id, session_id: sessionId })}\n\n`);
      res.end();
      return;
    }

    // Non-streaming mode
    const chatResult = await chatWithRag(
      message,
      allowedSecurityLevels,
      topK,
      filters ?? {},
      history,
      req.requestId
    );

    // Save assistant message
    const assistantMessage = createMessage({
      sessionId,
      role: "assistant",
      content: chatResult.answer,
      sources: chatResult.sources,
      metadata: {
        confidence: chatResult.confidence,
        followups: chatResult.followups,
        trace: chatResult.trace,
      },
      latencyMs: chatResult.trace?.total_ms,
    });

    // Update session title from first message
    if (history.length === 0 && !message_id) {
      updateSession(sessionId, { title: message.substring(0, 50) });
    }

    auditFromRequest(req, "chat.send", "chat_message", assistantMessage.id, {
      session_id: sessionId,
      query: message.substring(0, 200),
      answer_length: chatResult.answer.length,
      source_count: chatResult.sources.length,
      regenerated: Boolean(message_id),
    });

    sendSuccess(
      res,
      {
        session_id: sessionId,
        message_id: assistantMessage.id,
        answer: chatResult.answer,
        sources: chatResult.sources,
        confidence: chatResult.confidence,
        followups: chatResult.followups,
        trace: chatResult.trace,
      },
      req.requestId
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/sessions - create a new session
router.post("/chat/sessions", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title } = req.body;
    const userId = req.user!.id;

    const session = createSession(userId, (title as string | undefined)?.substring(0, 100) || "新对话");

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
router.get("/chat/sessions", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
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
router.get("/chat/sessions/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const session = getSessionById(sessionId);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    assertSessionOwner(req, session);

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
router.get("/chat/sessions/:id/messages", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const session = getSessionById(sessionId);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    assertSessionOwner(req, session);

    const messages = listMessagesBySession(sessionId).map(formatMessage);

    sendSuccess(res, { items: messages }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/chat/messages/:id - update a message and truncate later messages
router.patch("/chat/messages/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messageId = req.params.id as string;
    const { content } = req.body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "消息内容不能为空。", 400);
    }

    const existing = getMessageById(messageId);
    if (!existing) {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
    }

    const session = getSessionById(existing.session_id);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    assertSessionOwner(req, session);

    const updated = updateMessageAndTruncateSession(messageId, content.trim());
    if (!updated) {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
    }

    sendSuccess(res, { message: formatMessage(updated) }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/messages/:id - delete a message and truncate later messages
router.delete("/chat/messages/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
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
    assertSessionOwner(req, session);

    const deleted = deleteMessageAndTruncateSession(messageId);
    if (!deleted) {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
    }

    sendSuccess(res, { deleted: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/chat/sessions/:id - update session (title, pinned)
router.patch("/chat/sessions/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const session = getSessionById(sessionId);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    assertSessionOwner(req, session);

    const { title, pinned } = req.body;
    const updates: { title?: string; pinned?: number } = {};
    if (title !== undefined) updates.title = String(title).substring(0, 100);
    if (pinned !== undefined) updates.pinned = pinned ? 1 : 0;

    const updated = updateSession(sessionId, updates);
    sendSuccess(res, updated, req.requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/sessions/:id - delete session
router.delete("/chat/sessions/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const session = getSessionById(sessionId);
    if (!session) {
      throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
    }
    assertSessionOwner(req, session);

    const db = (await import("../db/index")).getDb();
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);

    sendSuccess(res, { deleted: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
