import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { sendError } from "../utils/response";
import { logger } from "./requestLogger";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.locals.errorCode = err.code;
    if (err.statusCode >= 500) {
      logger.error(
        {
          request_id: req.requestId,
          error_code: err.code,
          error_message: err.message,
          stack: err.stack,
        },
        "application error"
      );
    }
    sendError(
      res,
      err.code,
      err.message,
      err.statusCode,
      err.detail,
      req.requestId
    );
    return;
  }

  // Handle body-parser errors (malformed JSON, oversized payload) as client errors
  const bodyErr = err as unknown as { type?: string; status?: number };
  if (bodyErr.type === "entity.parse.failed" || bodyErr.type === "entity.too.large") {
    sendError(
      res,
      "VALIDATION_ERROR",
      bodyErr.type === "entity.too.large" ? "请求体过大。" : "请求体不是合法的 JSON。",
      bodyErr.status && bodyErr.status >= 400 && bodyErr.status < 500 ? bodyErr.status : 400,
      undefined,
      req.requestId
    );
    return;
  }

  // Handle multer errors
  if (err.name === "MulterError") {
    const multerErr = err as unknown as { code: string; field?: string };
    res.locals.errorCode = "FILE_UPLOAD_FAILED";
    sendError(
      res,
      "FILE_UPLOAD_FAILED",
      `文件上传失败: ${err.message}`,
      400,
      { multer_code: multerErr.code, field: multerErr.field },
      req.requestId
    );
    return;
  }

  // Handle unexpected errors
  logger.error(
    {
      request_id: req.requestId,
      error_message: err.message,
      stack: err.stack,
    },
    "unexpected error"
  );

  res.locals.errorCode = "INTERNAL_ERROR";
  sendError(
    res,
    "INTERNAL_ERROR",
    "服务器内部错误。",
    500,
    undefined,
    req.requestId
  );
}
