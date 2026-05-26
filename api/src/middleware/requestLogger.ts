import { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import pino from "pino";
import { recordRequestMetric } from "../services/metricsService";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
});

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const routePath = req.path || req.originalUrl.split("?")[0] || req.originalUrl;
    const queryText = req.originalUrl.includes("?") ? req.originalUrl.split("?").slice(1).join("?") : "";
    const logData: Record<string, unknown> = {
      request_id: req.requestId,
      requestId: req.requestId,
      method: req.method,
      route: routePath,
      userId: req.user?.id ?? "anonymous",
      status: res.statusCode,
      status_code: res.statusCode,
      duration_ms: durationMs,
      error_code: res.locals.errorCode,
    };
    if (queryText) {
      logData.query_hash = hashText(queryText);
      logData.query_chars = queryText.length;
    }
    recordRequestMetric({
      route: routePath,
      method: req.method,
      status: res.statusCode,
      durationMs,
      errorCode: typeof res.locals.errorCode === "string" ? res.locals.errorCode : undefined,
    });

    if (req.user) {
      logData.user_id = req.user.id;
    }
    if (req.integration) {
      logData.integration_client_id = req.integration.clientId;
    }

    if (res.statusCode >= 500) {
      logger.error(logData, "request completed with error");
    } else if (res.statusCode >= 400) {
      logger.warn(logData, "request completed with client error");
    } else {
      logger.info(logData, "request completed");
    }
  });

  next();
}

export { logger };
