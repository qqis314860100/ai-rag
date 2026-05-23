import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError, ErrorCodes } from "../utils/errors";
import { ROLE_PERMISSIONS, ROLE_SECURITY_LEVELS } from "./auth";

const JWT_SECRET = process.env.JWT_SECRET || "battery-kb-dev-secret-key-change-in-prod";
const JWT_EXPIRES_IN = "24h";

export interface JwtPayload {
  sub: string;
  name: string;
  role: string;
}

export function signToken(user: { id: string; name: string; role: string }): string {
  return jwt.sign({ sub: user.id, name: user.name, role: user.role } as JwtPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError(ErrorCodes.AUTHENTICATION_REQUIRED, "请先登录。", 401);
  }
  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    const role = ROLE_SECURITY_LEVELS[payload.role] ? payload.role : "viewer";
    req.user = {
      id: payload.sub,
      name: payload.name,
      role,
      permissions: ROLE_PERMISSIONS[role] || [],
      allowedSecurityLevels: ROLE_SECURITY_LEVELS[role] || ["public"],
    };
    next();
  } catch {
    throw new AppError(ErrorCodes.AUTHENTICATION_REQUIRED, "登录已过期，请重新登录。", 401);
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const payload = verifyToken(header.slice(7));
      const role = ROLE_SECURITY_LEVELS[payload.role] ? payload.role : "viewer";
      req.user = {
        id: payload.sub,
        name: payload.name,
        role,
        permissions: ROLE_PERMISSIONS[role] || [],
        allowedSecurityLevels: ROLE_SECURITY_LEVELS[role] || ["public"],
      };
    } catch {
      // ignore invalid tokens in optional auth
    }
  }
  next();
}
