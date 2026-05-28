import { Router, Request, Response, NextFunction } from "express";
import { buildImageArtifactContract } from "../../services/ragClient";
import { sendSuccess } from "../../utils/response";
import { AppError, ErrorCodes } from "../../utils/errors";
import { auditFromRequest } from "../../services/auditService";
import { createArtifact, formatArtifact, getArtifactById, listArtifactsByMessage, softDeleteArtifact, updateArtifact } from "../../db/chatArtifacts";
import { createPendingDiagramArtifact, generateDiagramArtifact, getPreviousUserQuestion, imageArtifactStatus, normalizeDiagramType, parseMessageSources, queueDiagramArtifactGeneration, requireReadableAssistantMessage } from "./shared";

const router = Router();

// POST /api/chat/messages/:id/diagram - generate Diagram IR for one assistant answer
router.post("/chat/messages/:id/diagram", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messageId = req.params.id as string;
    const rawDiagramType = normalizeDiagramType(req.body?.type ?? req.body?.diagram_type);
    const { diagram, existing, sourceIds } = await generateDiagramArtifact(req, messageId, rawDiagramType, req.body?.title);

    auditFromRequest(req, "chat.diagram.generate", "chat_message", messageId, {
      session_id: existing.session_id,
      type: rawDiagramType,
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
    const diagramType = normalizeDiagramType(req.body?.type ?? req.body?.diagram_type);
    const artifact = createPendingDiagramArtifact(req, messageId, diagramType, req.body?.title);
    queueDiagramArtifactGeneration(req, artifact.id, messageId, diagramType, req.body?.title);
    res.status(202);
    sendSuccess(res, formatArtifact(artifact), req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/artifacts/:id - 轮询单个产物生成状态
router.get("/chat/artifacts/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const artifactId = req.params.id as string;
    const artifact = getArtifactById(artifactId);
    if (!artifact || artifact.status === "deleted") {
      throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "Artifact 不存在。", 404);
    }

    requireReadableAssistantMessage(req, artifact.message_id, "查看");
    sendSuccess(res, formatArtifact(artifact), req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/messages/:id/artifacts/image/contract - 创建受控图片产物契约，不直接生成图片
router.post("/chat/messages/:id/artifacts/image/contract", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messageId = req.params.id as string;
    const { existing } = requireReadableAssistantMessage(req, messageId, "创建图片产物契约");
    const sources = parseMessageSources(existing);
    const question = getPreviousUserQuestion(existing.session_id, messageId);
    const contract = await buildImageArtifactContract(
      question,
      existing.content,
      sources,
      true,
      req.requestId,
      req.user?.id
    );
    const artifact = createArtifact({
      sessionId: existing.session_id,
      messageId,
      type: "image",
      renderer: contract.renderer || "image-contract",
      title: typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "图片产物契约",
      summary: contract.allowed ? "图片生成请求已进入受控异步契约。" : "图片生成请求未满足安全或证据条件。",
      reason: contract.allowed ? "用户显式触发图片产物，已完成 prompt 脱敏和权限继承检查。" : contract.failure_fallback,
      status: imageArtifactStatus(contract),
      confidence: 0,
      payload: contract,
      sourceIds: contract.inherited_source_ids ?? [],
      metadata: {
        renderer: contract.renderer || "image-contract",
        async_required: contract.async_required,
        allowed: contract.allowed,
        inherited_document_ids: contract.inherited_document_ids ?? [],
        redaction_report: contract.redaction_report ?? {},
        safety_warnings: contract.safety_warnings ?? [],
      },
    });

    auditFromRequest(req, "chat.artifact.image_contract", "chat_message", messageId, {
      artifact_id: artifact.id,
      allowed: contract.allowed,
      source_count: contract.inherited_source_ids?.length ?? 0,
      redaction_report: contract.redaction_report ?? {},
    });

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
    const diagramType = normalizeDiagramType(req.body?.type ?? req.body?.diagram_type ?? artifact.type);
    const updated = updateArtifact(artifactId, {
      type: diagramType,
      renderer: "diagram-ir",
      title: typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : artifact.title,
      summary: "图解重新生成已进入后台队列。",
      reason: "主流程不等待重生成结果，完成后通过 artifact 状态轮询查看。",
      status: "pending",
      confidence: 0,
      payload: {
        type: diagramType,
        title: typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : artifact.title,
        status: "pending",
      },
      sourceIds: [],
      metadata: {
        ...JSON.parse(artifact.metadata_json || "{}"),
        type: diagramType,
        async_status: "queued",
        queued_at: new Date().toISOString(),
        regenerated_from: artifactId,
      },
    });
    queueDiagramArtifactGeneration(req, artifactId, artifact.message_id, diagramType, req.body?.title ?? artifact.title);

    auditFromRequest(req, "chat.artifact.regenerate", "chat_artifact", artifactId, {
      message_id: artifact.message_id,
      type: diagramType,
      async_status: "queued",
    });

    res.status(202);
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
      type: artifact.type,
    });

    sendSuccess(res, { deleted: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
