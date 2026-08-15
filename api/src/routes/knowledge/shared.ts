import { Request, Response } from "express";
import { getMessageById } from "../../db/chatMessages";
import { getSessionById } from "../../db/chatSessions";
import type { TerminologySourceRef } from "../../db/terminology";
import { createAsyncJob, formatAsyncJob } from "../../services/asyncJobService";
import { AppError, ErrorCodes } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

function canReadSession(req: Request, sessionUserId: string): boolean {
  const userId = req.user?.id || "anonymous";
  const isOwner = sessionUserId === userId;
  const isAdmin = req.user?.role === "system_admin" || req.user?.role === "knowledge_admin";
  return isOwner || isAdmin;
}

export function currentUser(req: Request): { id: string; name: string } {
  return {
    id: req.user?.id || "anonymous",
    name: req.user?.name || "匿名",
  };
}

export function sendQueuedJob(res: Response, job: ReturnType<typeof createAsyncJob>, requestId?: string): void {
  res.status(202);
  sendSuccess(res, {
    job: formatAsyncJob(job),
    poll_url: `/api/knowledge/jobs/${job.id}`,
  }, requestId);
}

export function requireReadableMessage(req: Request, messageId: string) {
  const message = getMessageById(messageId);
  if (!message) {
    throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
  }
  const session = getSessionById(message.session_id);
  if (!session) {
    throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
  }
  if (!canReadSession(req, session.user_id)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权限访问该会话。", 403);
  }
  return message;
}

export function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function queryNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function bodyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function bodyStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

export function bodySourceRefs(value: unknown): TerminologySourceRef[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item))
      .map((item) => ({
        document_id: bodyString(item.document_id) || undefined,
        title: bodyString(item.title) || undefined,
        section_path: bodyString(item.section_path) || undefined,
        chunk_id: bodyString(item.chunk_id) || undefined,
      }))
    : [];
}
