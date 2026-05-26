import { Request } from "express";
import { generateDiagramIR } from "../../services/ragClient";
import type { DiagramIR, DiagramValidationResult, RagAnswerIR, RagAnswerQueryRewrite, RagImageArtifactContract, RagVisualArtifactPlan, RagVisualPlan } from "../../services/ragClient";
import { AppError, ErrorCodes } from "../../utils/errors";
import { auditFromRequest } from "../../services/auditService";
import { getSessionById } from "../../db/chatSessions";
import { formatMessage, getMessageById, listMessagesBySession } from "../../db/chatMessages";
import { getMessageSourceDetail } from "../../db/messageSources";
import { isNoteScope } from "../../db/chatNotes";
import type { NoteTarget } from "../../db/chatNotes";
import { createArtifact, formatArtifact } from "../../db/chatArtifacts";

export function canReadSession(req: Request, sessionUserId: string): boolean {
  const userId = req.user?.id || "anonymous";
  const isOwner = sessionUserId === userId;
  const isAdmin = req.user?.role === "system_admin" || req.user?.role === "knowledge_admin";
  return isOwner || isAdmin;
}

function canManageSession(req: Request, sessionUserId: string): boolean {
  return canReadSession(req, sessionUserId);
}

export function currentUser(req: Request): { id: string; name: string } {
  return {
    id: req.user?.id || "anonymous",
    name: req.user?.name || "匿名",
  };
}

export function compactDiagramText(value: unknown, maxLength = 600): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildDiagramContent(answer: string, sources: Array<Record<string, unknown>>): string {
  const blocks = [`回答正文：\n${answer}`];
  sources.slice(0, 8).forEach((source, index) => {
    const title = compactDiagramText(source.document_title, 120);
    const section = compactDiagramText(source.section_path, 160);
    const snippet = compactDiagramText(source.content || source.snippet, 700);
    blocks.push(
      [
        `[引用 ${index + 1}]`,
        `文档：${title || "未知文档"}`,
        `章节：${section || "未标注章节"}`,
        `片段：${snippet || "暂无片段"}`,
      ].join("\n")
    );
  });
  return blocks.join("\n\n");
}

export function parseMessageSources(message: ReturnType<typeof getMessageById>): Array<Record<string, unknown>> {
  if (!message) return [];
  try {
    const parsed = JSON.parse(message.sources_json || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

export function normalizeDiagramType(value: unknown): "mindmap" | "flowchart" {
  const rawDiagramType = typeof value === "string" ? value : "mindmap";
  if (rawDiagramType !== "mindmap" && rawDiagramType !== "flowchart") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "diagram_type 必须是 mindmap 或 flowchart。", 400);
  }
  return rawDiagramType;
}

export function artifactRenderer(payload: { metadata?: Record<string, unknown> }): string {
  const renderer = payload.metadata?.renderer;
  return typeof renderer === "string" && renderer.trim() ? renderer : "diagram-ir";
}

export function artifactSummary(payload: { nodes?: unknown[]; edges?: unknown[] }): string {
  const nodeCount = Array.isArray(payload.nodes) ? payload.nodes.length : 0;
  const edgeCount = Array.isArray(payload.edges) ? payload.edges.length : 0;
  return `${nodeCount} 个节点，${edgeCount} 条连线`;
}

type DiagramEligibility = {
  eligible: boolean;
  reason?: string;
  question?: string;
};

type AnswerMessageMetadataInput = {
  originalQuestion: string;
  sources?: unknown[];
  confidence?: number;
  followups?: string[];
  trace?: Record<string, unknown>;
  answerIr?: RagAnswerIR | null;
  queryRewrite?: RagAnswerQueryRewrite | null;
  visualPlan?: RagVisualPlan | null;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceIdentity(source: Record<string, unknown>, fallbackIndex: number): string {
  return stringValue(source.id) || stringValue(source.chunk_id) || `source-${fallbackIndex}`;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildCitationCoverage(answerIr: RagAnswerIR | null | undefined, sources: unknown[]) {
  const sourceRecords = sources.filter(isRecord);
  const sourceIds = uniqueValues(sourceRecords.map((source, index) => sourceIdentity(source, index + 1)));
  const citations = answerIr?.citations ?? [];
  const citationIds = uniqueValues(
    citations.map((citation, index) => citation.id || citation.chunk_id || `source-${citation.source_index || index + 1}`)
  );
  const claims = answerIr?.claims ?? [];
  const citedIdSet = new Set(citationIds);
  const coveredClaims = claims.filter((claim) => (claim.citation_ids ?? []).some((id) => citedIdSet.has(id)));
  const missingCitationClaimIds = claims
    .filter((claim) => (claim.citation_ids ?? []).length === 0 || !(claim.citation_ids ?? []).some((id) => citedIdSet.has(id)))
    .map((claim, index) => claim.id || `claim-${index + 1}`);

  return {
    returned_source_count: sourceRecords.length,
    returned_source_ids: sourceIds,
    cited_source_count: citationIds.length,
    cited_source_ids: citationIds,
    claim_count: claims.length,
    covered_claim_count: coveredClaims.length,
    claim_coverage_ratio: claims.length > 0 ? coveredClaims.length / claims.length : 0,
    source_coverage_ratio: sourceIds.length > 0 ? citationIds.filter((id) => sourceIds.includes(id)).length / sourceIds.length : 0,
    missing_citation_claim_ids: missingCitationClaimIds,
  };
}

function buildAnswerIrSummary(answerIr: RagAnswerIR | null | undefined) {
  if (!answerIr) return null;

  return {
    schema_version: answerIr.schema_version,
    status: answerIr.status,
    confidence: answerIr.confidence,
    claim_count: answerIr.claims?.length ?? 0,
    citation_count: answerIr.citations?.length ?? 0,
    warning_count: answerIr.warnings?.length ?? 0,
    primary_claim: answerIr.claims?.[0]?.text ?? "",
    warnings: (answerIr.warnings ?? []).map((warning) => ({
      code: warning.code,
      severity: warning.severity,
      citation_ids: warning.citation_ids ?? [],
    })),
  };
}

export function buildAnswerMessageMetadata(input: AnswerMessageMetadataInput): Record<string, unknown> {
  const queryRewrite = input.answerIr?.query_rewrite ?? input.queryRewrite ?? null;
  const rewrittenQuestion = queryRewrite?.rewritten_query || input.originalQuestion;

  return {
    confidence: input.confidence,
    followups: input.followups,
    trace: input.trace,
    query: {
      original_question: queryRewrite?.original_query || input.originalQuestion,
      rewritten_question: rewrittenQuestion,
      rewrite_changed: queryRewrite?.changed ?? rewrittenQuestion !== input.originalQuestion,
      rewrite_strategy: queryRewrite?.strategy ?? "none",
      rewrite_reason: queryRewrite?.reason ?? "",
      rewrite_signals: queryRewrite?.signals ?? [],
      history_turns: queryRewrite?.history_turns ?? 0,
    },
    answer_ir_summary: buildAnswerIrSummary(input.answerIr),
    citation_coverage: buildCitationCoverage(input.answerIr, input.sources ?? []),
    visual_plan: input.visualPlan ?? null,
    knowledge_assets: input.answerIr?.metadata?.knowledge_assets ?? input.visualPlan?.metadata?.knowledge_assets ?? [],
  };
}

const MIN_ARTIFACT_CONFIDENCE = 0.66;
const MIN_DIAGRAM_QUALITY_SCORE = 0.62;
const MIN_DIAGRAM_CONFIDENCE = 0.5;
const DOMAIN_SHORT_QUERY_PATTERN = /\b(?:OCV|EOL|CCD|SOC|SOP|RAG|PPM|MES|PLC|BMS|Busbar)\b/i;
const LOW_SIGNAL_INPUT_PATTERN = /^[\d\s._\-+*/=#@!?,，。！？、;；:：()[\]{}"'`~|\\]+$/;
const CLARIFICATION_ANSWER_PATTERN =
  /(?:请(?:先|再)?(?:提供|补充|说明|明确)|需要(?:更多|补充|具体).{0,12}(?:信息|背景|问题)|看起来像(?:测试|误触|随意输入)|无法(?:判断|确定|生成|回答)|信息不足|问题不够具体|没有足够(?:上下文|信息|证据)|请重新输入|换个具体问题)/;

function semanticLength(value: string): number {
  return (value.match(/[\u4e00-\u9fffA-Za-z0-9Ωμ%]+/g) || []).join("").length;
}

function hasRepeatedNoise(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  return compact.length >= 2 && /^(.)(\1)+$/.test(compact);
}

function isLowSignalQuestion(question: string): boolean {
  const compact = question.trim();
  if (!compact) return true;
  if (LOW_SIGNAL_INPUT_PATTERN.test(compact)) return true;
  if (hasRepeatedNoise(compact)) return true;
  if (DOMAIN_SHORT_QUERY_PATTERN.test(compact)) return false;
  return semanticLength(compact) < 6;
}

function looksLikeClarificationAnswer(answer: string): boolean {
  return CLARIFICATION_ANSWER_PATTERN.test(answer.replace(/\s+/g, ""));
}

export function getPreviousUserQuestion(sessionId: string, assistantMessageId: string): string {
  const messages = listMessagesBySession(sessionId);
  const assistantIndex = messages.findIndex((message) => message.id === assistantMessageId);
  const beforeAssistant = assistantIndex >= 0 ? messages.slice(0, assistantIndex) : messages;
  return beforeAssistant.reverse().find((message) => message.role === "user")?.content ?? "";
}

function assessDiagramEligibility(input: {
  question: string;
  answer: string;
  confidence: number;
  sourceIds: string[];
}): DiagramEligibility {
  if (isLowSignalQuestion(input.question)) {
    return {
      eligible: false,
      reason: "当前问题信息不足，不能生成图解。请先提出具体的业务问题。",
      question: input.question,
    };
  }
  if (looksLikeClarificationAnswer(input.answer)) {
    return {
      eligible: false,
      reason: "当前回答还在澄清问题，不能生成图解。请补充问题后再整理。",
      question: input.question,
    };
  }
  if (input.confidence > 0 && input.confidence < MIN_ARTIFACT_CONFIDENCE) {
    return {
      eligible: false,
      reason: `当前回答可信度较低（${Math.round(input.confidence * 100)}%），暂不生成图解。请先核对或重新提问。`,
      question: input.question,
    };
  }
  if (input.sourceIds.length === 0) {
    return {
      eligible: false,
      reason: "当前回答没有可追溯引用，不能生成图解。",
      question: input.question,
    };
  }
  return { eligible: true, question: input.question };
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unitNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? clampUnit(value) : undefined;
}

function diagramMetadata(diagram: DiagramIR): Record<string, unknown> {
  return isRecord(diagram.metadata) ? diagram.metadata : {};
}

function diagramValidation(diagram: DiagramIR): DiagramValidationResult | undefined {
  if (diagram.validation) return diagram.validation;
  const validation = diagramMetadata(diagram).validation;
  return isRecord(validation) ? validation as DiagramValidationResult : undefined;
}

function diagramCanGenerate(diagram: DiagramIR): boolean | undefined {
  if (typeof diagram.can_generate === "boolean") return diagram.can_generate;
  const metadataCanGenerate = diagramMetadata(diagram).can_generate;
  if (typeof metadataCanGenerate === "boolean") return metadataCanGenerate;
  const validationCanGenerate = diagramValidation(diagram)?.can_generate;
  return typeof validationCanGenerate === "boolean" ? validationCanGenerate : undefined;
}

function diagramQualityScore(diagram: DiagramIR): number | undefined {
  return unitNumber(diagram.quality_score)
    ?? unitNumber(diagramMetadata(diagram).quality_score)
    ?? unitNumber(diagramValidation(diagram)?.quality_score);
}

function diagramValidationErrors(diagram: DiagramIR): unknown[] {
  const errors = diagramValidation(diagram)?.errors;
  return Array.isArray(errors) ? errors : [];
}

export function diagramQualityWarnings(diagram: DiagramIR): unknown[] {
  if (Array.isArray(diagram.quality_warnings)) return diagram.quality_warnings;
  const warnings = diagramMetadata(diagram).quality_warnings;
  return Array.isArray(warnings) ? warnings : [];
}

function artifactConfidence(input: {
  messageConfidence: number;
  diagramConfidence?: number;
  qualityScore?: number;
}): number {
  const candidates = [
    input.messageConfidence > 0 ? unitNumber(input.messageConfidence) : undefined,
    unitNumber(input.diagramConfidence),
    input.qualityScore,
  ].filter((value): value is number => value !== undefined);

  if (candidates.length === 0) return 0;
  return Math.round(Math.min(...candidates) * 100) / 100;
}

function assertDiagramQuality(diagram: DiagramIR, messageConfidence: number): {
  artifactConfidence: number;
  qualityScore?: number;
  canGenerate?: boolean;
  validation?: DiagramValidationResult;
} {
  const qualityScore = diagramQualityScore(diagram);
  const canGenerate = diagramCanGenerate(diagram);
  const validation = diagramValidation(diagram);
  const diagramConfidence = unitNumber(diagram.confidence);
  const combinedConfidence = artifactConfidence({
    messageConfidence,
    diagramConfidence,
    qualityScore,
  });

  if (canGenerate === false || diagramValidationErrors(diagram).length > 0) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "图解结构校验未通过，暂不保存或展示。", 422, {
      can_generate: canGenerate,
      quality_score: qualityScore,
      quality_warnings: diagramQualityWarnings(diagram),
      validation,
    });
  }
  if (qualityScore !== undefined && qualityScore < MIN_DIAGRAM_QUALITY_SCORE) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "图解质量分低于保存门槛，暂不保存或展示。", 422, {
      quality_score: qualityScore,
      min_quality_score: MIN_DIAGRAM_QUALITY_SCORE,
      quality_warnings: diagramQualityWarnings(diagram),
      validation,
    });
  }
  if (diagramConfidence !== undefined && diagramConfidence < MIN_DIAGRAM_CONFIDENCE) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "图解置信度低于保存门槛，暂不保存或展示。", 422, {
      diagram_confidence: diagramConfidence,
      min_diagram_confidence: MIN_DIAGRAM_CONFIDENCE,
      quality_score: qualityScore,
      quality_warnings: diagramQualityWarnings(diagram),
      validation,
    });
  }

  return {
    artifactConfidence: combinedConfidence,
    qualityScore,
    canGenerate,
    validation,
  };
}

export function requireReadableAssistantMessage(req: Request, messageId: string, action: string) {
  const existing = getMessageById(messageId);
  if (!existing) {
    throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
  }

  const session = getSessionById(existing.session_id);
  if (!session) {
    throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
  }
  if (!canReadSession(req, session.user_id)) {
    throw new AppError(ErrorCodes.FORBIDDEN, `当前用户无权限${action}该回答。`, 403);
  }
  if (existing.role !== "assistant") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "只能处理回答消息。", 400);
  }

  return { existing, session };
}

export async function buildDiagramForMessage(
  req: Request,
  messageId: string,
  diagramType: "mindmap" | "flowchart",
  titleInput?: unknown
) {
  const { existing, session } = requireReadableAssistantMessage(req, messageId, "整理");
  const formatted = formatMessage(existing) as { sources?: Array<Record<string, unknown>>; confidence?: number };
  const sourceIds = (formatted.sources || [])
    .map((source) => source.chunk_id)
    .filter((chunkId): chunkId is string => typeof chunkId === "string" && chunkId.length > 0);
  const confidence = formatted.confidence ?? 0;
  const eligibility = assessDiagramEligibility({
    question: getPreviousUserQuestion(existing.session_id, existing.id),
    answer: existing.content,
    confidence,
    sourceIds,
  });
  if (!eligibility.eligible) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, eligibility.reason || "当前回答不适合生成图解。", 422, {
      question: eligibility.question,
      confidence,
      source_count: sourceIds.length,
    });
  }

  const title = typeof titleInput === "string" && titleInput.trim()
    ? titleInput.trim()
    : session.title || "AI 整理";
  const diagram = await generateDiagramIR(
    title,
    buildDiagramContent(existing.content, formatted.sources || []),
    diagramType,
    sourceIds,
    req.requestId
  );
  const quality = assertDiagramQuality(diagram, confidence);

  return { diagram, existing, sourceIds, title, confidence, quality };
}

export async function generateDiagramArtifact(
  req: Request,
  messageId: string,
  diagramType: "mindmap" | "flowchart",
  titleInput?: unknown
) {
  const { diagram, existing, sourceIds, title, confidence, quality } = await buildDiagramForMessage(
    req,
    messageId,
    diagramType,
    titleInput
  );

  const artifact = createArtifact({
    sessionId: existing.session_id,
    messageId,
    type: diagramType,
    renderer: artifactRenderer(diagram),
    title,
    summary: artifactSummary(diagram),
    reason: diagram.reason || "基于回答正文和引用证据生成结构化图解。",
    confidence: quality.artifactConfidence,
    payload: diagram,
    sourceIds,
    metadata: {
      diagram_type: diagramType,
      objective: diagram.objective,
      layout_hint: diagram.layout_hint,
      message_confidence: confidence,
      diagram_confidence: diagram.confidence,
      artifact_confidence: quality.artifactConfidence,
      quality_score: quality.qualityScore,
      can_generate: quality.canGenerate,
      quality_warnings: diagramQualityWarnings(diagram),
      validation: quality.validation,
    },
  });

  auditFromRequest(req, "chat.artifact.generate", "chat_message", messageId, {
    session_id: existing.session_id,
    artifact_id: artifact.id,
    artifact_type: diagramType,
    node_count: diagram.nodes.length,
    edge_count: diagram.edges.length,
    source_count: sourceIds.length,
    quality_score: quality.qualityScore,
    can_generate: quality.canGenerate,
    confidence: quality.artifactConfidence,
  });

  return { diagram, artifact, sourceIds, existing };
}

function plannedDiagramType(plan: RagVisualArtifactPlan): "mindmap" | "flowchart" | null {
  if (plan.artifact_type === "mindmap" || plan.artifact_type === "flowchart") return plan.artifact_type;
  return null;
}

export async function createAutoArtifactsFromVisualPlan(
  req: Request,
  messageId: string,
  visualPlan: RagVisualPlan | null | undefined
) {
  if (!visualPlan?.can_generate) return [];

  const plans = (visualPlan.artifacts ?? [])
    .filter((plan) => plan.auto_generate && plannedDiagramType(plan))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 1);

  const artifacts: Array<ReturnType<typeof formatArtifact>> = [];
  for (const plan of plans) {
    const diagramType = plannedDiagramType(plan);
    if (!diagramType) continue;
    try {
      const { artifact } = await generateDiagramArtifact(req, messageId, diagramType, plan.title);
      artifacts.push(formatArtifact(artifact));
    } catch (error) {
      // 自动产物不能影响主回答保存，失败原因留在审计和回答 metadata 中供排查。
      auditFromRequest(req, "chat.artifact.auto_generate_failed", "chat_message", messageId, {
        artifact_type: diagramType,
        reason: plan.reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return artifacts;
}

export function imageArtifactStatus(contract: RagImageArtifactContract): "pending" | "failed" {
  return contract.allowed ? "pending" : "failed";
}

export function requireReadableSession(req: Request, sessionId: string): ReturnType<typeof getSessionById> {
  const session = getSessionById(sessionId);
  if (!session) {
    throw new AppError(ErrorCodes.SESSION_NOT_FOUND, "会话不存在。", 404);
  }
  if (!canReadSession(req, session.user_id)) {
    throw new AppError(ErrorCodes.FORBIDDEN, "当前用户无权限访问该会话。", 403);
  }
  return session;
}

export function requireUserMessageMutationPermission(
  req: Request,
  sessionUserId: string,
  existingRole: string,
  action: "编辑" | "删除"
): void {
  if (!canManageSession(req, sessionUserId)) {
    throw new AppError(ErrorCodes.FORBIDDEN, `当前用户无权限${action}该消息。`, 403);
  }
  if (existingRole !== "user") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, `只能${action}用户消息。`, 400);
  }
}

export function normalizeNoteTarget(req: Request, input: Record<string, unknown>): NoteTarget {
  const scope = input.scope;
  if (!isNoteScope(scope)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "笔记 scope 必须是 session、message 或 source。", 400);
  }

  const sessionId = typeof input.session_id === "string" ? input.session_id.trim() : "";
  if (!sessionId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "笔记必须指定 session_id。", 400);
  }
  requireReadableSession(req, sessionId);

  if (scope === "session") {
    return { scope, sessionId };
  }

  const messageId = typeof input.message_id === "string" ? input.message_id.trim() : "";
  if (!messageId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "回答或引用笔记必须指定 message_id。", 400);
  }

  const message = getMessageById(messageId);
  if (!message) {
    throw new AppError(ErrorCodes.MESSAGE_NOT_FOUND, "消息不存在。", 404);
  }
  if (message.session_id !== sessionId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "message_id 不属于指定会话。", 400);
  }
  if (message.role !== "assistant") {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "回答笔记只能关联 assistant 消息。", 400);
  }

  if (scope === "message") {
    return { scope, sessionId, messageId };
  }

  const sourceId = typeof input.source_id === "string" ? input.source_id.trim() : "";
  if (!sourceId) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "引用笔记必须指定 source_id。", 400);
  }

  const source = getMessageSourceDetail(messageId, sourceId);
  if (!source) {
    throw new AppError(ErrorCodes.DOCUMENT_NOT_FOUND, "引用来源不存在。", 404);
  }

  return {
    scope,
    sessionId,
    messageId,
    sourceId: source.id,
    documentId: source.document_id,
    chunkId: source.chunk_id,
  };
}
