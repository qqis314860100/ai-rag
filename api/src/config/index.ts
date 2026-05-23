import "dotenv/config";

export function loadConfig() {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    apiPort: parseInt(process.env.API_PORT ?? "3001", 10),
    databaseUrl: process.env.DATABASE_URL ?? "file:./data/app.db",
    uploadDir: process.env.UPLOAD_DIR ?? "./data/uploads",
    ragServiceUrl: process.env.RAG_SERVICE_URL ?? "http://localhost:8000",
  };
}

export type Config = ReturnType<typeof loadConfig>;
