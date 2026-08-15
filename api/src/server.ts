import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { initDb } from "./db";
import { loadConfig } from "./config";
import { requestContext } from "./middleware/requestContext";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import { extractUser } from "./middleware/auth";
import healthRouter from "./routes/health";
import documentsRouter from "./routes/documents";
import searchRouter from "./routes/search";
import chatRouter from "./routes/chat";
import feedbackRouter from "./routes/feedback";
import favoritesRouter from "./routes/favorites";
import authRouter from "./routes/auth";
import statsRouter from "./routes/stats";
import adminRouter from "./routes/admin";
import knowledgeRouter from "./routes/knowledge";
import integrationRouter from "./routes/integration";
import integrationTokensRouter from "./routes/integrationTokens";

const config = loadConfig();

const app = express();
app.set("trust proxy", 1); // behind a reverse proxy the real client IP is used for rate limiting

// Security headers (CSP disabled: Tailwind + Google Fonts rely on inline styles;
// enable a strict CSP in front of the app when serving the built bundle)
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — explicit allowlist from env, never "*"
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// ── Rate limiting ──
const limiterMessage = {
  error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试。" },
};
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: limiterMessage,
});
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10, // login brute-force protection
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: limiterMessage,
});
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30, // LLM cost guard
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: limiterMessage,
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: limiterMessage,
});

app.use("/api", apiLimiter);

// Request context (adds requestId)
app.use(requestContext);

// Request logging
app.use(requestLogger);

// 企业受控集成接口使用独立 API Token，不复用用户会话。
app.use("/api", integrationRouter);

// 用户提取：生产环境只接受有效 JWT，开发环境允许请求头和默认用户辅助联调。
app.use(extractUser);

// API Routes — rate limiters must be registered before the routers they protect
app.use("/api/auth/login", authLimiter);
app.use("/api/chat", chatLimiter);
app.use("/api/documents/upload", uploadLimiter);
app.use("/api", healthRouter);
app.use("/api", documentsRouter);
app.use("/api", searchRouter);
app.use("/api", chatRouter);
app.use("/api", feedbackRouter);
app.use("/api", favoritesRouter);
app.use("/api", authRouter);
app.use("/api", statsRouter);
app.use("/api", adminRouter);
app.use("/api", knowledgeRouter);
app.use("/api", integrationTokensRouter);

// Error handler (must be registered last)
app.use(errorHandler);

// Initialize database
initDb(config.databaseUrl);

app.listen(config.apiPort, () => {
  console.log(`API Gateway running on http://localhost:${config.apiPort}`);
  console.log(`Environment: ${config.nodeEnv}${config.isProduction ? " (production)" : ""}`);
  console.log(`RAG Service: ${config.ragServiceUrl}`);
  console.log(`Upload Dir: ${config.uploadDir}`);
  console.log(`CORS origins: ${config.corsOrigins.join(", ")}`);
});

export default app;
