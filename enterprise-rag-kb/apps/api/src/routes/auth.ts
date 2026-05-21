import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { signToken, requireAuth } from "../middleware/jwtAuth";
import { sendSuccess } from "../utils/response";
import { AppError, ErrorCodes } from "../utils/errors";
import { getUserByName, getUserById, listUsers } from "../db/users";
import { requirePermission } from "../middleware/auth";

const router = Router();

// POST /api/auth/login
router.post("/auth/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "用户名和密码不能为空。", 400);
    }

    const user = getUserByName(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new AppError(ErrorCodes.AUTHENTICATION_REQUIRED, "用户名或密码错误。", 401);
    }

    const token = signToken({ id: user.id, name: user.name, role: user.role });

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

export default router;
