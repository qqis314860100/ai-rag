import "dotenv/config";

export function loadConfig() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";

  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (isProduction && !jwtSecret) {
    throw new Error("JWT_SECRET must be set in production. Refusing to start with an insecure default.");
  }
  // Dev-only fallback: keeps local development friction-free, never used in production.
  const effectiveJwtSecret = jwtSecret || "battery-kb-dev-secret-key-change-in-prod";

  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5174,http://localhost:3002")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    isProduction,
    apiPort: parseInt(process.env.API_PORT ?? "3001", 10),
    databaseUrl: process.env.DATABASE_URL ?? "file:./data/app.db",
    uploadDir: process.env.UPLOAD_DIR ?? "./data/uploads",
    ragServiceUrl: process.env.RAG_SERVICE_URL ?? "http://localhost:8000",
    jwtSecret: effectiveJwtSecret,
    corsOrigins,
    // Shared secret between API gateway and RAG service (empty = RAG auth disabled)
    ragApiKey: process.env.RAG_API_KEY ?? "",
  };
}

export type Config = ReturnType<typeof loadConfig>;
