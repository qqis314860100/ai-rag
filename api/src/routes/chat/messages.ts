import { Router, Request, Response, NextFunction } from "express";
import { chatWithRag, chatWithRagStream } from "../../services/ragClient";
import type { RagAnswerIR, RagAnswerQueryRewrite, RagVisualPlan } from "../../services/ragClient";
import { sendSuccess } from "../../utils/response";
import { AppError, ErrorCodes } from "../../utils/errors";
import { getSecurityLevelsForRequest } from "../../middleware/auth";
import { auditFromRequest } from "../../services/auditService";
import { createSession, getSessionById, updateSession } from "../../db/chatSessions";
import { createMessage, deleteMessageAndTruncateSession, formatMessage, getMessageById, listMessagesBySession, updateMessageAndTruncateSession } from "../../db/chatMessages";
import { buildPublishedKnowledgeAssetContext } from "../../services/knowledgeAssetContextService";
import { recordFailureSignalFromAssistantMessage } from "../../services/knowledgeFailureSignalService";
import { recordChatMetric } from "../../services/metricsService";
import { buildAnswerMessageMetadata, canReadSession, createAutoArtifactsFromVisualPlan, requireUserMessageMutationPermission } from "./shared";
import { buildAnswerVerificationAuditDetail } from "./answerMetadata";

const router = Router();

function isRefusalAnswer(answer: string, answerIr?: RagAnswerIR | null): boolean {
  return answerIr?.status === "insufficient_context" || /^(根据当前知识库信息|抱歉)/.test(answer.trim());
}

function auditAnswerVerification(req: Request, sessionId: string, messageId: string, metadata: Record<string, unknown>): void {
  const answerVerification = buildAnswerVerificationAuditDetail(metadata);
  if (!answerVerification) return;

  auditFromRequest(req, "chat.answer.verify", "chat_message", messageId, {
    session_id: sessionId,
    answer_verification: answerVerification,
  });
}

// POST /api/chat - send a message and get RAG answer
router.post("/chat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { session_id, message, top_k, filters, stream } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "消息内容不能为空。", 400);
    }
    if (message.trim().length > 20000) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "消息内容过长（上限 20000 字符）。", 400);
    }
    const topK = top_k === undefined ? 5 : Number(top_k);
    if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "top_k 必须是 1-20 的整数。", 400);
    }

    const userId = req.user?.id || "anonymous";

    // Get or create session
    let sessionId = session_id as string | undefined;
    if (!sessionId) {
      const newSession = createSession(userId, message.substring(0, 50));
      sessionId = newSession.id;
    } else {
      const session = getSessionById(sessionId);
      if (!session) {
        throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
      }
      if (!canReadSession(req, session.user_id)) {
        throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权访问该会话。", 403);
      }
    }

    // Save user message
    createMessage({
      sessionId,
      role: "user",
      content: message,
      metadata: { filters: filters ?? {} },
    });

    const allowedSecurityLevels = getSecurityLevelsForRequest(req);

    // Get chat history for context (last 10 messages)
    const history = listMessagesBySession(sessionId)
      .slice(-11, -1)
      .map((m) => ({ role: m.role, content: m.content }));
    const knowledgeAssets = buildPublishedKnowledgeAssetContext(message);

    // Streaming mode
    if (stream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
      const flushSse = (line: string) => {
        res.write(line);
        (res as Response & { flush?: () => void }).flush?.();
      };
      const writeSse = (payload: Record<string, unknown>) => {
        flushSse(`data: ${JSON.stringify(payload)}\n\n`);
      };
      writeSse({ type: "stage", stage: "accepted", message: "聊天请求已接收。" });

      // 客户端断开时中止上游 RAG 流，避免继续计费
      const abortController = new AbortController();
      let clientGone = false;
      req.on("close", () => {
        clientGone = true;
        abortController.abort();
      });

      let ragStream: Awaited<ReturnType<typeof chatWithRagStream>>;
      try {
        ragStream = await chatWithRagStream(
          message,
          allowedSecurityLevels,
          topK,
          filters ?? {},
          history,
          knowledgeAssets,
          req.requestId,
          req.user?.id,
          abortController.signal
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "RAG 服务连接失败。";
        writeSse({ type: "error", message });
        res.end();
        return;
      }

      if (!ragStream.ok) {
        const detail = await ragStream.text().catch(() => "");
        writeSse({ type: "error", message: `RAG 服务返回错误: ${ragStream.status}`, detail });
        res.end();
        return;
      }

      let fullAnswer = "";
      let meta: {
        sources?: unknown[];
        confidence?: number;
        followups?: string[];
        trace?: { retrieval_ms?: number; hit_count?: number };
        queryRewrite?: RagAnswerQueryRewrite;
        answerIr?: RagAnswerIR | null;
        visualPlan?: RagVisualPlan | null;
      } = {};
      let streamFailed = false;

      const reader = ragStream.body?.getReader();
      if (!reader) {
        writeSse({ type: "error", message: "RAG 流式响应不可读。" });
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          if (abortController.signal.aborted) {
            streamFailed = true;
            break;
          }
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
                } else if (parsed.type === "meta") {
                  meta = {
                    ...meta,
                    queryRewrite: parsed.query_rewrite,
                    trace: {
                      retrieval_ms: parsed.retrieval_ms,
                      hit_count: parsed.hit_count,
                    },
                  };
                } else if (parsed.type === "done") {
                  meta = {
                    ...meta,
                    sources: parsed.sources,
                    confidence: parsed.confidence,
                    followups: parsed.followups,
                    answerIr: parsed.answer_ir,
                    visualPlan: parsed.visual_plan,
                  };
                } else if (parsed.type === "error") {
                  streamFailed = true;
                }
              } catch {
                // ignore parse errors
              }
              flushSse(`${line}\n\n`);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Save assistant message after stream completes
      if (clientGone) {
        // 客户端已断开：不落库助手消息，用户消息保留用于上下文延续
        try { res.end(); } catch { /* socket already closed */ }
        return;
      }
      if (streamFailed || !fullAnswer.trim()) {
        if (!streamFailed) {
          writeSse({ type: "error", message: "回答生成失败，请重试。" });
        }
        res.end();
        return;
      }

      const assistantMetadata = buildAnswerMessageMetadata({
        originalQuestion: message,
        answerIr: meta.answerIr,
        queryRewrite: meta.queryRewrite,
        sources: meta.sources,
        confidence: meta.confidence,
        followups: meta.followups,
        trace: meta.trace,
        visualPlan: meta.visualPlan,
      });

      const assistantMessage = createMessage({
        sessionId,
        role: "assistant",
        content: fullAnswer,
        sources: meta.sources,
        metadata: assistantMetadata,
        latencyMs: 0,
      });
      recordFailureSignalFromAssistantMessage(assistantMessage, req.user?.id || "anonymous");

      // Update session title from first message
      if (history.length === 0) {
        updateSession(sessionId, { title: message.substring(0, 50) });
      }

      auditFromRequest(req, "chat.send", "chat_message", assistantMessage.id, {
        session_id: sessionId,
        query: message.substring(0, 200),
        answer_length: fullAnswer.length,
        source_count: meta.sources?.length ?? 0,
        answer_verification: buildAnswerVerificationAuditDetail(assistantMetadata),
      });
      auditAnswerVerification(req, sessionId, assistantMessage.id, assistantMetadata);
      recordChatMetric({
        sourceCount: meta.sources?.length ?? 0,
        llmCalled: (meta.trace?.retrieval_ms ?? 0) >= 0 && fullAnswer.length > 0 && !/^根据当前知识库信息/.test(fullAnswer),
        refused: isRefusalAnswer(fullAnswer, meta.answerIr),
      });

      // 流式体验优先：回答保存后立即结束 SSE，图解由用户在回答卡片下方手动触发，避免正文结束后等待自动产物生成。
      writeSse({ type: "saved", message_id: assistantMessage.id, session_id: sessionId, metadata: assistantMetadata, artifacts: [] });
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
      knowledgeAssets,
      req.requestId,
      req.user?.id
    );

    // Save assistant message
    const assistantMetadata = buildAnswerMessageMetadata({
      originalQuestion: message,
      answerIr: chatResult.answer_ir,
      sources: chatResult.sources,
      confidence: chatResult.confidence,
      followups: chatResult.followups,
      trace: chatResult.trace,
      visualPlan: chatResult.visual_plan,
    });

    const assistantMessage = createMessage({
      sessionId,
      role: "assistant",
      content: chatResult.answer,
      sources: chatResult.sources,
      metadata: assistantMetadata,
      latencyMs: chatResult.trace?.total_ms,
    });
    recordFailureSignalFromAssistantMessage(assistantMessage, req.user?.id || "anonymous");
    const autoArtifacts = await createAutoArtifactsFromVisualPlan(req, assistantMessage.id, chatResult.visual_plan);

    // Update session title from first message
    if (history.length === 0) {
      updateSession(sessionId, { title: message.substring(0, 50) });
    }

    auditFromRequest(req, "chat.send", "chat_message", assistantMessage.id, {
      session_id: sessionId,
      query: message.substring(0, 200),
      answer_length: chatResult.answer.length,
      source_count: chatResult.sources.length,
      answer_verification: buildAnswerVerificationAuditDetail(assistantMetadata),
    });
    auditAnswerVerification(req, sessionId, assistantMessage.id, assistantMetadata);
    recordChatMetric({
      sourceCount: chatResult.sources.length,
      llmCalled: (chatResult.trace?.llm_ms ?? 0) > 0,
      refused: isRefusalAnswer(chatResult.answer, chatResult.answer_ir),
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
        artifacts: autoArtifacts,
        metadata: assistantMetadata,
      },
      req.requestId
    );
  } catch (err) {
    next(err);
  }
});

// PATCH /api/chat/messages/:id - update a message and truncate later messages
router.patch("/chat/messages/:id", async (req: Request, res: Response, next: NextFunction) => {
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
    requireUserMessageMutationPermission(req, session.user_id, existing.role, "编辑");

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
router.delete("/chat/messages/:id", async (req: Request, res: Response, next: NextFunction) => {
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
    requireUserMessageMutationPermission(req, session.user_id, existing.role, "删除");

    const deleted = deleteMessageAndTruncateSession(messageId);
    if (!deleted) {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
    }

    auditFromRequest(req, "chat.message.delete", "chat_message", messageId, {
      session_id: existing.session_id,
      truncated_from_message_id: messageId,
      role: existing.role,
      content_preview: existing.content.slice(0, 120),
    });

    sendSuccess(res, { deleted: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
