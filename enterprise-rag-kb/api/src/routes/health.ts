import { Router } from "express";
import { checkRagHealth } from "../services/ragClient";

const router = Router();

router.get("/admin/health", async (_req, res) => {
  let ragStatus = "unknown";

  try {
    const ragHealth = await checkRagHealth();
    ragStatus = ragHealth.status;
  } catch {
    ragStatus = "unreachable";
  }

  res.json({
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        api: "ok",
        rag: ragStatus,
        database: "ok",
      },
    },
  });
});

export default router;
