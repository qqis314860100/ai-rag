import { Router, Request, Response, NextFunction } from "express";
import {
  TERMINOLOGY_CONTRACT,
  formatTerminologyTerm,
  getTerminologyTermByCanonicalTerm,
  getTerminologyTermById,
  isTerminologyStatus,
  listTerminologyTerms,
  updateTerminologyTerm,
  upsertTerminologyTerm,
} from "../../db/terminology";
import type { TerminologyStatus } from "../../db/terminology";
import { requirePermission } from "../../middleware/auth";
import { auditFromRequest } from "../../services/auditService";
import { AppError, ErrorCodes } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";
import { bodySourceRefs, bodyString, bodyStringArray, currentUser } from "./shared";

export function registerKnowledgeTermRoutes(router: Router) {
  router.get(
    "/knowledge/terms/contract",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        sendSuccess(res, {
          contract: TERMINOLOGY_CONTRACT,
          seed_terms: ["OCV", "DCR", "EOL", "SOC", "SOP", "CCD", "Busbar"],
        }, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/knowledge/terms",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { status, q, related_topic } = req.query;
        const statusValue = typeof status === "string" ? status : undefined;
        let requestedStatus: TerminologyStatus | undefined;
        if (statusValue !== undefined) {
          if (!isTerminologyStatus(statusValue)) {
            throw new AppError(ErrorCodes.VALIDATION_ERROR, "术语状态必须是 draft、published 或 archived。", 400);
          }
          requestedStatus = statusValue;
        } else if (status !== undefined) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "术语状态必须是 draft、published 或 archived。", 400);
        }

        const terms = listTerminologyTerms({
          status: requestedStatus ?? "published",
          query: typeof q === "string" ? q : undefined,
          relatedTopic: typeof related_topic === "string" ? related_topic : undefined,
        });
        sendSuccess(res, { items: terms, total: terms.length }, req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/knowledge/terms",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const canonicalTerm = bodyString(req.body.canonical_term);
        if (!canonicalTerm) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "术语 canonical_term 不能为空。", 400);
        }
        const status = bodyString(req.body.status) || "draft";
        if (!isTerminologyStatus(status)) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "术语状态必须是 draft、published 或 archived。", 400);
        }
        const user = currentUser(req);
        const term = upsertTerminologyTerm({
          canonicalTerm,
          abbreviation: bodyString(req.body.abbreviation),
          aliases: bodyStringArray(req.body.aliases),
          synonyms: bodyStringArray(req.body.synonyms),
          definition: bodyString(req.body.definition),
          applicableScenarios: bodyStringArray(req.body.applicable_scenarios),
          sourceRefs: bodySourceRefs(req.body.source_refs),
          relatedTopics: bodyStringArray(req.body.related_topics),
          retrievalTerms: bodyStringArray(req.body.retrieval_terms),
          status,
          source: bodyString(req.body.source) || "manual",
          confidence: typeof req.body.confidence === "number" ? req.body.confidence : undefined,
          reviewerId: user.id,
          reviewerName: user.name,
          feedbackStatus: status === "published" ? "fed_back" : "candidate",
          metadata: typeof req.body.metadata === "object" && req.body.metadata !== null && !Array.isArray(req.body.metadata)
            ? req.body.metadata as Record<string, unknown>
            : {},
        });
        auditFromRequest(req, "terminology.upsert", "terminology_term", term.id, {
          canonical_term: term.canonical_term,
          status: term.status,
        });
        sendSuccess(res, formatTerminologyTerm(term), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get(
    "/knowledge/terms/:idOrTerm",
    requirePermission("document.read"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const idOrTerm = String(req.params.idOrTerm).trim();
        const row = getTerminologyTermById(idOrTerm) ?? getTerminologyTermByCanonicalTerm(idOrTerm);
        if (!row) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "未找到对应术语。", 404);
        }

        sendSuccess(res, formatTerminologyTerm(row), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );

  router.patch(
    "/knowledge/terms/:idOrTerm",
    requirePermission("evaluation.run"),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const idOrTerm = String(req.params.idOrTerm).trim();
        const row = getTerminologyTermById(idOrTerm) ?? getTerminologyTermByCanonicalTerm(idOrTerm);
        if (!row) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "未找到对应术语。", 404);
        }
        const requestedStatus = bodyString(req.body.status);
        if (requestedStatus && !isTerminologyStatus(requestedStatus)) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "术语状态必须是 draft、published 或 archived。", 400);
        }
        const nextStatus: TerminologyStatus | undefined = requestedStatus ? requestedStatus as TerminologyStatus : undefined;
        const user = currentUser(req);
        const updated = updateTerminologyTerm(row.id, {
          canonicalTerm: bodyString(req.body.canonical_term) || undefined,
          abbreviation: bodyString(req.body.abbreviation) || undefined,
          aliases: bodyStringArray(req.body.aliases),
          synonyms: bodyStringArray(req.body.synonyms),
          definition: bodyString(req.body.definition) || undefined,
          applicableScenarios: bodyStringArray(req.body.applicable_scenarios),
          sourceRefs: bodySourceRefs(req.body.source_refs),
          relatedTopics: bodyStringArray(req.body.related_topics),
          retrievalTerms: bodyStringArray(req.body.retrieval_terms),
          status: nextStatus,
          source: bodyString(req.body.source) || undefined,
          confidence: typeof req.body.confidence === "number" ? req.body.confidence : undefined,
          reviewerId: user.id,
          reviewerName: user.name,
          feedbackStatus: nextStatus === "published" ? "fed_back" : undefined,
          metadata: typeof req.body.metadata === "object" && req.body.metadata !== null && !Array.isArray(req.body.metadata)
            ? req.body.metadata as Record<string, unknown>
            : undefined,
        });
        if (!updated) {
          throw new AppError(ErrorCodes.VALIDATION_ERROR, "术语更新失败。", 400);
        }
        auditFromRequest(req, "terminology.update", "terminology_term", updated.id, {
          canonical_term: updated.canonical_term,
          status: updated.status,
        });
        sendSuccess(res, formatTerminologyTerm(updated), req.requestId);
      } catch (err) {
        next(err);
      }
    }
  );
}
