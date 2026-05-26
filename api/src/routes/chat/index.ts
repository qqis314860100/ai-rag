import { Router } from "express";
import messagesRouter from "./messages";
import sessionsRouter from "./sessions";
import notesRouter from "./notes";
import sourcesRouter from "./sources";
import artifactsRouter from "./artifacts";

const router = Router();

router.use(messagesRouter);
router.use(sessionsRouter);
router.use(notesRouter);
router.use(sourcesRouter);
router.use(artifactsRouter);

export default router;
