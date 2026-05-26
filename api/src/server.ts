import express from "express";
import cors from "cors";
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

const config = loadConfig();

const app = express();

// Base middleware
app.use(cors({ origin: ["http://localhost:5174", "http://localhost:3002"], credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Request context (adds requestId)
app.use(requestContext);

// Request logging
app.use(requestLogger);

// 用户提取：生产环境只接受有效 JWT，开发环境允许请求头和默认用户辅助联调。
app.use(extractUser);

// API Routes
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

// Error handler (must be registered last)
app.use(errorHandler);

// Initialize database
initDb(config.databaseUrl);

app.listen(config.apiPort, () => {
  console.log(`API Gateway running on http://localhost:${config.apiPort}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`RAG Service: ${config.ragServiceUrl}`);
  console.log(`Upload Dir: ${config.uploadDir}`);
});

export default app;
