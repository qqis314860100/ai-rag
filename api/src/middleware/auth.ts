import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError, ErrorCodes } from "../utils/errors";
import { getDb } from "../db/index";
import { loadConfig } from "../config";

const config = loadConfig();

export const ROLE_SECURITY_LEVELS: Record<string, string[]> = {
  viewer: ["public"],
  operator: ["public", "internal"],
  process_engineer: ["public", "internal", "confidential"],
  equipment_engineer: ["public", "internal", "confidential"],
  quality_engineer: ["public", "internal", "confidential"],
  safety_admin: ["public", "internal", "confidential"],
  knowledge_admin: ["public", "internal", "confidential", "restricted"],
  system_admin: ["public", "internal", "confidential", "restricted"],
};

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  viewer: ["document.read", "chat.use"],
  operator: ["document.read", "chat.use", "feedback.create"],
  process_engineer: [
    "document.read",
    "document.upload",
    "document.update",
    "chat.use",
    "search.debug",
    "feedback.create",
  ],
  equipment_engineer: [
    "document.read",
    "document.upload",
    "document.update",
    "chat.use",
    "search.debug",
    "feedback.create",
  ],
  quality_engineer: [
    "document.read",
    "document.upload",
    "document.update",
    "chat.use",
    "search.debug",
    "feedback.create",
  ],
  safety_admin: [
    "document.read",
    "document.upload",
    "document.update",
    "chat.use",
    "search.debug",
    "feedback.create",
  ],
  knowledge_admin: [
    "document.read",
    "document.upload",
    "document.update",
    "document.delete",
    "document.reindex",
    "chat.use",
    "search.debug",
    "feedback.manage",
    "evaluation.run",
  ],
  system_admin: [
    "document.read",
    "document.upload",
    "document.update",
    "document.delete",
    "document.reindex",
    "chat.use",
    "search.debug",
    "feedback.manage",
    "evaluation.run",
    "settings.update",
    "audit.read",
  ],
};

function roleToUser(role: string): { role: string; permissions: string[]; allowedSecurityLevels: string[] } {
  const normalized = ROLE_SECURITY_LEVELS[role] ? role : "viewer";
  return {
    role: normalized,
    permissions: ROLE_PERMISSIONS[normalized] || [],
    allowedSecurityLevels: ROLE_SECURITY_LEVELS[normalized] || ["public"],
  };
}

function verifyJwtUser(token: string): { id: string; name: string } & ReturnType<typeof roleToUser> | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; name: string; role: string };
    if (!payload.sub) return null;
    return { id: payload.sub, name: payload.name || payload.sub, ...roleToUser(payload.role) };
  } catch {
    return null;
  }
}

export function extractUser(req: Request, _res: Response, next: NextFunction): void {
  // 1. JWT takes precedence — the only accepted credential in production.
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const user = verifyJwtUser(authHeader.slice(7));
    if (user) {
      req.user = user;
      return next();
    }
    // Invalid token: in production we must not silently fall through to
    // header-based auth, which would turn a forged header into privileges.
    if (config.isProduction) {
      req.user = { id: "anonymous", name: "访客", role: "viewer", permissions: ROLE_PERMISSIONS["viewer"], allowedSecurityLevels: ["public"] };
      return next();
    }
  }

  // 2. Dev-only conveniences — NEVER enabled in production:
  //    - header impersonation (x-user-id / x-user-role)
  //    - default to the DB "system"/"admin" user when unauthenticated
  if (!config.isProduction) {
    const userId = req.headers["x-user-id"] as string | undefined;
    const userRole = req.headers["x-user-role"] as string | undefined;

    if (userId && userRole) {
      req.user = {
        id: userId,
        name: (req.headers["x-user-name"] as string) || userId,
        ...roleToUser(userRole),
      };
      return next();
    }

    try {
      const db = getDb();
      const sys = db.prepare("SELECT id, name, role FROM users WHERE name='system' LIMIT 1").get() as { id: string; name: string; role: string } | undefined;
      const user = sys || db.prepare("SELECT id, name, role FROM users WHERE name='admin' LIMIT 1").get() as { id: string; name: string; role: string } | undefined;
      if (user) {
        req.user = { id: user.id, name: user.name, ...roleToUser(user.role) };
        return next();
      }
    } catch {
      // DB not ready yet — fall through to anonymous
    }
  }

  // 3. Anonymous fallback: lowest privilege, no permissions.
  req.user = { id: "anonymous", name: "访客", role: "viewer", permissions: ROLE_PERMISSIONS["viewer"], allowedSecurityLevels: ["public"] };
  next();
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AppError(ErrorCodes.UNAUTHORIZED, "未登录。", 401);
    }

    const hasPermission = permissions.some((p) =>
      req.user!.permissions.includes(p)
    );

    if (!hasPermission) {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        "当前用户无权限执行该操作。",
        403
      );
    }

    next();
  };
}

export function getSecurityLevelsForRequest(req: Request): string[] {
  return req.user?.allowedSecurityLevels ?? ["public"];
}
