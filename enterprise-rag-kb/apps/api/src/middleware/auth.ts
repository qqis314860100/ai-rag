import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError, ErrorCodes } from "../utils/errors";
import { getDb } from "../db/index";

const ROLE_SECURITY_LEVELS: Record<string, string[]> = {
  viewer: ["public"],
  operator: ["public", "internal"],
  process_engineer: ["public", "internal", "confidential"],
  equipment_engineer: ["public", "internal", "confidential"],
  quality_engineer: ["public", "internal", "confidential"],
  safety_admin: ["public", "internal", "confidential"],
  knowledge_admin: ["public", "internal", "confidential", "restricted"],
  system_admin: ["public", "internal", "confidential", "restricted"],
};

const ROLE_PERMISSIONS: Record<string, string[]> = {
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

export function extractUser(req: Request, _res: Response, next: NextFunction): void {
  // JWT takes precedence
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const secret = process.env.JWT_SECRET || "battery-kb-dev-secret-key-change-in-prod";
      const payload = jwt.verify(authHeader.slice(7), secret) as { sub: string; name: string; role: string };
      const role = ROLE_SECURITY_LEVELS[payload.role] ? payload.role : "viewer";
      req.user = {
        id: payload.sub,
        name: payload.name,
        role,
        permissions: ROLE_PERMISSIONS[role] || [],
        allowedSecurityLevels: ROLE_SECURITY_LEVELS[role] || ["public"],
      };
      return next();
    } catch {
      // Invalid JWT — fall through to header-based or default
    }
  }

  // Fallback: header-based (dev mode)
  const userId = req.headers["x-user-id"] as string | undefined;
  const userRole = req.headers["x-user-role"] as string | undefined;

  if (userId && userRole) {
    const role = ROLE_SECURITY_LEVELS[userRole] ? userRole : "viewer";
    req.user = {
      id: userId,
      name: (req.headers["x-user-name"] as string) || userId,
      role,
      permissions: ROLE_PERMISSIONS[role] || [],
      allowedSecurityLevels: ROLE_SECURITY_LEVELS[role] || ["public"],
    };
  } else {
    // Default to admin user from DB
    try {
      const db = getDb();
      const admin = db.prepare("SELECT id, name, role FROM users WHERE name='admin' LIMIT 1").get() as { id: string; name: string; role: string } | undefined;
      if (admin) {
        req.user = {
          id: admin.id,
          name: admin.name,
          role: admin.role,
          permissions: ROLE_PERMISSIONS[admin.role] || [],
          allowedSecurityLevels: ROLE_SECURITY_LEVELS[admin.role] || ["public"],
        };
        return next();
      }
    } catch {}

    const defaultRole = "system_admin";
    req.user = {
      id: "user_system",
      name: "系统管理员",
      role: defaultRole,
      permissions: ROLE_PERMISSIONS[defaultRole] || [],
      allowedSecurityLevels: ROLE_SECURITY_LEVELS[defaultRole] || [],
    };
  }

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
