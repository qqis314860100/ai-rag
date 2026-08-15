import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { loadConfig } from "../config";
import {
  listDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  softDeleteDocument,
  formatDocument,
} from "../db/documents";
import { sendSuccess, sendPaginated } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";
import { auditFromRequest } from "../services/auditService";
import { requirePermission, getSecurityLevelsForRequest } from "../middleware/auth";
import { ingestDocument, reindexDocument } from "../services/ragClient";
import { buildDocumentInsights } from "../services/documentInsightsService";
import { importOfflinePackage } from "../services/offlineImportService";
import { getDb } from "../db";
import { listComments, createComment, updateComment, softDeleteComment } from "../db/docComments";
import { buildDocumentPreviewContract, getPreviewMimeType, listPreviewFormatDefinitions } from "../utils/documentPreview";

const config = loadConfig();

// Ensure upload directory exists
const uploadDir = path.resolve(config.uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Allowed file types
const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".pdf": "pdf",
  ".txt": "txt",
  ".md": "md",
  ".markdown": "md",
  ".docx": "docx",
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // Sanitize filename: use uuid + original extension to prevent path traversal
    const ext = path.extname(file.originalname).toLowerCase();
    const sanitized = `${uuidv4()}${ext}`;
    cb(null, sanitized);
  },
});


const SECURITY_LEVELS = ["public", "internal", "confidential", "restricted"];

// Magic bytes for content sniffing (defense against renamed executables)
const MAGIC_BYTES: Record<string, Buffer> = {
  pdf: Buffer.from("%PDF-", "latin1"),
  docx: Buffer.from([0x50, 0x4b, 0x03, 0x04]), // PK.. zip container
};

/** Verify the file content matches its claimed type via magic bytes. */
function assertMagicBytes(filePath: string, fileType: string): void {
  const magic = MAGIC_BYTES[fileType];
  if (!magic) return; // txt/md have no reliable magic
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(magic.length);
    const n = fs.readSync(fd, buf, 0, magic.length, 0);
    if (n < magic.length || !buf.equals(magic)) {
      throw new AppError(ErrorCodes.FILE_UPLOAD_FAILED, "文件内容与声明的类型不符，已拒绝。", 400);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/** Reject documents whose security level the requester cannot see. */
function assertDocumentVisible(req: Request, doc: { security_level: string }): void {
  const allowed = getSecurityLevelsForRequest(req);
  if (!allowed.includes(doc.security_level)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权访问该安全等级的文档。", 403);
  }
}

/**
 * Resolve a candidate path and verify it stays inside one of the allowed roots.
 * Prevents path traversal ("..") escapes. Returns the real path or null.
 */
function resolveWithinRoots(candidate: string, roots: string[]): string | null {
  try {
    const resolved = path.resolve(candidate);
    const real = fs.realpathSync(resolved);
    const realRoots = roots.filter((r) => {
      try {
        fs.realpathSync(r);
        return true;
      } catch {
        return false;
      }
    });
    return realRoots.some((root) => real === root || real.startsWith(root + path.sep)) ? real : null;
  } catch {
    return null;
  }
}

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const extType = ALLOWED_EXTENSIONS[ext];
  const mimeType = ALLOWED_MIME_TYPES[file.mimetype];

  // Extension AND MIME type must agree on a supported type
  if (!extType) {
    cb(new AppError(ErrorCodes.FILE_UPLOAD_FAILED, "不支持的文件类型。允许: pdf, txt, md, docx", 400), false);
    return;
  }
  if (file.mimetype && file.mimetype !== "application/octet-stream" && mimeType !== extType) {
    cb(new AppError(ErrorCodes.FILE_UPLOAD_FAILED, "文件扩展名与内容类型不匹配。", 400), false);
    return;
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

const router = Router();

function bodyText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bodyTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

// GET /api/documents - list documents
router.get("/documents", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, status, index_status, security_level, keyword, page, page_size } = req.query;

    const result = listDocuments({
      category: category as string | undefined,
      status: status as string | undefined,
      indexStatus: index_status as string | undefined,
      securityLevel: security_level as string | undefined,
      keyword: keyword as string | undefined,
      page: page ? parseInt(page as string, 10) : 1,
      pageSize: page_size ? parseInt(page_size as string, 10) : 20,
      allowedSecurityLevels: getSecurityLevelsForRequest(req),
    });

    sendPaginated(res, result.items, result.page, result.pageSize, result.total, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/preview-contract - supported preview MIME/file-type contract
router.get("/documents/preview-contract", async (req: Request, res: Response, next: NextFunction) => {
  try {
    sendSuccess(
      res,
      {
        version: "2026-05-24",
        formats: listPreviewFormatDefinitions(),
        contract: {
          document_preview_field: "preview",
          endpoint_fields: ["raw", "file", "chunk", "comments"],
          unsupported_views_return_reason: true,
        },
      },
      req.requestId
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/import/offline-package - import MES/PLM/ERP exported files from a controlled local directory
router.post(
  "/documents/import/offline-package",
  requirePermission("document.upload"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const packagePath = bodyText(req.body.package_path);
      const sourceSystem = bodyText(req.body.source_system).toLowerCase();
      const category = bodyText(req.body.category) || sourceSystem.toUpperCase();
      const securityLevel = bodyText(req.body.security_level) || "internal";

      if (!packagePath || !sourceSystem) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "缺少必填字段: package_path, source_system。", 400);
      }
      if (!["mes", "plm", "erp"].includes(sourceSystem)) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "source_system 必须是 mes、plm 或 erp。", 400);
      }

      const result = await importOfflinePackage({
        packagePath,
        sourceSystem,
        category,
        securityLevel,
        process: bodyText(req.body.process) || undefined,
        station: bodyText(req.body.station) || undefined,
        version: bodyText(req.body.version) || undefined,
        owner: bodyText(req.body.owner) || undefined,
        tags: bodyTags(req.body.tags),
        createdBy: req.user?.id,
        requestId: req.requestId,
      });

      auditFromRequest(req, "document.offline_import", "document", undefined, {
        source_system: sourceSystem,
        total: result.total,
        failed: result.items.filter((item) => item.status === "failed").length,
      });
      sendSuccess(res, result, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/documents/:id - document detail
router.get("/documents/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const documentId = req.params.id as string;
    const doc = getDocumentById(documentId);
    if (!doc) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
    }
    assertDocumentVisible(req, doc);
    const formatted = formatDocument(doc) as ReturnType<typeof formatDocument> & { content?: string };
    const preview = buildDocumentPreviewContract({
      documentId: doc.id,
      fileName: doc.file_name,
      fileType: doc.file_type,
    });

    // Include file content for text-based files
    try {
      if (preview.capabilities.raw && doc.file_path && fs.existsSync(doc.file_path)) {
        formatted.content = fs.readFileSync(doc.file_path, "utf-8");
      }
    } catch (error) {
      console.warn("Failed to attach document content preview", { documentId, error });
    }

    sendSuccess(res, formatted, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id/insights - document usage and governance detail
router.get("/documents/:id/insights", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const documentId = req.params.id as string;
    const doc = getDocumentById(documentId);
    if (!doc) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
    }
    sendSuccess(res, buildDocumentInsights(documentId), req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/upload - upload document
router.post(
  "/documents/upload",
  requirePermission("document.upload"),
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new AppError(ErrorCodes.FILE_UPLOAD_FAILED, "未提供文件。", 400);
      }

      const { title, category, process, station, version, owner, security_level, tags } = req.body;

      if (!title || !category || !security_level) {
        // Clean up uploaded file
        fs.unlink(req.file.path, () => {});
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "缺少必填字段: title, category, security_level。", 400);
      }

      if (!SECURITY_LEVELS.includes(security_level as string)) {
        fs.unlink(req.file.path, () => {});
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "security_level 必须是 public/internal/confidential/restricted 之一。", 400);
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      const fileType = ALLOWED_EXTENSIONS[ext] || "unknown";

      // Content sniffing: reject files whose bytes don't match their extension
      try {
        assertMagicBytes(req.file.path, fileType);
      } catch (err) {
        fs.unlink(req.file.path, () => {});
        throw err;
      }

      const fileHash = await sha256File(req.file.path);

      const doc = createDocument({
        title: title as string,
        category: category as string,
        process: process as string | undefined,
        station: station as string | undefined,
        version: version as string | undefined,
        owner: owner as string | undefined,
        securityLevel: security_level as string,
        tags: tags ? (tags as string).split(",").map((t: string) => t.trim()).filter(Boolean) : [],
        filePath: req.file.path,
        fileName: req.file.originalname,
        fileType,
        fileSize: req.file.size,
        fileHash,
        createdBy: req.user?.id,
      });

      // Audit log
      auditFromRequest(req, "document.upload", "document", doc.id, {
        title: doc.title,
        file_name: req.file.originalname,
        file_size: req.file.size,
      });

      // Update status to processing and call RAG ingest asynchronously
      updateDocument(doc.id, { indexStatus: "processing" });

      // Fire and forget RAG ingest - we update status when it completes
      ingestDocument(doc.id, req.file.path, {
        title: doc.title,
        category: doc.category,
        security_level: doc.security_level,
        process: doc.process ?? undefined,
        station: doc.station ?? undefined,
        version: doc.version,
        tags: JSON.parse(doc.tags_json || "[]"),
      }, req.requestId)
        .then((result) => {
          updateDocument(doc.id, {
            indexStatus: result.index_status || "ready",
            chunkCount: result.chunk_count,
          });
        })
        .catch((err) => {
          updateDocument(doc.id, {
            indexStatus: "failed",
            indexError: err instanceof Error ? err.message : "索引构建失败",
          });
        });

      sendSuccess(
        res,
        {
          document_id: doc.id,
          title: doc.title,
          index_status: "processing",
          message: "文档已上传，正在构建索引。",
        },
        req.requestId
      );
    } catch (err) {
      // Clean up uploaded file on error
      if (req.file) {
        fs.unlink(req.file.path, () => {});
      }
      next(err);
    }
  }
);

// PATCH /api/documents/:id - update document metadata
router.patch(
  "/documents/:id",
  requirePermission("document.update"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const documentId = req.params.id as string;
      const existing = getDocumentById(documentId);
      if (!existing) {
        throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
      }

      assertDocumentVisible(req, existing);

      const { title, category, process, station, version, owner, security_level, tags } = req.body;

      // 修改安全等级是权限敏感操作：仅管理员可执行
      if (security_level !== undefined && !req.user?.permissions.includes("settings.update")) {
        throw new AppError(ErrorCodes.FORBIDDEN, "仅系统管理员可以修改文档安全等级。", 403);
      }
      if (security_level !== undefined && !SECURITY_LEVELS.includes(security_level as string)) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "security_level 必须是 public/internal/confidential/restricted 之一。", 400);
      }

      updateDocument(existing.id, {
        title: title as string | undefined,
        category: category as string | undefined,
        process: process as string | undefined,
        station: station as string | undefined,
        version: version as string | undefined,
        owner: owner as string | undefined,
        securityLevel: security_level as string | undefined,
        tags: tags as string[] | undefined,
      });

      auditFromRequest(req, "document.update", "document", existing.id, {
        changes: Object.keys(req.body),
      });

      sendSuccess(res, { id: existing.id, updated: true }, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/documents/:id - soft delete document
router.delete(
  "/documents/:id",
  requirePermission("document.delete"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const documentId = req.params.id as string;
      const doc = getDocumentById(documentId);
      if (!doc) {
        throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
      }
      assertDocumentVisible(req, doc);

      const deleted = softDeleteDocument(documentId);
      if (!deleted) {
        throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在或已删除。", 404);
      }

      auditFromRequest(req, "document.delete", "document", doc.id, {
        title: doc.title,
      });

      sendSuccess(res, { id: doc.id, deleted: true }, req.requestId);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/documents/chunks/:chunk_id - get chunk content
router.get("/documents/chunks/:chunk_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const chunkId = req.params.chunk_id as string;
    const db = getDb();
    const row = db.prepare(
      `SELECT ms.snippet, d.security_level
       FROM message_sources ms
       LEFT JOIN documents d ON d.id = ms.document_id
       WHERE ms.chunk_id = ? ORDER BY ms.created_at DESC LIMIT 1`
    ).get(chunkId) as { snippet: string; security_level: string | null } | undefined;

    if (!row?.snippet) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "Chunk 内容不存在。", 404);
    }

    const allowed = getSecurityLevelsForRequest(req);
    if (row.security_level && !allowed.includes(row.security_level)) {
      throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权访问该内容。", 403);
    }

    sendSuccess(res, { content: row.snippet }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/:id/reindex - reindex single document
router.post(
  "/documents/:id/reindex",
  requirePermission("document.reindex"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const documentId = req.params.id as string;
      const doc = getDocumentById(documentId);
      if (!doc) {
        throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
      }

      updateDocument(doc.id, {
        indexStatus: "processing",
        indexError: null,
      });

      auditFromRequest(req, "document.reindex", "document", doc.id, {
        title: doc.title,
      });

      // Call RAG reindex asynchronously
      reindexDocument(doc.id, doc.file_path, {
        title: doc.title,
        category: doc.category,
        security_level: doc.security_level,
        process: doc.process ?? undefined,
        station: doc.station ?? undefined,
        version: doc.version,
        tags: JSON.parse(doc.tags_json || "[]"),
      }, req.requestId)
        .then((result) => {
          updateDocument(doc.id, {
            indexStatus: result.index_status || "ready",
            chunkCount: result.chunk_count,
          });
        })
        .catch((err) => {
          updateDocument(doc.id, {
            indexStatus: "failed",
            indexError: err instanceof Error ? err.message : "重建索引失败",
          });
        });

      sendSuccess(
        res,
        {
          document_id: doc.id,
          index_status: "processing",
        },
        req.requestId
      );
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/documents/:id/comments - list comments
router.get("/documents/:id/comments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = getDocumentById(req.params.id as string);
    if (!doc) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
    }
    assertDocumentVisible(req, doc);

    const chunkId = req.query.chunk_id as string | undefined;
    const comments = listComments(req.params.id as string, chunkId);
    sendSuccess(res, { items: comments }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/:id/comments - create comment
router.post("/documents/:id/comments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content, chunk_id, parent_id } = req.body;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "评论内容不能为空。", 400);
    }
    const comment = createComment({
      documentId: req.params.id as string,
      chunkId: chunk_id,
      userId: req.user?.id || "anonymous",
      userName: req.user?.name || "匿名",
      content: content.trim(),
      parentId: parent_id,
    });
    sendSuccess(res, comment, req.requestId);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/documents/:id/comments/:commentId - edit comment
router.patch("/documents/:id/comments/:commentId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "评论内容不能为空。", 400);
    }
    const updated = updateComment(req.params.commentId as string, req.user?.id || "anonymous", content.trim());
    if (!updated) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "评论不存在或无权编辑。", 404);
    }
    sendSuccess(res, updated, req.requestId);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/documents/:id/comments/:commentId - delete comment
router.delete("/documents/:id/comments/:commentId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deleted = softDeleteComment(req.params.commentId as string, req.user?.id || "anonymous");
    if (!deleted) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "评论不存在或无权删除。", 404);
    }
    sendSuccess(res, { deleted: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id/raw - return original file content for inline preview
router.get("/documents/:id/raw", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = getDocumentById(req.params.id as string);
    if (!doc) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
    }
    assertDocumentVisible(req, doc);

    const preview = buildDocumentPreviewContract({
      documentId: doc.id,
      fileName: doc.file_name,
      fileType: doc.file_type,
    });

    const knowledgeDir = path.resolve(config.uploadDir, "../../knowledge");
    const allowedRoots = [uploadDir, knowledgeDir];

    let content: string | null = null;

    // Strategy 1: direct file_path (must stay inside allowed roots)
    if (preview.capabilities.raw && doc.file_path && fs.existsSync(doc.file_path)) {
      const real = resolveWithinRoots(doc.file_path, allowedRoots);
      if (real) content = fs.readFileSync(real, "utf-8");
    }

    // Strategy 2: use section_path to find the document file
    // e.g. "极柱Busbar激光焊接 / 5. 安全注意事项" → look for "极柱Busbar激光焊接.md"
    const sectionPath = req.query.section_path as string | undefined;
    if (!content && sectionPath && fs.existsSync(knowledgeDir)) {
      const docName = sectionPath.split(" / ")[0]?.trim();
      if (docName) {
        for (const ext of [".md", ".txt", ".markdown"]) {
          const real = resolveWithinRoots(path.join(knowledgeDir, `${docName}${ext}`), allowedRoots);
          if (real) { content = fs.readFileSync(real, "utf-8"); break; }
        }
      }
    }

    // Strategy 3: search by title in knowledge dir
    if (!content) {
      for (const ext of [".md", ".txt", ".markdown"]) {
        const real = resolveWithinRoots(path.join(knowledgeDir, `${doc.title}${ext}`), allowedRoots);
        if (real) { content = fs.readFileSync(real, "utf-8"); break; }
      }
    }

    // Strategy 3: fuzzy match — find file whose name contains doc title or vice versa
    if (!content && fs.existsSync(knowledgeDir)) {
      const files = fs.readdirSync(knowledgeDir);
      for (const f of files) {
        const name = f.replace(/\.(md|txt|markdown)$/, "");
        if (doc.title.includes(name) || name.includes(doc.title)) {
          content = fs.readFileSync(path.join(knowledgeDir, f), "utf-8");
          break;
        }
      }
    }

    if (content === null && !preview.capabilities.raw && doc.file_path && fs.existsSync(doc.file_path)) {
      throw new AppError(
        ErrorCodes.VALIDATION_ERROR,
        "当前文件类型不支持原文文本预览，请使用 file endpoint。",
        415,
        { preview }
      );
    }

    if (content === null) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档文件不存在，请确认知识库文件已上传。", 404);
    }

    sendSuccess(res, { content }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id/file - serve original document file for preview
router.get("/documents/:id/file", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = getDocumentById(req.params.id as string);
    if (!doc || !doc.file_path) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档文件不存在。", 404);
    }
    assertDocumentVisible(req, doc);

    const knowledgeDir = path.resolve(config.uploadDir, "../../knowledge");
    const allowedRoots = [uploadDir, knowledgeDir];
    const filePath = resolveWithinRoots(doc.file_path, allowedRoots);
    if (!filePath) {
      // Try to find by title in knowledge directory
      const altPath = resolveWithinRoots(path.join(knowledgeDir, `${doc.title}.md`), allowedRoots);
      if (altPath) {
        const content = fs.readFileSync(altPath, "utf-8");
        res.type("text/markdown").send(content);
        return;
      }
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档文件不存在。", 404);
    }

    const preview = buildDocumentPreviewContract({
      documentId: doc.id,
      fileName: doc.file_name,
      fileType: doc.file_type,
    });
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = getPreviewMimeType(ext || doc.file_type);
    res.type(mimeType);
    res.setHeader("X-Document-File-Type", preview.file_type);
    res.setHeader("X-Document-Preview-Kind", preview.content_kind);
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/sync-from-rag - sync documents from RAG/Chroma into SQLite
router.post(
  "/documents/sync-from-rag",
  requirePermission("document.reindex"),
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = loadConfig();
    const ragUrl = `${config.ragServiceUrl}/rag/documents`;

    const ragHeaders: Record<string, string> = {};
    if (config.ragApiKey) ragHeaders["X-API-Key"] = config.ragApiKey;

    const response = await fetch(ragUrl, { headers: ragHeaders, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new AppError(ErrorCodes.RAG_SERVICE_ERROR, "RAG 服务文档列表请求失败。", 502);
    }

    const { documents: ragDocs } = (await response.json()) as { documents: Array<{ document_id: string; title: string; chunk_count: number; category: string; section_paths: string[] }> };

    let created = 0;
    let updated = 0;

    for (const rd of ragDocs) {
      const existing = getDocumentById(rd.document_id);
      if (existing) {
        updateDocument(rd.document_id, {
          title: rd.title,
          category: rd.category || "未分类",
          indexStatus: "ready",
          chunkCount: rd.chunk_count,
        });
        updated++;
      } else {
        // Try to find the source file on disk by title
        const knowledgeDir = path.resolve(config.uploadDir, "../../knowledge");
        let filePath = "";
        let fileName = "";
        let fileType = "unknown";
        let fileSize = 0;
        for (const ext of [".md", ".txt", ".markdown"]) {
          const candidate = path.join(knowledgeDir, `${rd.title}${ext}`);
          if (fs.existsSync(candidate)) {
            filePath = candidate;
            fileName = `${rd.title}${ext}`;
            fileType = ext.replace(".", "");
            fileSize = fs.statSync(candidate).size;
            break;
          }
        }

        // 按标题精确回填 RAG document_id（消除"最新一条"竞态）
        const db = getDb();
        const sameTitle = db.prepare(
          "SELECT id FROM documents WHERE title = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT 1"
        ).get(rd.title) as { id: string } | undefined;
        if (sameTitle) {
          db.prepare("UPDATE documents SET id = ?, chunk_count = ?, index_status = 'ready' WHERE id = ?")
            .run(rd.document_id, rd.chunk_count, sameTitle.id);
          db.prepare("UPDATE message_sources SET document_id = ? WHERE document_id = ?")
            .run(rd.document_id, sameTitle.id);
          updated++;
        } else {
          // 直接以 RAG document_id 创建，无需 ID 交换
          createDocument(
            {
              title: rd.title,
              category: rd.category || "未分类",
              securityLevel: "internal",
              filePath,
              fileName,
              fileType,
              fileSize,
              createdBy: req.user?.id,
            },
            rd.document_id
          );
          db.prepare("UPDATE documents SET chunk_count = ?, index_status = 'ready' WHERE id = ?")
            .run(rd.chunk_count, rd.document_id);
          created++;
        }
      }
    }

    auditFromRequest(req, "document.sync", "document", undefined, { created, updated, total: ragDocs.length });

    sendSuccess(res, { created, updated, total: ragDocs.length }, req.requestId);
  } catch (err) {
    next(err);
  }
  }
);

export default router;
