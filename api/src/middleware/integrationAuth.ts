import { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { findActiveIntegrationTokenByHash, markIntegrationTokenUsed, parseAllowedLevels } from "../db/integrationTokens";
import { AppError, ErrorCodes } from "../utils/errors";

const VALID_SECURITY_LEVELS = new Set(["public", "internal", "confidential", "restricted"]);

interface IntegrationToken {
  clientId: string;
  tokenHash: string;
}

interface RateBucket {
  windowStart: number;
  count: number;
}

const rateBuckets = new Map<string, RateBucket>();

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseTokenEntry(entry: string, index: number): IntegrationToken | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const separator = trimmed.indexOf(":");
  const clientId = separator > 0 ? trimmed.slice(0, separator).trim() : `client_${index + 1}`;
  const secret = separator > 0 ? trimmed.slice(separator + 1).trim() : trimmed;
  if (!secret) return null;

  const tokenHash = secret.startsWith("sha256:")
    ? secret.slice("sha256:".length)
    : hashToken(secret);
  return { clientId, tokenHash };
}

function configuredTokens(): IntegrationToken[] {
  return (process.env.INTEGRATION_API_TOKENS ?? "")
    .split(",")
    .map(parseTokenEntry)
    .filter((token): token is IntegrationToken => Boolean(token));
}

function tokenFromRequest(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const headerToken = req.headers["x-api-token"];
  return typeof headerToken === "string" ? headerToken.trim() : "";
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function allowedSecurityLevels(): string[] {
  const raw = process.env.INTEGRATION_ALLOWED_SECURITY_LEVELS ?? "public,internal";
  const levels = raw
    .split(",")
    .map((level) => level.trim())
    .filter((level) => VALID_SECURITY_LEVELS.has(level));
  return levels.length > 0 ? levels : ["public"];
}

function activeDbToken(tokenHash: string) {
  try {
    return findActiveIntegrationTokenByHash(tokenHash);
  } catch {
    return null;
  }
}

export function requireIntegrationToken(req: Request, _res: Response, next: NextFunction): void {
  const providedToken = tokenFromRequest(req);
  if (!providedToken) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, "缺少集成 API Token。", 401);
  }

  const providedHash = hashToken(providedToken);
  const dbToken = activeDbToken(providedHash);
  if (dbToken) {
    try {
      markIntegrationTokenUsed(dbToken.id);
    } catch {
      // Token 使用时间更新失败不应阻断已经通过的鉴权请求。
    }
    req.integration = {
      tokenId: dbToken.id,
      clientId: dbToken.client_id,
      tokenHash: dbToken.token_hash.slice(0, 16),
      allowedSecurityLevels: parseAllowedLevels(dbToken),
    };
    req.user = {
      id: `integration:${dbToken.client_id}`,
      name: dbToken.client_id,
      role: "integration_client",
      permissions: ["document.read", "chat.use"],
      allowedSecurityLevels: req.integration.allowedSecurityLevels,
    };
    next();
    return;
  }

  const tokens = configuredTokens();
  if (tokens.length === 0) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, "集成 API Token 未配置。", 401);
  }

  const matched = tokens.find((token) => secureEquals(token.tokenHash, providedHash));
  if (!matched) {
    throw new AppError(ErrorCodes.UNAUTHORIZED, "集成 API Token 无效。", 401);
  }

  req.integration = {
    clientId: matched.clientId,
    tokenHash: matched.tokenHash.slice(0, 16),
    allowedSecurityLevels: allowedSecurityLevels(),
  };
  req.user = {
    id: `integration:${matched.clientId}`,
    name: matched.clientId,
    role: "integration_client",
    permissions: ["document.read", "chat.use"],
    allowedSecurityLevels: req.integration.allowedSecurityLevels,
  };
  next();
}

export function integrationRateLimit(req: Request, res: Response, next: NextFunction): void {
  const limit = Number(process.env.INTEGRATION_RATE_LIMIT_PER_MINUTE ?? "60");
  if (!Number.isFinite(limit) || limit <= 0) {
    next();
    return;
  }

  const now = Date.now();
  const windowMs = 60_000;
  const key = req.integration?.tokenHash || req.ip || "anonymous";
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    rateBuckets.set(key, { windowStart: now, count: 1 });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    res.setHeader("Retry-After", String(Math.ceil((windowMs - (now - bucket.windowStart)) / 1000)));
    throw new AppError(ErrorCodes.RATE_LIMITED, "集成 API 请求过于频繁。", 429);
  }

  next();
}
