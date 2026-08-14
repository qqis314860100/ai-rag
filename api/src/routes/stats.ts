import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/index";
import { sendSuccess } from "../utils/response";
import { requireAuth } from "../middleware/jwtAuth";

const router = Router();

// GET /api/stats/dashboard — aggregated dashboard stats (authenticated users only;
// the data contains other users' sessions and queries)
router.get("/stats/dashboard", requireAuth, (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();

    const docTotal = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE status='active'").get() as { c: number }).c;
    const docIndexed = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE status='active' AND index_status='ready'").get() as { c: number }).c;
    const docProcessing = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE index_status='processing'").get() as { c: number }).c;
    const docFailed = (db.prepare("SELECT COUNT(*) as c FROM documents WHERE index_status='failed'").get() as { c: number }).c;
    const sessionsTotal = (db.prepare("SELECT COUNT(*) as c FROM chat_sessions").get() as { c: number }).c;
    const sessionsToday = (db.prepare("SELECT COUNT(*) as c FROM chat_sessions WHERE date(created_at)=date('now')").get() as { c: number }).c;
    const messagesTotal = (db.prepare("SELECT COUNT(*) as c FROM chat_messages").get() as { c: number }).c;
    const feedbackUp = (db.prepare("SELECT COUNT(*) as c FROM feedback WHERE rating='up'").get() as { c: number }).c;
    const feedbackDown = (db.prepare("SELECT COUNT(*) as c FROM feedback WHERE rating='down'").get() as { c: number }).c;
    const feedbackOpen = (db.prepare("SELECT COUNT(*) as c FROM feedback WHERE status='open'").get() as { c: number }).c;

    // Document category distribution
    const cats = db.prepare("SELECT category, COUNT(*) as c FROM documents WHERE status='active' GROUP BY category ORDER BY c DESC").all() as Array<{ category: string; c: number }>;

    // Recent activity (last 10 sessions)
    const recentSessions = db.prepare("SELECT cs.id, cs.title, cs.updated_at, u.name as user_name FROM chat_sessions cs LEFT JOIN users u ON cs.user_id = u.id ORDER BY cs.updated_at DESC LIMIT 10").all() as Array<{ id: string; title: string; updated_at: string; user_name: string }>;

    // Popular search queries (from recent chat sessions)
    const popularQueries = db.prepare("SELECT SUBSTR(cm.content,1,40) as query, cm.created_at FROM chat_messages cm WHERE cm.role='user' ORDER BY cm.created_at DESC LIMIT 10").all() as Array<{ query: string; created_at: string }>;

    sendSuccess(res, {
      documents: { total: docTotal, indexed: docIndexed, processing: docProcessing, failed: docFailed },
      sessions: { total: sessionsTotal, today: sessionsToday },
      messages: { total: messagesTotal },
      feedback: { up: feedbackUp, down: feedbackDown, open: feedbackOpen },
      categories: cats.map(r => ({ category: r.category, count: r.c })),
      recentSessions: recentSessions.map(r => ({ id: r.id, title: r.title, user_name: r.user_name || "-", updated_at: r.updated_at })),
      popularQueries: popularQueries.map(r => ({ query: r.query, time: r.created_at })),
    }, _req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/feedback-counts?message_ids=id1,id2
router.get("/stats/feedback-counts", requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const ids = ((req.query.message_ids as string) || "").split(",").filter(Boolean);
    const counts: Record<string, { up: number; down: number; userVote?: string }> = {};

    for (const msgId of ids) {
      const up = (db.prepare("SELECT COUNT(*) as c FROM feedback WHERE message_id=? AND rating='up'").get(msgId) as { c: number }).c;
      const down = (db.prepare("SELECT COUNT(*) as c FROM feedback WHERE message_id=? AND rating='down'").get(msgId) as { c: number }).c;
      const userVote = req.user ? (db.prepare("SELECT rating FROM feedback WHERE message_id=? AND user_id=? LIMIT 1").get(msgId, req.user.id) as { rating: string } | undefined) : undefined;
      counts[msgId] = { up, down, userVote: userVote?.rating };
    }
    sendSuccess(res, counts, req.requestId);
  } catch (err) {
    next(err);
  }
});

// POST /api/stats/browse — track a browse event
router.post("/stats/browse", (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const { event_type, resource_type, resource_id, metadata } = req.body;
    const userId = req.user?.id || "anonymous";
    const now = new Date().toISOString();

    db.prepare("INSERT INTO browse_history (id, user_id, event_type, resource_type, resource_id, metadata_json, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(uuidv4(), userId, event_type, resource_type || null, resource_id || null, JSON.stringify(metadata || {}), now);

    sendSuccess(res, { ok: true }, req.requestId);
  } catch (err) {
    next(err);
  }
});

// GET /api/stats/browse — browse history for current user
router.get("/stats/browse", (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb();
    const userId = req.user?.id || "anonymous";
    const limit = parseInt(req.query.limit as string) || 20;

    const rows = db.prepare("SELECT * FROM browse_history WHERE user_id=? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as Array<{ id: string; event_type: string; resource_type: string; resource_id: string; metadata_json: string; created_at: string }>;

    sendSuccess(res, rows.map(r => ({
      id: r.id, event_type: r.event_type, resource_type: r.resource_type,
      resource_id: r.resource_id, metadata: JSON.parse(r.metadata_json || "{}"), created_at: r.created_at,
    })), req.requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
