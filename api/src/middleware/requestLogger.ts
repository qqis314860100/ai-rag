import { Request, Response, NextFunction } from "express";
import pino from "pino";
import { recordRequestMetric } from "../services/metricsService";

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
});

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const logData: Record<string, unknown> = {
      request_id: req.requestId,
      requestId: req.requestId,
      method: req.method,
      route: req.originalUrl,
      userId: req.user?.id ?? "anonymous",
      status: res.statusCode,
      status_code: res.statusCode,
      duration_ms: durationMs,
      error_code: res.locals.errorCode,
    };
    recordRequestMetric({
      route: req.originalUrl,
      method: req.method,
      status: res.statusCode,
      durationMs,
      errorCode: typeof res.locals.errorCode === "string" ? res.locals.errorCode : undefined,
    });

    if (req.user) {
      logData.user_id = req.user.id;
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
