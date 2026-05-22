import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
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
import { requirePermission } from "../middleware/auth";
import { ingestDocument, reindexDocument } from "../services/ragClient";
import { getDb } from "../db";
import { listComments, createComment, updateComment, softDeleteComment } from "../db/docComments";

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

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ALLOWED_EXTENSIONS[ext] || ALLOWED_MIME_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new AppError(ErrorCodes.FILE_UPLOAD_FAILED, "不支持的文件类型。允许: pdf, txt, md, docx", 400));
  }
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
    });

    sendPaginated(res, result.items, result.page, result.pageSize, result.total, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:id - document detail
router.get("/documents/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = getDocumentById(req.params.id);
    if (!doc) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
    }
    const formatted = formatDocument(doc);

    // Include file content for text-based files
    try {
      const ext = doc.file_name?.split(".").pop()?.toLowerCase() || "";
      if (["md", "txt", "markdown"].includes(ext) && doc.file_path && fs.existsSync(doc.file_path)) {
        formatted.content = fs.readFileSync(doc.file_path, "utf-8");
      }
    } catch {}

    sendSuccess(res, formatted, req.requestId);
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

      const ext = path.extname(req.file.originalname).toLowerCase();
      const fileType = ALLOWED_EXTENSIONS[ext] || "unknown";

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
      const existing = getDocumentById(req.params.id);
      if (!existing) {
        throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
      }

      const { title, category, process, station, version, owner, security_level, tags } = req.body;

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
      const doc = getDocumentById(req.params.id);
      if (!doc) {
        throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
      }

      const deleted = softDeleteDocument(req.params.id);
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
    const db = getDb();
    const row = db.prepare(
      "SELECT snippet FROM message_sources WHERE chunk_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(req.params.chunk_id) as { snippet: string } | undefined;

    if (!row?.snippet) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "Chunk 内容不存在。", 404);
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
      const doc = getDocumentById(req.params.id);
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

export default router;
