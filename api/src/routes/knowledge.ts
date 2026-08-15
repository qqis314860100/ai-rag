import { Router } from "express";
import { registerKnowledgeCardRoutes } from "./knowledge/cards";
import { registerKnowledgeFaqRoutes } from "./knowledge/faqs";
import { registerKnowledgeGapRoutes } from "./knowledge/gaps";
import { registerKnowledgeOverviewRoutes } from "./knowledge/overview";
import { registerKnowledgeTermRoutes } from "./knowledge/terms";

const router = Router();

registerKnowledgeOverviewRoutes(router);
registerKnowledgeTermRoutes(router);
registerKnowledgeCardRoutes(router);
registerKnowledgeFaqRoutes(router);
registerKnowledgeGapRoutes(router);

export default router;
