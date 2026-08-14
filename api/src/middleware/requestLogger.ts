import { Request, Response, NextFunction } from "express";
import pino from "pino";

// Structured JSON logs in production (no worker threads — bundle-friendly);
// pretty console output in development.
const logger = pino(
  process.env.NODE_ENV === "production"
    ? { level: "info" }
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
        level: "debug",
      }
);

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const logData: Record<string, unknown> = {
      request_id: req.requestId,
      method: req.method,
      route: req.originalUrl,
      status_code: res.statusCode,
      duration_ms: durationMs,
    };

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
