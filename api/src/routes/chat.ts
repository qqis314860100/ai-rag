import { Router, Request, Response, NextFunction } from "express";
import { chatWithRag, chatWithRagStream, generateDiagramIR } from "../services/ragClient";
import { sendSuccess } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";
import { getSecurityLevelsForRequest } from "../middleware/auth";
import { auditFromRequest } from "../services/auditService";
import { listSessions, getSessionById, createSession, updateSession } from "../db/chatSessions";
import { listMessagesBySession, createMessage, formatMessage, deleteMessageAndTruncateSession, getMessageById, updateMessageAndTruncateSession } from "../db/chatMessages";
import { getMessageSourceDetail, listMessageSourceDetails } from "../db/messageSources";
import { NOTE_OWNERSHIP_CONTRACT, createNote, formatNote, isNoteScope, listNotes, softDeleteNote, updateNote } from "../db/chatNotes";
import type { NoteTarget } from "../db/chatNotes";
import { createArtifact, formatArtifact, getArtifactById, listArtifactsByMessage, softDeleteArtifact, updateArtifact } from "../db/chatArtifacts";
import { getDb } from "../db/index";

const router = Router();

function canReadSession(req: Request, sessionUserId: string): boolean {
  const userId = req.user?.id || "anonymous";
  const isOwner = sessionUserId === userId;
  const isAdmin = req.user?.role === "system_admin" || req.user?.role === "knowledge_admin";
  return isOwner || isAdmin;
}

function canManageSession(req: Request, sessionUserId: string): boolean {
  return canReadSession(req, sessionUserId);
}

function currentUser(req: Request): { id: string; name: string } {
  return {
    id: req.user?.id || "anonymous",
    name: req.user?.name || "匿名",
  };
}

function compactDiagramText(value: unknown, maxLength = 600): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildDiagramContent(answer: string, sources: Array<Record<string, unknown>>): string {
  const blocks = [`回答正文：\n${answer}`];
  sources.slice(0, 8).forEach((source, index) => {
    const title = compactDiagramText(source.document_title, 120);
    const section = compactDiagramText(source.section_path, 160);
    const snippet = compactDiagramText(source.content || source.snippet, 700);
    blocks.push(
      [
        `[引用 ${index + 1}]`,
        `文档：${title || "未知文档"}`,
        `章节：${section || "未标注章节"}`,
        `片段：${snippet || "暂无片段"}`,
      ].join("\n")
    );
  });
  return blocks.join("\n\n");
}

function normalizeDiagramType(value: unknown): "mindmap" | "flowchart" {
  const rawDiagramType = typeof value === "string" ? value : "mindmap";
  if (rawDiagramType !== "mindmap" && rawDiagramType !== "flowchart") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "diagram_type 必须是 mindmap 或 flowchart。", 400);
  }
  return rawDiagramType;
}

function artifactRenderer(payload: { metadata?: Record<string, unknown> }): string {
  const renderer = payload.metadata?.renderer;
  return typeof renderer === "string" && renderer.trim() ? renderer : "diagram-ir";
}

function artifactSummary(payload: { nodes?: unknown[]; edges?: unknown[] }): string {
  const nodeCount = Array.isArray(payload.nodes) ? payload.nodes.length : 0;
  const edgeCount = Array.isArray(payload.edges) ? payload.edges.length : 0;
  return `${nodeCount} 个节点，${edgeCount} 条连线`;
}

function requireReadableAssistantMessage(req: Request, messageId: string, action: string) {
  const existing = getMessageById(messageId);
  if (!existing) {
    throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
  }

  const session = getSessionById(existing.session_id);
  if (!session) {
    throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
  }
  if (!canReadSession(req, session.user_id)) {
    throw new AppError(ErrorCodes.FORBIDDEN, `当前用户无权限${action}该回答。`, 403);
  }
  if (existing.role !== "assistant") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "只能处理回答消息。", 400);
  }

  return { existing, session };
}

async function buildDiagramForMessage(
  req: Request,
  messageId: string,
  diagramType: "mindmap" | "flowchart",
  titleInput?: unknown
) {
  const { existing, session } = requireReadableAssistantMessage(req, messageId, "整理");
  const formatted = formatMessage(existing) as { sources?: Array<Record<string, unknown>>; confidence?: number };
  const sourceIds = (formatted.sources || [])
    .map((source) => source.chunk_id)
    .filter((chunkId): chunkId is string => typeof chunkId === "string" && chunkId.length > 0);

  const title = typeof titleInput === "string" && titleInput.trim()
    ? titleInput.trim()
    : session.title || "AI 整理";
  const diagram = await generateDiagramIR(
    title,
    buildDiagramContent(existing.content, formatted.sources || []),
    diagramType,
    sourceIds,
    req.requestId
  );

  return { diagram, existing, sourceIds, title, confidence: formatted.confidence ?? 0 };
}

async function generateDiagramArtifact(
  req: Request,
  messageId: string,
  diagramType: "mindmap" | "flowchart",
  titleInput?: unknown
) {
  const { diagram, existing, sourceIds, title, confidence } = await buildDiagramForMessage(
    req,
    messageId,
    diagramType,
    titleInput
  );

  const artifact = createArtifact({
    sessionId: existing.session_id,
    messageId,
    type: diagramType,
    renderer: artifactRenderer(diagram),
    title,
    summary: artifactSummary(diagram),
    reason: "基于回答正文和引用证据生成结构化图解。",
    confidence,
    payload: diagram,
    sourceIds,
    metadata: {
      diagram_type: diagramType,
      objective: diagram.objective,
      layout_hint: diagram.layout_hint,
    },
  });

  auditFromRequest(req, "chat.artifact.generate", "chat_message", messageId, {
    session_id: existing.session_id,
    artifact_id: artifact.id,
    artifact_type: diagramType,
    node_count: diagram.nodes.length,
    edge_count: diagram.edges.length,
    source_count: sourceIds.length,
  });

  return { diagram, artifact, sourceIds, existing };
}

function requireReadableSession(req: Request, sessionId: string): ReturnType<typeof getSessionById> {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
  }
  if (!canReadSession(req, session.user_id)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权限访问该会话。", 403);
  }
  return session;
}

function requireUserMessageMutationPermission(
  req: Request,
  sessionUserId: string,
  existingRole: string,
  action: "编辑" | "删除"
): void {
  if (!canManageSession(req, sessionUserId)) {
    throw new AppError(ErrorCodes.FORBIDDEN, `当前用户无权限${action}该消息。`, 403);
  }
  if (existingRole !== "user") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `只能${action}用户消息。`, 400);
  }
}

function normalizeNoteTarget(req: Request, input: Record<string, unknown>): NoteTarget {
  const scope = input.scope;
  if (!isNoteScope(scope)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "笔记 scope 必须是 session、message 或 source。", 400);
  }

  const sessionId = typeof input.session_id === "string" ? input.session_id.trim() : "";
  if (!sessionId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "笔记必须指定 session_id。", 400);
  }
  requireReadableSession(req, sessionId);

  if (scope === "session") {
    return { scope, sessionId };
  }

  const messageId = typeof input.message_id === "string" ? input.message_id.trim() : "";
  if (!messageId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "回答或引用笔记必须指定 message_id。", 400);
  }

  const message = getMessageById(messageId);
  if (!message) {
    throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
  }
  if (message.session_id !== sessionId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "message_id 不属于指定会话。", 400);
  }
  if (message.role !== "assistant") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "回答笔记只能关联 assistant 消息。", 400);
  }

  if (scope === "message") {
    return { scope, sessionId, messageId };
  }

  const sourceId = typeof input.source_id === "string" ? input.source_id.trim() : "";
  if (!sourceId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "引用笔记必须指定 source_id。", 400);
  }

  const source = getMessageSourceDetail(messageId, sourceId);
  if (!source) {
    throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "引用来源不存在。", 404);
  }

  return {
    scope,
    sessionId,
    messageId,
    sourceId: source.id,
    documentId: source.document_id,
    chunkId: source.chunk_id,
  };
}

// POST /api/chat - send a message and get RAG answer
router.post("/chat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { session_id, message, top_k, filters, stream } = req.body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "消息内容不能为空。", 400);
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

    // Streaming mode
    if (stream) {
      const ragStream = await chatWithRagStream(
        message,
        allowedSecurityLevels,
        top_k ?? 5,
        filters ?? {},
        history,
        req.requestId
      );

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      let fullAnswer = "";
      let meta: {
        sources?: unknown[];
        confidence?: number;
        followups?: string[];
        trace?: { retrieval_ms?: number; hit_count?: number };
      } = {};
      let streamFailed = false;

      const reader = ragStream.body?.getReader();
      if (!reader) {
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
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
                  };
                } else if (parsed.type === "error") {
                  streamFailed = true;
                }
              } catch {
                // ignore parse errors
              }
              res.write(`${line}\n\n`);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Save assistant message after stream completes
      if (streamFailed) {
        res.end();
        return;
      }

      const assistantMessage = createMessage({
        sessionId,
        role: "assistant",
        content: fullAnswer,
        sources: meta.sources as Array<Record<string, unknown>> | undefined,
        metadata: {
          confidence: meta.confidence,
          followups: meta.followups,
          trace: meta.trace,
        },
        latencyMs: 0,
      });

      // Update session title from first message
      if (history.length === 0) {
        updateSession(sessionId, { title: message.substring(0, 50) });
      }

      auditFromRequest(req, "chat.send", "chat_message", assistantMessage.id, {
        session_id: sessionId,
        query: message.substring(0, 200),
        answer_length: fullAnswer.length,
        source_count: meta.sources?.length ?? 0,
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
      top_k ?? 5,
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
    if (history.length === 0) {
      updateSession(sessionId, { title: message.substring(0, 50) });
    }

    auditFromRequest(req, "chat.send", "chat_message", assistantMessage.id, {
      session_id: sessionId,
      query: message.substring(0, 200),
      answer_length: chatResult.answer.length,
      source_count: chatResult.sources.length,
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

    const messages = listMessagesBySession(sessionId).map(formatMessage);

    sendSuccess(res, { items: messages }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/notes/contract - note ownership and API contract
router.get("/chat/notes/contract", async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res,
      {
        version: "2026-05-24",
        ...NOTE_OWNERSHIP_CONTRACT,
        endpoints: {
          list: "GET /api/chat/notes?scope=session|message|source&session_id=...&message_id=...&source_id=...",
          create: "POST /api/chat/notes",
          update: "PATCH /api/chat/notes/:id",
          delete: "DELETE /api/chat/notes/:id",
        },
      },
      req.requestId
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/notes - list current user's notes for one target
router.get("/chat/notes", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const target = normalizeNoteTarget(req, req.query as Record<string, unknown>);
    const user = currentUser(req);
    const items = listNotes(target, user.id).map(formatNote);
    sendSuccess(res, { items }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/notes - create a personal note for session/message/source
router.post("/chat/notes", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content, metadata } = req.body;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "笔记内容不能为空。", 400);
    }

    const target = normalizeNoteTarget(req, req.body as Record<string, unknown>);
    const user = currentUser(req);
    const note = createNote({
      ...target,
      userId: user.id,
      userName: user.name,
      content: content.trim(),
      metadata: metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {},
    });

    sendSuccess(res, formatNote(note), req.requestId);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/chat/notes/:id - update current user's note
router.patch("/chat/notes/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "笔记内容不能为空。", 400);
    }

    const user = currentUser(req);
    const updated = updateNote(req.params.id as string, user.id, content.trim());
    if (!updated) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "笔记不存在或无权编辑。", 404);
    }

    sendSuccess(res, formatNote(updated), req.requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/notes/:id - soft-delete current user's note
router.delete("/chat/notes/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = currentUser(req);
    const deleted = softDeleteNote(req.params.id as string, user.id);
    if (!deleted) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "笔记不存在或无权删除。", 404);
    }

    sendSuccess(res, { deleted: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

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

// POST /api/chat/messages/:id/diagram - generate Diagram IR for one assistant answer
router.post("/chat/messages/:id/diagram", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messageId = req.params.id as string;
    const rawDiagramType = normalizeDiagramType(req.body?.diagram_type);
    const { diagram, existing, sourceIds } = await generateDiagramArtifact(req, messageId, rawDiagramType, req.body?.title);

    auditFromRequest(req, "chat.diagram.generate", "chat_message", messageId, {
      session_id: existing.session_id,
      diagram_type: rawDiagramType,
      node_count: diagram.nodes.length,
      edge_count: diagram.edges.length,
      source_count: sourceIds.length,
    });

    sendSuccess(res, diagram, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/messages/:id/artifacts - 查询某条回答已持久化的产物
router.get("/chat/messages/:id/artifacts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messageId = req.params.id as string;
    requireReadableAssistantMessage(req, messageId, "查看");
    const artifacts = listArtifactsByMessage(messageId).map(formatArtifact);
    sendSuccess(res, { items: artifacts }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/messages/:id/artifacts/generate - 为某条回答生成并保存产物
router.post("/chat/messages/:id/artifacts/generate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messageId = req.params.id as string;
    const diagramType = normalizeDiagramType(req.body?.diagram_type ?? req.body?.type);
    const { artifact } = await generateDiagramArtifact(req, messageId, diagramType, req.body?.title);
    sendSuccess(res, formatArtifact(artifact), req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/artifacts/:id/regenerate - 重新生成已有产物内容
router.post("/chat/artifacts/:id/regenerate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const artifactId = req.params.id as string;
    const artifact = getArtifactById(artifactId);
    if (!artifact || artifact.status === "deleted") {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "Artifact 不存在。", 404);
    }

    requireReadableAssistantMessage(req, artifact.message_id, "重新生成");
    const diagramType = normalizeDiagramType(req.body?.diagram_type ?? artifact.type);
    const { diagram, sourceIds } = await buildDiagramForMessage(req, artifact.message_id, diagramType, req.body?.title ?? artifact.title);
    const updated = updateArtifact(artifactId, {
      type: diagramType,
      renderer: artifactRenderer(diagram),
      title: typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : artifact.title,
      summary: artifactSummary(diagram),
      reason: "重新生成结构化图解。",
      status: "ready",
      payload: diagram,
      sourceIds,
      metadata: {
        ...JSON.parse(artifact.metadata_json || "{}"),
        diagram_type: diagramType,
        objective: diagram.objective,
        layout_hint: diagram.layout_hint,
        regenerated_from: artifactId,
      },
    });

    auditFromRequest(req, "chat.artifact.regenerate", "chat_artifact", artifactId, {
      message_id: artifact.message_id,
      artifact_type: diagramType,
    });

    sendSuccess(res, formatArtifact(updated!), req.requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/artifacts/:id - 软删除单个产物
router.delete("/chat/artifacts/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const artifactId = req.params.id as string;
    const artifact = getArtifactById(artifactId);
    if (!artifact || artifact.status === "deleted") {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "Artifact 不存在。", 404);
    }

    requireReadableAssistantMessage(req, artifact.message_id, "删除");
    softDeleteArtifact(artifactId);

    auditFromRequest(req, "chat.artifact.delete", "chat_artifact", artifactId, {
      message_id: artifact.message_id,
      artifact_type: artifact.type,
    });

    sendSuccess(res, { deleted: true }, req.requestId);
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

    sendSuccess(res, { deleted: true }, req.requestId);
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

    const db = getDb();
    db.prepare("DELETE FROM chat_messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);

    sendSuccess(res, { deleted: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
