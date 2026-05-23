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

// GET /api/documents/:id/raw - return original file content for inline preview
router.get("/documents/:id/raw", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = getDocumentById(req.params.id as string);
    if (!doc) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档不存在。", 404);
    }

    let content: string | null = null;
    const knowledgeDir = path.resolve(config.uploadDir, "../../knowledge");

    // Strategy 1: direct file_path
    if (doc.file_path && fs.existsSync(doc.file_path)) {
      content = fs.readFileSync(doc.file_path, "utf-8");
    }

    // Strategy 2: use section_path to find the document file
    // e.g. "极柱Busbar激光焊接 / 5. 安全注意事项" → look for "极柱Busbar激光焊接.md"
    const sectionPath = req.query.section_path as string | undefined;
    if (!content && sectionPath && fs.existsSync(knowledgeDir)) {
      const docName = sectionPath.split(" / ")[0]?.trim();
      if (docName) {
        for (const ext of [".md", ".txt", ".markdown"]) {
          const p = path.join(knowledgeDir, `${docName}${ext}`);
          if (fs.existsSync(p)) { content = fs.readFileSync(p, "utf-8"); break; }
        }
      }
    }

    // Strategy 3: search by title in knowledge dir
    if (!content) {
      for (const ext of [".md", ".txt", ".markdown"]) {
        const p = path.join(knowledgeDir, `${doc.title}${ext}`);
        if (fs.existsSync(p)) { content = fs.readFileSync(p, "utf-8"); break; }
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

    const filePath = doc.file_path;
    if (!fs.existsSync(filePath)) {
      // Try to find by title in knowledge directory
      const knowledgeDir = path.resolve(loadConfig().uploadDir, "../../knowledge");
      const altPath = path.join(knowledgeDir, `${doc.title}.md`);
      if (fs.existsSync(altPath)) {
        const content = fs.readFileSync(altPath, "utf-8");
        res.type("text/markdown").send(content);
        return;
      }
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "文档文件不存在。", 404);
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".pdf": "application/pdf",
      ".md": "text/markdown",
      ".txt": "text/plain",
      ".markdown": "text/markdown",
    };
    res.type(mimeTypes[ext] || "application/octet-stream");
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    next(err);
  }
});

// POST /api/documents/sync-from-rag - sync documents from RAG/Chroma into SQLite
router.post("/documents/sync-from-rag", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = loadConfig();
    const ragUrl = `${config.ragServiceUrl}/rag/documents`;

    const response = await fetch(ragUrl, { signal: AbortSignal.timeout(10000) });
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

        createDocument({
          title: rd.title,
          category: rd.category || "未分类",
          securityLevel: "internal",
          filePath,
          fileName,
          fileType,
          fileSize,
          createdBy: req.user?.id,
        });
        // Override the generated ID with the RAG document_id
        const db = getDb();
        const now = new Date().toISOString();
        // Update the most recently created document to have the RAG document_id
        const latest = db.prepare("SELECT id FROM documents ORDER BY created_at DESC LIMIT 1").get() as { id: string } | undefined;
        if (latest) {
          db.prepare("UPDATE documents SET id = ?, chunk_count = ?, index_status = 'ready' WHERE id = ?")
            .run(rd.document_id, rd.chunk_count, latest.id);
          // Also update message_sources that reference this document_id
          db.prepare("UPDATE message_sources SET document_id = ? WHERE document_id = ?")
            .run(rd.document_id, latest.id);
        }
        created++;
      }
    }

    auditFromRequest(req, "document.sync", "document", undefined, { created, updated, total: ragDocs.length });

    sendSuccess(res, { created, updated, total: ragDocs.length }, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
