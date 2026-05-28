import { Router, Request, Response, NextFunction } from "express";
import { createFeedback, listFeedback, getFeedbackById, updateFeedback } from "../db/feedback";
import { getMessageById } from "../db/chatMessages";
import { sendSuccess, sendPaginated } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";
import { requirePermission } from "../middleware/auth";
import { auditFromRequest } from "../services/auditService";
import { recordFailureSignalFromAssistantMessage } from "../services/knowledgeFailureSignalService";

const router = Router();

// POST /api/feedback - submit feedback
router.post("/feedback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message_id, rating, reason, comment } = req.body;

    if (!message_id) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "缺少 message_id。", 400);
    }
    if (!rating || !["up", "down"].includes(rating)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "rating 必须为 'up' 或 'down'。", 400);
    }

    // Verify message exists
    const message = getMessageById(message_id);
    if (!message) {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
    }

    const userId = req.user?.id || "anonymous";

    const feedback = createFeedback({
      messageId: message_id,
      userId,
      rating,
      reason: reason as string | undefined,
      comment: comment as string | undefined,
    });
    if (feedback.rating === "down") {
      recordFailureSignalFromAssistantMessage(message, userId, "negative_feedback", {
        id: feedback.id,
        reason: feedback.reason,
        comment: feedback.comment,
      });
    }

    auditFromRequest(req, "feedback.create", "feedback", feedback.id, {
      message_id,
      rating,
      reason,
    });

    sendSuccess(
      res,
      {
        id: feedback.id,
        status: feedback.status,
      },
      req.requestId
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/feedback - list feedback
router.get(
  "/feedback",
  requirePermission("feedback.manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, rating, page, page_size } = req.query;

      const result = listFeedback({
        status: status as string | undefined,
        rating: rating as string | undefined,
        page: page ? parseInt(page as string, 10) : 1,
        pageSize: page_size ? parseInt(page_size as string, 10) : 20,
      });

      sendPaginated(res, result.items, result.page, result.pageSize, result.total, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/feedback/:id - update feedback
router.patch(
  "/feedback/:id",
    requirePermission("feedback.manage"),
    async (req: Request, res: Response, next: NextFunction) => {
    try {
      const feedbackId = req.params.id as string;
      const feedback = getFeedbackById(feedbackId);
      if (!feedback) {
        throw new AppError(ErrorCodes.FEEDBACK_NOT_FOUND, "反馈不存在。", 404);
      }

      const { status, resolution } = req.body;

      const updated = updateFeedback(feedback.id, {
        status: status as string | undefined,
        resolution: resolution as string | undefined,
        handledBy: req.user?.id,
      });

      auditFromRequest(req, "feedback.update", "feedback", feedback.id, {
        old_status: feedback.status,
        new_status: updated?.status,
      });

      sendSuccess(res, { id: feedback.id, updated: true }, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
