import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";

export const TERMINOLOGY_STATUSES = ["draft", "published", "archived"] as const;
export type TerminologyStatus = typeof TERMINOLOGY_STATUSES[number];
export const TERMINOLOGY_FEEDBACK_STATUSES = ["candidate", "approved", "fed_back", "deprecated"] as const;
export type TerminologyFeedbackStatus = typeof TERMINOLOGY_FEEDBACK_STATUSES[number];

export interface TerminologySourceRef {
  document_id?: string;
  title?: string;
  section_path?: string;
  chunk_id?: string;
}

export interface TerminologyRow {
  id: string;
  canonical_term: string;
  abbreviation: string;
  aliases_json: string;
  synonyms_json: string;
  definition: string;
  applicable_scenarios_json: string;
  source_refs_json: string;
  related_topics_json: string;
  retrieval_terms_json: string;
  status: TerminologyStatus;
  source: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface TerminologyFilters {
  status?: TerminologyStatus;
  query?: string;
  relatedTopic?: string;
}

export interface TerminologyTermInput {
  canonicalTerm: string;
  abbreviation?: string;
  aliases?: string[];
  synonyms?: string[];
  definition?: string;
  applicableScenarios?: string[];
  sourceRefs?: TerminologySourceRef[];
  relatedTopics?: string[];
  retrievalTerms?: string[];
  status?: TerminologyStatus;
  source?: string;
  confidence?: number;
  reviewerId?: string | null;
  reviewerName?: string | null;
  feedbackStatus?: TerminologyFeedbackStatus;
  metadata?: Record<string, unknown>;
}

export const TERMINOLOGY_CONTRACT = {
  schema_version: "terminology.v1",
  owner_service: "api",
  consumer_service: "rag",
  table: "terminology_terms",
  required_fields: ["canonical_term", "definition"],
  structured_fields: [
    "abbreviation",
    "aliases",
    "synonyms",
    "definition",
    "applicable_scenarios",
    "source_refs",
    "related_topics",
    "retrieval_terms",
  ],
  status_flow: ["draft", "published", "archived"],
  governance_fields: [
    "source",
    "source_refs",
    "applicable_scenarios",
    "confidence",
    "reviewer_id",
    "reviewer_name",
    "reviewed_at",
    "version",
    "feedback_status",
  ],
  retrieval_rule: "RAG 只能使用 published 术语反哺查询改写和检索扩展，并在 trace 中记录命中的 canonical_term。",
} as const;

const DEFAULT_TERMS = [
  {
    canonical_term: "OCV",
    abbreviation: "OCV",
    aliases: ["开路电压", "电芯开路电压"],
    synonyms: ["静置电压", "open circuit voltage"],
    definition: "电芯或模组在无负载静置状态下测得的端电压，用于一致性、容量状态和异常筛查。",
    applicable_scenarios: ["电芯分选", "静置复测", "电压一致性分析", "来料和出货检验"],
    source_refs: [{ document_id: "battery-line-glossary", title: "电池产线术语库", section_path: "测试 / OCV" }],
    related_topics: ["电芯分选", "静置时间", "电压一致性", "SOC估算"],
    retrieval_terms: ["电压一致性", "OCV测试", "OCV异常"],
  },
  {
    canonical_term: "DCR",
    abbreviation: "DCR",
    aliases: ["直流内阻", "电芯直流内阻"],
    synonyms: ["内阻", "direct current resistance"],
    definition: "电芯或模组在直流脉冲或规定工况下表现出的等效内阻，常用于功率能力和连接质量判断。",
    applicable_scenarios: ["内阻测试", "模组终检", "连接阻抗排查", "功率性能评估"],
    source_refs: [{ document_id: "battery-line-glossary", title: "电池产线术语库", section_path: "测试 / DCR" }],
    related_topics: ["内阻一致性", "连接阻抗", "Busbar焊接", "夹具接触"],
    retrieval_terms: ["DCR测试", "内阻异常", "电阻一致性"],
  },
  {
    canonical_term: "EOL",
    abbreviation: "EOL",
    aliases: ["下线测试", "终检测试", "产线终检"],
    synonyms: ["end of line", "末端测试"],
    definition: "产品下线前执行的终检测试集合，用于确认安全、电性能、通讯和关键装配质量是否满足放行标准。",
    applicable_scenarios: ["模组下线", "Pack终检", "出货放行", "异常复测"],
    source_refs: [{ document_id: "battery-line-glossary", title: "电池产线术语库", section_path: "终检 / EOL" }],
    related_topics: ["终检流程", "绝缘耐压", "DCR测试", "功能测试"],
    retrieval_terms: ["模组EOL", "EOL测试", "终检"],
  },
  {
    canonical_term: "SOC",
    abbreviation: "SOC",
    aliases: ["荷电状态", "电量状态"],
    synonyms: ["state of charge"],
    definition: "电池当前剩余电量相对额定容量的百分比状态，通常结合 OCV 曲线、电流积分和温度补偿估算。",
    applicable_scenarios: ["BMS估算", "容量校准", "充放电测试", "OCV曲线判断"],
    source_refs: [{ document_id: "battery-line-glossary", title: "电池产线术语库", section_path: "电性能 / SOC" }],
    related_topics: ["OCV曲线", "容量校准", "BMS", "温度补偿"],
    retrieval_terms: ["SOC校准", "电量估算", "充电状态"],
  },
  {
    canonical_term: "SOP",
    abbreviation: "SOP",
    aliases: ["标准作业程序", "标准操作规程"],
    synonyms: ["作业指导书", "standard operating procedure"],
    definition: "规定岗位操作步骤、工艺参数、质量检查和异常处置要求的标准化作业文件。",
    applicable_scenarios: ["岗位作业", "新人培训", "异常处置", "工艺稽核"],
    source_refs: [{ document_id: "battery-line-glossary", title: "电池产线术语库", section_path: "作业文件 / SOP" }],
    related_topics: ["作业指导书", "工艺规程", "质量检查", "安全注意事项"],
    retrieval_terms: ["操作步骤", "作业规范", "工艺规程"],
  },
  {
    canonical_term: "CCD",
    abbreviation: "CCD",
    aliases: ["视觉检测", "工业相机检测"],
    synonyms: ["机器视觉", "charge coupled device"],
    definition: "产线视觉检测中常用的图像采集和识别能力，通常用于定位、外观缺陷和尺寸一致性检查。",
    applicable_scenarios: ["极片外观检测", "焊接定位", "装配防错", "尺寸检测"],
    source_refs: [{ document_id: "battery-line-glossary", title: "电池产线术语库", section_path: "视觉检测 / CCD" }],
    related_topics: ["机器视觉", "外观缺陷", "定位补偿", "图像采集"],
    retrieval_terms: ["CCD定位", "外观检测", "视觉拍照"],
  },
  {
    canonical_term: "Busbar",
    abbreviation: "",
    aliases: ["汇流排", "母排", "连接排"],
    synonyms: ["bus bar", "汇流条"],
    definition: "用于电芯、模组或 Pack 内部电流汇集和传导的导电连接件，其焊接和接触质量会影响阻抗与温升。",
    applicable_scenarios: ["模组装配", "激光焊接", "连接阻抗排查", "温升分析"],
    source_refs: [{ document_id: "battery-line-glossary", title: "电池产线术语库", section_path: "连接件 / Busbar" }],
    related_topics: ["激光焊接", "连接阻抗", "DCR", "温升"],
    retrieval_terms: ["Busbar焊接", "汇流排焊接", "母排连接"],
  },
] as const;

function toJson(input: unknown): string {
  return JSON.stringify(input ?? []);
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input || "") as T;
  } catch {
    return fallback;
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function clampConfidence(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function mergeStrings(existingJson: string, next?: string[]): string[] {
  return uniqueStrings([...parseJson<string[]>(existingJson, []), ...(next ?? [])]);
}

function mergeSourceRefs(existingJson: string, next?: TerminologySourceRef[]): TerminologySourceRef[] {
  const refs = [...parseJson<TerminologySourceRef[]>(existingJson, []), ...(next ?? [])];
  const byKey = new Map<string, TerminologySourceRef>();
  for (const ref of refs) {
    const key = ref.chunk_id || ref.document_id || `${ref.title || ""}:${ref.section_path || ""}`;
    if (key.trim()) byKey.set(key, ref);
  }
  return Array.from(byKey.values()).slice(0, 20);
}

export function isTerminologyStatus(value: unknown): value is TerminologyStatus {
  return typeof value === "string" && TERMINOLOGY_STATUSES.includes(value as TerminologyStatus);
}

export function seedDefaultTerminology(database: Database.Database): void {
  const count = database.prepare("SELECT COUNT(*) as count FROM terminology_terms").get() as { count: number };
  if (count.count > 0) return;

  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO terminology_terms (
       id, canonical_term, abbreviation, aliases_json, synonyms_json, definition,
       applicable_scenarios_json, source_refs_json, related_topics_json,
       retrieval_terms_json, status, source, metadata_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 'built_in_battery_line_glossary', '{}', ?, ?)`
  );

  const seed = database.transaction(() => {
    for (const term of DEFAULT_TERMS) {
      insert.run(
        uuidv4(),
        term.canonical_term,
        term.abbreviation,
        toJson(term.aliases),
        toJson(term.synonyms),
        term.definition,
        toJson(term.applicable_scenarios),
        toJson(term.source_refs),
        toJson(term.related_topics),
        toJson(term.retrieval_terms),
        now,
        now
      );
    }
  });
  seed();
}

export function listTerminologyTerms(filters: TerminologyFilters = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.query) {
    conditions.push("(canonical_term LIKE ? OR abbreviation LIKE ? OR definition LIKE ? OR aliases_json LIKE ? OR retrieval_terms_json LIKE ?)");
    const pattern = `%${filters.query}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.relatedTopic) {
    conditions.push("related_topics_json LIKE ?");
    params.push(`%${filters.relatedTopic}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT *
       FROM terminology_terms
       ${whereClause}
       ORDER BY canonical_term COLLATE NOCASE ASC`
    )
    .all(...params) as TerminologyRow[];

  return rows.map(formatTerminologyTerm);
}

export function getTerminologyTermById(id: string): TerminologyRow | null {
  const row = getDb().prepare("SELECT * FROM terminology_terms WHERE id = ?").get(id) as TerminologyRow | undefined;
  return row ?? null;
}

export function getTerminologyTermByCanonicalTerm(canonicalTerm: string): TerminologyRow | null {
  const row = getDb()
    .prepare("SELECT * FROM terminology_terms WHERE lower(canonical_term) = lower(?)")
    .get(canonicalTerm) as TerminologyRow | undefined;
  return row ?? null;
}

export function upsertTerminologyTerm(input: TerminologyTermInput): TerminologyRow {
  const now = new Date().toISOString();
  const existing = getTerminologyTermByCanonicalTerm(input.canonicalTerm);
  if (existing) {
    return updateTerminologyTerm(existing.id, input)!;
  }

  const id = uuidv4();
  const confidence = clampConfidence(input.confidence);
  const metadata = {
    ...(input.metadata ?? {}),
    confidence: confidence ?? input.metadata?.confidence ?? null,
    reviewer_id: input.reviewerId ?? null,
    reviewer_name: input.reviewerName ?? null,
    reviewed_at: input.reviewerName || input.reviewerId ? now : null,
    version: 1,
    feedback_status: input.feedbackStatus ?? "candidate",
  };

  getDb().prepare(
    `INSERT INTO terminology_terms (
       id, canonical_term, abbreviation, aliases_json, synonyms_json, definition,
       applicable_scenarios_json, source_refs_json, related_topics_json,
       retrieval_terms_json, status, source, metadata_json, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.canonicalTerm,
    input.abbreviation ?? "",
    toJson(input.aliases ?? []),
    toJson(input.synonyms ?? []),
    input.definition ?? "",
    toJson(input.applicableScenarios ?? []),
    toJson(input.sourceRefs ?? []),
    toJson(input.relatedTopics ?? []),
    toJson(input.retrievalTerms ?? uniqueStrings([input.canonicalTerm, input.abbreviation ?? "", ...(input.aliases ?? [])])),
    input.status ?? "draft",
    input.source ?? "manual",
    JSON.stringify(metadata),
    now,
    now
  );

  return getTerminologyTermById(id)!;
}

export function updateTerminologyTerm(id: string, input: Partial<TerminologyTermInput>): TerminologyRow | null {
  const existing = getTerminologyTermById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const existingMetadata = parseJson<Record<string, unknown>>(existing.metadata_json, {});
  const nextVersion = typeof existingMetadata.version === "number" ? existingMetadata.version + 1 : 2;
  const confidence = clampConfidence(input.confidence);
  const metadata = {
    ...existingMetadata,
    ...(input.metadata ?? {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(input.reviewerId !== undefined ? { reviewer_id: input.reviewerId } : {}),
    ...(input.reviewerName !== undefined ? { reviewer_name: input.reviewerName } : {}),
    ...(input.reviewerId || input.reviewerName ? { reviewed_at: now } : {}),
    version: nextVersion,
    ...(input.feedbackStatus ? { feedback_status: input.feedbackStatus } : {}),
  };

  getDb().prepare(
    `UPDATE terminology_terms
     SET canonical_term = ?,
         abbreviation = ?,
         aliases_json = ?,
         synonyms_json = ?,
         definition = ?,
         applicable_scenarios_json = ?,
         source_refs_json = ?,
         related_topics_json = ?,
         retrieval_terms_json = ?,
         status = ?,
         source = ?,
         metadata_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    input.canonicalTerm ?? existing.canonical_term,
    input.abbreviation ?? existing.abbreviation,
    toJson(mergeStrings(existing.aliases_json, input.aliases)),
    toJson(mergeStrings(existing.synonyms_json, input.synonyms)),
    input.definition ?? existing.definition,
    toJson(mergeStrings(existing.applicable_scenarios_json, input.applicableScenarios)),
    toJson(mergeSourceRefs(existing.source_refs_json, input.sourceRefs)),
    toJson(mergeStrings(existing.related_topics_json, input.relatedTopics)),
    toJson(mergeStrings(existing.retrieval_terms_json, input.retrievalTerms)),
    input.status ?? existing.status,
    input.source ?? existing.source,
    JSON.stringify(metadata),
    now,
    id
  );

  return getTerminologyTermById(id);
}

export function formatTerminologyTerm(row: TerminologyRow) {
  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  return {
    id: row.id,
    canonical_term: row.canonical_term,
    abbreviation: row.abbreviation,
    aliases: parseJson<string[]>(row.aliases_json, []),
    synonyms: parseJson<string[]>(row.synonyms_json, []),
    definition: row.definition,
    applicable_scenarios: parseJson<string[]>(row.applicable_scenarios_json, []),
    source_refs: parseJson<TerminologySourceRef[]>(row.source_refs_json, []),
    related_topics: parseJson<string[]>(row.related_topics_json, []),
    retrieval_terms: parseJson<string[]>(row.retrieval_terms_json, []),
    status: row.status,
    source: row.source,
    evidence_refs: parseJson<TerminologySourceRef[]>(row.source_refs_json, []),
    applicable_scope: parseJson<string[]>(row.applicable_scenarios_json, []),
    confidence: typeof metadata.confidence === "number" ? metadata.confidence : null,
    reviewer_id: typeof metadata.reviewer_id === "string" ? metadata.reviewer_id : null,
    reviewer_name: typeof metadata.reviewer_name === "string" ? metadata.reviewer_name : null,
    reviewed_at: typeof metadata.reviewed_at === "string" ? metadata.reviewed_at : null,
    version: typeof metadata.version === "number" ? metadata.version : 1,
    feedback_status: typeof metadata.feedback_status === "string" ? metadata.feedback_status : "candidate",
    metadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
