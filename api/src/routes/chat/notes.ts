import { Router, Request, Response, NextFunction } from "express";
import { sendSuccess } from "../../utils/response";
import { AppError, ErrorCodes } from "../../utils/errors";
import { createNote, formatNote, listNotes, listNotesBySession, NOTE_OWNERSHIP_CONTRACT, softDeleteNote, updateNote } from "../../db/chatNotes";
import { listMessagesBySession } from "../../db/chatMessages";
import { listMessageSourceDetails } from "../../db/messageSources";
import { listComments } from "../../db/docComments";
import { compactDiagramText, currentUser, isRecord, normalizeNoteTarget, requireReadableSession } from "./shared";

const router = Router();

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

// GET /api/chat/notes/aggregate - group notes, source comments and answer risks by assistant answer
router.get("/chat/notes/aggregate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = typeof req.query.session_id === "string" ? req.query.session_id.trim() : "";
    if (!sessionId) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "必须指定 session_id。", 400);
    }
    requireReadableSession(req, sessionId);

    const user = currentUser(req);
    const notes = listNotesBySession(sessionId, user.id).map(formatNote);
    const messages = listMessagesBySession(sessionId);
    const items = messages
      .map((message, index) => {
        if (message.role !== "assistant") return null;
        const metadata = JSON.parse(message.metadata_json || "{}") as Record<string, unknown>;
        const confidence = typeof metadata.confidence === "number" ? metadata.confidence : 0;
        const previousQuestion = [...messages.slice(0, index)].reverse().find((item) => item.role === "user")?.content ?? "";
        const messageNotes = notes.filter((note) => note.scope === "message" && note.message_id === message.id);
        const sourceDetails = listMessageSourceDetails(message.id);
        const sources = sourceDetails.map((source) => {
          const sourceNotes = notes.filter((note) =>
            note.scope === "source" &&
            note.message_id === message.id &&
            (note.source_id === source.id || note.chunk_id === source.chunk_id)
          );
          const comments = source.document_id ? listComments(source.document_id, source.chunk_id).map((comment) => ({
            id: comment.id,
            user_name: comment.user_name,
            content: comment.content,
            parent_id: comment.parent_id,
            created_at: comment.created_at,
            updated_at: comment.updated_at,
          })) : [];
          return {
            id: source.id,
            chunk_id: source.chunk_id,
            document_id: source.document_id,
            document_title: source.document_title,
            section_path: source.section_path,
            score: source.score,
            snippet: source.snippet,
            notes: sourceNotes,
            comments,
          };
        });
        const answerIrSummary = isRecord(metadata.answer_ir_summary) ? metadata.answer_ir_summary : {};
        const visualPlan = isRecord(metadata.visual_plan) ? metadata.visual_plan : {};
        const answerWarnings = Array.isArray(answerIrSummary.warnings) ? answerIrSummary.warnings : [];
        const visualWarnings = Array.isArray(visualPlan.warnings) ? visualPlan.warnings : [];
        const risks = [
          ...(confidence > 0 && confidence < 0.6 ? [{ code: "low_confidence", message: `回答可信度 ${Math.round(confidence * 100)}%，建议核对原文。` }] : []),
          ...answerWarnings,
          ...visualWarnings,
        ];

        return {
          message_id: message.id,
          question: previousQuestion,
          answer_preview: compactDiagramText(message.content, 180),
          confidence,
          notes: messageNotes,
          sources,
          risks,
          manual_note_count: messageNotes.length + sources.reduce((total, source) => total + source.notes.length, 0),
          source_comment_count: sources.reduce((total, source) => total + source.comments.length, 0),
          created_at: message.created_at,
        };
      })
      .filter(Boolean);

    sendSuccess(res, {
      session_notes: notes.filter((note) => note.scope === "session"),
      items,
    }, req.requestId);
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

export default router;
