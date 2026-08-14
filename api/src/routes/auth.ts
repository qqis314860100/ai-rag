import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { signToken, requireAuth } from "../middleware/jwtAuth";
import { sendSuccess } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";
import { getUserByName, getUserById, listUsers, updateUser } from "../db/users";
import { requirePermission } from "../middleware/auth";
import { auditFromRequest } from "../services/auditService";

const router = Router();

const VALID_ROLES = ["viewer", "operator", "process_engineer", "equipment_engineer", "quality_engineer", "safety_admin", "knowledge_admin", "system_admin"];
const VALID_STATUSES = ["active", "disabled"];

// POST /api/auth/login
router.post("/auth/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "用户名和密码不能为空。", 400);
    }
    if (typeof username !== "string" || typeof password !== "string" || password.length > 128) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "用户名或密码格式不正确。", 400);
    }

    const user = getUserByName(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      auditFromRequest(req, "auth.login_failed", "user", undefined, { username: username.substring(0, 100) });
      throw new AppError(ErrorCodes.AUTHENTICATION_REQUIRED, "用户名或密码错误。", 401);
    }
    if (user.status !== "active") {
      throw new AppError(ErrorCodes.AUTHENTICATION_REQUIRED, "账号已停用，请联系管理员。", 403);
    }

    const token = signToken({ id: user.id, name: user.name, role: user.role });

    auditFromRequest(req, "auth.login", "user", user.id, { username: user.name });

    sendSuccess(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get("/auth/me", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getUserById(req.user!.id);
    if (!user) {
      throw new AppError(ErrorCodes.AUTHENTICATION_REQUIRED, "用户不存在。", 401);
    }
    sendSuccess(res, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/users — admin only
router.get("/users", requireAuth, requirePermission("settings.update"), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = listUsers();
    sendSuccess(res, users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      created_at: u.created_at,
    })), _req.requestId);
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/:id — admin only: update role / status (used by the settings page)
router.put("/users/:id", requireAuth, requirePermission("settings.update"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.params.id as string;
    const user = getUserById(userId);
    if (!user) {
      throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "用户不存在。", 404);
    }
    if (user.name === "system") {
      throw new AppError(ErrorCodes.FORBIDDEN, "系统内置用户不可修改。", 403);
    }

    const { role, status } = req.body as { role?: string; status?: string };
    const updates: { role?: string; status?: string } = {};

    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, `role 必须是 ${VALID_ROLES.join("/")} 之一。`, 400);
      }
      updates.role = role;
    }
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        throw new AppError(ErrorCodes.VALIDATION_ERROR, "status 必须是 active/disabled 之一。", 400);
      }
      updates.status = status;
    }
    if (Object.keys(updates).length === 0) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "请提供 role 或 status。", 400);
    }

    // Prevent an admin from locking themselves out
    if (userId === req.user!.id && updates.status === "disabled") {
      throw new AppError(ErrorCodes.FORBIDDEN, "不能停用自己的账号。", 403);
    }

    updateUser(userId, updates);

    auditFromRequest(req, "user.update", "user", userId, {
      changes: Object.keys(updates),
    });

    sendSuccess(res, { id: userId, updated: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
