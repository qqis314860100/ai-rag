import { getDb } from "../db";

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value || "") as T;
  } catch {
    return fallback;
  }
}

function likeDocumentRef(documentId: string) {
  return `%"document_id":"${documentId}"%`;
}

export function buildDocumentInsights(documentId: string) {
  const db = getDb();

  const askedQuestions = db.prepare(
    `SELECT
       a.id AS answer_message_id,
       a.session_id,
       COALESCE(u.content, '') AS question,
       substr(a.content, 1, 240) AS answer_preview,
       COUNT(ms.id) AS source_hit_count,
       MAX(ms.score) AS top_score,
       a.created_at
     FROM message_sources ms
     JOIN chat_messages a ON a.id = ms.message_id AND a.role = 'assistant'
     LEFT JOIN chat_messages u ON u.id = (
       SELECT id
       FROM chat_messages
       WHERE session_id = a.session_id
         AND role = 'user'
         AND created_at < a.created_at
       ORDER BY created_at DESC
       LIMIT 1
     )
     WHERE ms.document_id = ?
     GROUP BY a.id
     ORDER BY a.created_at DESC
     LIMIT 12`
  ).all(documentId);

  const retrievalContribution = db.prepare(
    `SELECT
       COUNT(ms.id) AS source_hit_count,
       COUNT(DISTINCT ms.message_id) AS answer_count,
       COUNT(DISTINCT COALESCE(ms.section_path, '')) AS section_count,
       AVG(ms.score) AS avg_score,
       MAX(ms.score) AS top_score,
       MAX(ms.created_at) AS last_hit_at
     FROM message_sources ms
     WHERE ms.document_id = ?`
  ).get(documentId) as Record<string, unknown>;

  const cardRows = db.prepare(
    `SELECT id, topic AS title, status, current_version AS version, source_refs_json, updated_at
     FROM knowledge_cards
     WHERE status != 'archived' AND source_refs_json LIKE ?
     ORDER BY updated_at DESC
     LIMIT 10`
  ).all(likeDocumentRef(documentId)) as Array<Record<string, unknown> & { source_refs_json: string }>;
  const faqRows = db.prepare(
    `SELECT id, question AS title, status, 1 AS version, source_refs_json, updated_at
     FROM knowledge_faqs
     WHERE status != 'archived' AND source_refs_json LIKE ?
     ORDER BY updated_at DESC
     LIMIT 10`
  ).all(likeDocumentRef(documentId)) as Array<Record<string, unknown> & { source_refs_json: string }>;
  const termRows = db.prepare(
    `SELECT id, canonical_term AS title, status, metadata_json, source_refs_json, updated_at
     FROM terminology_terms
     WHERE status != 'archived' AND source_refs_json LIKE ?
     ORDER BY updated_at DESC
     LIMIT 10`
  ).all(likeDocumentRef(documentId)) as Array<Record<string, unknown> & { source_refs_json: string; metadata_json: string }>;

  const knowledgeAssets = [
    ...cardRows.map((row) => ({
      asset_type: "knowledge_card",
      id: row.id,
      title: row.title,
      status: row.status,
      version: row.version,
      source_count: parseJson<unknown[]>(row.source_refs_json, []).length,
      updated_at: row.updated_at,
    })),
    ...faqRows.map((row) => ({
      asset_type: "faq",
      id: row.id,
      title: row.title,
      status: row.status,
      version: row.version,
      source_count: parseJson<unknown[]>(row.source_refs_json, []).length,
      updated_at: row.updated_at,
    })),
    ...termRows.map((row) => {
      const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
      return {
        asset_type: "term",
        id: row.id,
        title: row.title,
        status: row.status,
        version: typeof metadata.version === "number" ? metadata.version : 1,
        source_count: parseJson<unknown[]>(row.source_refs_json, []).length,
        updated_at: row.updated_at,
      };
    }),
  ].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 12);

  const unresolvedGaps = db.prepare(
    `SELECT id, title, gap_type, status, severity, frequency_count, representative_question, updated_at
     FROM knowledge_gaps
     WHERE status IN ('pending', 'draft_generated')
       AND retrieval_evidence_json LIKE ?
     ORDER BY frequency_count DESC, updated_at DESC
     LIMIT 10`
  ).all(likeDocumentRef(documentId));

  return {
    asked_questions: askedQuestions,
    knowledge_assets: knowledgeAssets,
    unresolved_gaps: unresolvedGaps,
    retrieval_contribution: {
      source_hit_count: Number(retrievalContribution.source_hit_count ?? 0),
      answer_count: Number(retrievalContribution.answer_count ?? 0),
      section_count: Number(retrievalContribution.section_count ?? 0),
      avg_score: Number(retrievalContribution.avg_score ?? 0),
      top_score: Number(retrievalContribution.top_score ?? 0),
      last_hit_at: retrievalContribution.last_hit_at ?? null,
    },
  };
}
