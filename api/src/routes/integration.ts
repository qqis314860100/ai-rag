import { Router, Request, Response, NextFunction } from "express";
import { listKnowledgeCards, getKnowledgeCardById, formatKnowledgeCard, listKnowledgeCardVersions } from "../db/knowledgeCards";
import { requireIntegrationToken, integrationRateLimit } from "../middleware/integrationAuth";
import { chatWithRag, searchDocuments } from "../services/ragClient";
import { auditFromRequest } from "../services/auditService";
import { buildPublishedKnowledgeAssetContext } from "../services/knowledgeAssetContextService";
import { sendSuccess } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";

const router = Router();

router.use("/integration/v1", requireIntegrationToken, integrationRateLimit);

function bodyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bodyNumber(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function bodyFilters(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function integrationSecurityLevels(req: Request): string[] {
  return req.integration?.allowedSecurityLevels ?? ["public"];
}

router.post("/integration/v1/search", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = bodyString(req.body.query);
    if (!query) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "查询内容不能为空。", 400);
    }

    const topK = bodyNumber(req.body.top_k, 5, 20);
    const result = await searchDocuments(
      query,
      integrationSecurityLevels(req),
      topK,
      "vector",
      bodyFilters(req.body.filters),
      req.requestId
    );

    auditFromRequest(req, "integration.search", "integration_api", req.integration?.clientId, {
      top_k: topK,
      query_chars: query.length,
      result_count: result.results.length,
    });
    sendSuccess(res, result, req.requestId);
  } catch (err) {
    next(err);
  }
});

router.post("/integration/v1/ask", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const question = bodyString(req.body.question ?? req.body.query);
    if (!question) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "问题内容不能为空。", 400);
    }

    const topK = bodyNumber(req.body.top_k, 5, 20);
    const result = await chatWithRag(
      question,
      integrationSecurityLevels(req),
      topK,
      bodyFilters(req.body.filters),
      [],
      buildPublishedKnowledgeAssetContext(question),
      req.requestId,
      req.user?.id
    );

    auditFromRequest(req, "integration.ask", "integration_api", req.integration?.clientId, {
      question_chars: question.length,
      source_count: result.sources.length,
      confidence: result.confidence,
    });
    sendSuccess(res, {
      answer: result.answer,
      sources: result.sources,
      confidence: result.confidence,
      followups: result.followups,
      trace: result.trace,
      answer_ir: result.answer_ir,
      visual_plan: result.visual_plan,
    }, req.requestId);
  } catch (err) {
    next(err);
  }
});

router.get("/integration/v1/knowledge/cards", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = listKnowledgeCards({
      status: "published",
      topic: typeof req.query.q === "string" ? req.query.q : undefined,
      relatedTerm: typeof req.query.related_term === "string" ? req.query.related_term : undefined,
      page: bodyNumber(req.query.page, 1, 500),
      pageSize: bodyNumber(req.query.page_size, 20, 100),
    });
    auditFromRequest(req, "integration.knowledge_cards.list", "integration_api", req.integration?.clientId, {
      total: result.total,
      page: result.page,
      page_size: result.pageSize,
    });
    sendSuccess(res, result, req.requestId);
  } catch (err) {
    next(err);
  }
});

router.get("/integration/v1/knowledge/cards/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = getKnowledgeCardById(String(req.params.id));
    if (!row || row.status !== "published") {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "未找到可对外集成访问的知识卡。", 404);
    }
    const card = formatKnowledgeCard(row, listKnowledgeCardVersions(row.id));
    auditFromRequest(req, "integration.knowledge_cards.read", "knowledge_card", row.id, {
      topic: row.topic,
    });
    sendSuccess(res, card, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;

