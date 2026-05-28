import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  FileQuestion,
  Filter,
  History,
  Layers3,
  MessageSquareWarning,
  RefreshCcw,
  Search,
  ShieldAlert,
  Split,
  ThumbsDown,
  X,
} from "lucide-react";
import { EmptyState } from "../components/ui";
import { api } from "../services/api";
import type { ApiResponse } from "../types";

type GapType = "refusal" | "low_confidence" | "user_retry" | "follow_up_correction" | "negative_feedback" | "mixed";
type GapStatus = "pending" | "merged" | "draft_generated" | "published" | "ignored";
type GapSeverity = "low" | "medium" | "high" | "critical";
type EventType = Exclude<GapType, "mixed">;
type SegmentKey = "all" | "frequent_refusal" | "false_refusal" | "low_confidence" | "user_correction" | "negative_feedback";

interface RetrievalEvidenceRef {
  document_id?: string;
  chunk_id?: string;
  title?: string;
  section_path?: string;
  snippet?: string;
  score?: number;
  retrieval_type?: "strong_term" | "semantic_candidate" | "hybrid" | "manual";
}

interface QueryUnderstandingCandidate {
  raw_query?: string;
  rewritten_query?: string;
  intent?: string;
  terms?: string[];
  confidence?: number;
  source?: string;
}

interface KnowledgeGap {
  id: string;
  title: string;
  representative_question: string;
  gap_type: GapType;
  status: GapStatus;
  severity: GapSeverity;
  frequency_count: number;
  sample_failed_question_ids: string[];
  query_understanding: QueryUnderstandingCandidate[];
  retrieval_evidence: RetrievalEvidenceRef[];
  metadata: Record<string, unknown>;
  created_by_name: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

interface FailedQuestion {
  id: string;
  gap_id: string | null;
  event_type: EventType;
  question: string;
  corrected_question: string;
  answer_snapshot: string;
  confidence: number | null;
  feedback_reason: string;
  feedback_comment: string;
  query_understanding: QueryUnderstandingCandidate[];
  retrieval_evidence: RetrievalEvidenceRef[];
  created_at: string;
}

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface StatusFlow {
  statuses: Array<{ status: GapStatus; label: string; next: GapStatus[] }>;
  transitions: Record<GapStatus, GapStatus[]>;
}

interface DraftSuggestion {
  title?: string;
  summary?: string;
  question?: string;
  answer?: string;
  canonical_term?: string;
  alias?: string;
  aliases?: string[];
  retrieval_terms?: string[];
  confidence?: number;
}

interface SegmentConfig {
  key: SegmentKey;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

const segments: SegmentConfig[] = [
  { key: "all", label: "全部缺口", description: "按频次和最近出现排序", icon: Layers3 },
  { key: "frequent_refusal", label: "高频拒答", description: "拒答或混合缺口中重复出现的问题", icon: MessageSquareWarning },
  { key: "false_refusal", label: "误拒疑似", description: "有检索证据但仍被拒答的问题", icon: ShieldAlert },
  { key: "low_confidence", label: "低置信问题", description: "回答置信度不足或部分回答", icon: AlertTriangle },
  { key: "user_correction", label: "用户纠错", description: "追问修正和人工纠错信号", icon: RefreshCcw },
  { key: "negative_feedback", label: "点踩反馈", description: "用户明确给出负反馈的问题", icon: ThumbsDown },
];

const gapTypeLabels: Record<GapType, string> = {
  refusal: "拒答",
  low_confidence: "低置信",
  user_retry: "重复追问",
  follow_up_correction: "用户纠错",
  negative_feedback: "负反馈",
  mixed: "混合信号",
};

const eventTypeLabels: Record<EventType, string> = {
  refusal: "拒答",
  low_confidence: "低置信",
  user_retry: "重复追问",
  follow_up_correction: "用户纠错",
  negative_feedback: "负反馈",
};

const severityLabels: Record<GapSeverity, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "紧急",
};

const statusFallbackLabels: Record<GapStatus, string> = {
  pending: "待处理",
  merged: "已合并",
  draft_generated: "已生成草稿",
  published: "已发布",
  ignored: "已忽略",
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function formatDate(value?: string) {
  if (!value) return "暂无时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function percent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "待核验";
  return `${Math.round(value * 100)}%`;
}

function gapStatusClass(status: GapStatus) {
  if (status === "published") return "bg-success-soft text-success";
  if (status === "draft_generated") return "bg-info-soft text-info";
  if (status === "ignored") return "bg-surface-page text-text-muted";
  if (status === "merged") return "bg-accent-soft text-accent";
  return "bg-warning-soft text-warning";
}

function severityClass(severity: GapSeverity) {
  if (severity === "critical") return "bg-danger-soft text-danger";
  if (severity === "high") return "bg-warning-soft text-warning";
  if (severity === "medium") return "bg-info-soft text-info";
  return "bg-surface-page text-text-muted";
}

function strongestEvidenceScore(evidence: RetrievalEvidenceRef[]) {
  return evidence.reduce((max, item) => Math.max(max, typeof item.score === "number" ? item.score : 0), 0);
}

function highestUnderstandingConfidence(candidates: QueryUnderstandingCandidate[]) {
  return candidates.reduce((max, item) => Math.max(max, typeof item.confidence === "number" ? item.confidence : 0), 0);
}

function isFalseRefusalCandidate(gap: KnowledgeGap) {
  if (gap.gap_type !== "refusal" && gap.gap_type !== "mixed") return false;
  const evidenceScore = strongestEvidenceScore(gap.retrieval_evidence);
  const understandingConfidence = highestUnderstandingConfidence(gap.query_understanding);
  return evidenceScore >= 0.5 || understandingConfidence >= 0.65 || gap.retrieval_evidence.some((item) => item.retrieval_type === "strong_term");
}

function segmentMatches(gap: KnowledgeGap, segment: SegmentKey) {
  if (segment === "all") return true;
  if (segment === "frequent_refusal") return (gap.gap_type === "refusal" || gap.gap_type === "mixed") && gap.frequency_count >= 2;
  if (segment === "false_refusal") return isFalseRefusalCandidate(gap);
  if (segment === "low_confidence") return gap.gap_type === "low_confidence";
  if (segment === "user_correction") return gap.gap_type === "follow_up_correction" || gap.gap_type === "user_retry";
  return gap.gap_type === "negative_feedback";
}

function gapSearchText(gap: KnowledgeGap) {
  return normalize([
    gap.title,
    gap.representative_question,
    gap.gap_type,
    gap.status,
    ...gap.query_understanding.flatMap((item) => [item.raw_query, item.rewritten_query, item.intent, ...(item.terms || [])]),
    ...gap.retrieval_evidence.flatMap((item) => [item.title, item.section_path, item.snippet]),
  ].filter(Boolean).join(" "));
}

function recommendActions(gap: KnowledgeGap) {
  if (gap.status === "published") return ["复核发布资产命中率", "观察同类问题是否继续出现"];
  if (gap.status === "ignored") return ["保留审计记录", "若重复出现则恢复处理"];
  if (gap.status === "merged") return ["检查合并目标", "避免重复生成资产"];
  if (gap.status === "draft_generated") return ["审核 FAQ 或知识卡草稿", "确认引用证据与适用范围"];
  if (isFalseRefusalCandidate(gap)) return ["复查拒答阈值与强术语命中", "将可引用证据转为 FAQ", "补充回答边界说明"];
  if (gap.gap_type === "low_confidence") return ["补充高质量原文证据", "生成知识卡草稿", "加入评估集回归"];
  if (gap.gap_type === "follow_up_correction" || gap.gap_type === "user_retry") return ["抽取用户修正意图", "合并相似问法", "补充术语别名"];
  if (gap.gap_type === "negative_feedback") return ["查看点踩原因", "转人工审核", "沉淀 FAQ 或 SOP 片段"];
  return ["聚类相似失败问题", "指定资产类型", "进入人工审核"];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function draftItems(value: unknown): DraftSuggestion[] {
  return Array.isArray(value) ? value.filter((item): item is DraftSuggestion => Boolean(objectValue(item))) : [];
}

function draftGroups(gap: KnowledgeGap) {
  const suggestions = objectValue(gap.metadata.draft_suggestions);
  if (!suggestions) return [];
  return [
    { label: "术语候选", items: draftItems(suggestions.term_candidates) },
    { label: "别名候选", items: draftItems(suggestions.alias_candidates) },
    { label: "FAQ 草稿", items: draftItems(suggestions.faq_drafts) },
    { label: "知识卡草稿", items: draftItems(suggestions.knowledge_card_drafts) },
    { label: "文档补充", items: draftItems(suggestions.document_supplement_suggestions) },
  ].filter((group) => group.items.length > 0);
}

function draftTitle(item: DraftSuggestion) {
  return item.title || item.canonical_term || item.question || item.alias || "候选草稿";
}

function draftSummary(item: DraftSuggestion) {
  if (item.summary) return item.summary;
  if (item.answer) return item.answer;
  if (item.alias && item.canonical_term) return `${item.alias} 可作为 ${item.canonical_term} 的候选别名`;
  if (item.aliases?.length) return `候选别名：${item.aliases.join("、")}`;
  if (item.retrieval_terms?.length) return `检索词：${item.retrieval_terms.slice(0, 6).join("、")}`;
  return "需要人工核验后才能发布到正式知识资产。";
}

function groupCount(gaps: KnowledgeGap[], key: SegmentKey) {
  return gaps.filter((gap) => segmentMatches(gap, key)).length;
}

function statusLabel(status: GapStatus, statusFlow: StatusFlow | null) {
  return statusFlow?.statuses.find((item) => item.status === status)?.label || statusFallbackLabels[status];
}

function actionLabel(status: GapStatus) {
  if (status === "pending") return "生成草稿";
  if (status === "draft_generated") return "审核发布";
  if (status === "published") return "查看效果";
  if (status === "merged") return "查看合并";
  return "恢复处理";
}

export default function KnowledgeGapsPage() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [failedQuestions, setFailedQuestions] = useState<FailedQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeSegment, setActiveSegment] = useState<SegmentKey>("all");
  const [activeStatus, setActiveStatus] = useState<GapStatus | "all">("all");
  const [keyword, setKeyword] = useState("");
  const [statusFlow, setStatusFlow] = useState<StatusFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadGovernanceData(signal?: AbortSignal) {
    setLoading(true);
    setError(null);

    const [gapRes, failedRes, statusRes] = await Promise.all([
      api.get<ApiResponse<Paginated<KnowledgeGap>>>("/knowledge/gaps?page=1&page_size=100"),
      api.get<ApiResponse<Paginated<FailedQuestion>>>("/knowledge/failed-questions?page=1&page_size=100"),
      api.get<ApiResponse<StatusFlow>>("/knowledge/gaps/status-flow"),
    ]);
    if (signal?.aborted) return;
    const nextGaps = gapRes.data.items || [];
    setGaps(nextGaps);
    setFailedQuestions(failedRes.data.items || []);
    setStatusFlow(statusRes.data);
    setSelectedId((current) => current && nextGaps.some((gap) => gap.id === current) ? current : nextGaps[0]?.id || null);
  }

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    loadGovernanceData(controller.signal)
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "知识缺口治理数据加载失败");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  const visibleGaps = useMemo(() => {
    const term = normalize(keyword);
    return gaps.filter((gap) => {
      if (!segmentMatches(gap, activeSegment)) return false;
      if (activeStatus !== "all" && gap.status !== activeStatus) return false;
      if (!term) return true;
      return gapSearchText(gap).includes(term);
    });
  }, [activeSegment, activeStatus, gaps, keyword]);

  const selectedGap = useMemo(() => {
    return gaps.find((gap) => gap.id === selectedId) || visibleGaps[0] || gaps[0] || null;
  }, [gaps, selectedId, visibleGaps]);

  const selectedFailedQuestions = useMemo(() => {
    if (!selectedGap) return failedQuestions.slice(0, 6);
    const sampleIds = new Set(selectedGap.sample_failed_question_ids);
    return failedQuestions
      .filter((item) => item.gap_id === selectedGap.id || sampleIds.has(item.id))
      .slice(0, 8);
  }, [failedQuestions, selectedGap]);

  const summary = useMemo(() => {
    const pending = gaps.filter((gap) => gap.status === "pending").length;
    const urgent = gaps.filter((gap) => gap.severity === "high" || gap.severity === "critical").length;
    const unclustered = failedQuestions.filter((item) => !item.gap_id).length;
    const evidenceBackedRefusals = gaps.filter(isFalseRefusalCandidate).length;
    return { pending, urgent, unclustered, evidenceBackedRefusals };
  }, [failedQuestions, gaps]);

  const statusOptions = statusFlow?.statuses || Object.keys(statusFallbackLabels).map((status) => ({
    status: status as GapStatus,
    label: statusFallbackLabels[status as GapStatus],
    next: [],
  }));

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-page">
      <header className="shrink-0 border-b border-divider bg-white px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-border bg-surface-page px-2.5 py-1 text-[11px] font-semibold text-text-secondary">
              <FileQuestion className="h-3.5 w-3.5 text-accent" />
              治理队列
            </div>
            <h1 className="text-2xl font-semibold text-text">知识缺口治理</h1>
            <p className="mt-1 text-sm text-text-secondary">
              汇总拒答、误拒疑似、低置信、用户纠错和点踩反馈，决定是否沉淀为术语、FAQ、知识卡或文档补充。
            </p>
          </div>

          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索问题、证据、术语或状态"
              className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-9 text-sm text-text shadow-sm-soft focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
            {keyword && (
              <button
                onClick={() => setKeyword("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text"
                title="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-2 md:grid-cols-4">
          {[
            ["待处理", summary.pending, "需要人工判断下一步"],
            ["高风险", summary.urgent, "高或紧急严重度"],
            ["误拒疑似", summary.evidenceBackedRefusals, "有证据但触发拒答"],
            ["未归并信号", summary.unclustered, "尚未进入缺口聚类"],
          ].map(([label, value, hint]) => (
            <div key={label} className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="text-[11px] font-semibold text-text-muted">{label}</p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <p className="text-xl font-semibold text-text">{value}</p>
                <p className="truncate text-[11px] text-text-muted">{hint}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto">
          {segments.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveSegment(key)}
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                activeSegment === key
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border bg-white text-text-secondary hover:bg-surface-hover hover:text-text"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className="rounded bg-white/70 px-1.5 py-0.5 text-[11px]">{groupCount(gaps, key)}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2 overflow-x-auto">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-text-muted">
            <Filter className="h-3.5 w-3.5" />
            状态
          </span>
          <button
            onClick={() => setActiveStatus("all")}
            className={`h-8 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              activeStatus === "all" ? "border-text bg-text text-white" : "border-border bg-white text-text-secondary hover:bg-surface-hover"
            }`}
          >
            全部
          </button>
          {statusOptions.map(({ status, label }) => (
            <button
              key={status}
              onClick={() => setActiveStatus(status)}
              className={`h-8 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                activeStatus === status ? "border-text bg-text text-white" : "border-border bg-white text-text-secondary hover:bg-surface-hover"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <main className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 xl:grid-cols-[minmax(360px,520px)_1fr]">
          <div className="space-y-3">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="skeleton h-28 rounded-lg" />
            ))}
          </div>
          <div className="skeleton min-h-[480px] rounded-lg" />
        </main>
      ) : error ? (
        <main className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
        </main>
      ) : gaps.length === 0 ? (
        <main className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            title="暂无知识缺口"
            description="当拒答、低置信、用户纠错或点踩反馈被记录后，会在这里形成治理队列。"
          />
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(360px,520px)_1fr]">
          <section className="min-h-0 overflow-y-auto border-r border-divider bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-text">缺口列表</p>
              <p className="text-xs text-text-muted">{visibleGaps.length} / {gaps.length}</p>
            </div>

            {visibleGaps.length > 0 ? (
              <div className="space-y-2">
                {visibleGaps.map((gap) => (
                  <button
                    key={gap.id}
                    onClick={() => setSelectedId(gap.id)}
                    className={`w-full rounded-lg border p-4 text-left transition-all ${
                      selectedGap?.id === gap.id
                        ? "border-accent bg-accent-soft/70 shadow-sm-soft"
                        : "border-border bg-surface hover:border-border-hover hover:bg-surface-page"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-surface-page px-2 py-1 text-[11px] font-semibold text-text-secondary">
                            {gapTypeLabels[gap.gap_type]}
                          </span>
                          <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${gapStatusClass(gap.status)}`}>
                            {statusLabel(gap.status, statusFlow)}
                          </span>
                          <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${severityClass(gap.severity)}`}>
                            {severityLabels[gap.severity]}
                          </span>
                        </div>
                        <h2 className="line-clamp-2 text-sm font-semibold leading-relaxed text-text">{gap.title}</h2>
                      </div>
                      <span className="shrink-0 rounded-md bg-white px-2 py-1 text-xs font-semibold text-text-secondary">
                        {gap.frequency_count} 次
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-text-secondary">{gap.representative_question}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                      <span>最近 {formatDate(gap.last_seen_at)}</span>
                      <span>证据 {gap.retrieval_evidence.length}</span>
                      <span>理解 {gap.query_understanding.length}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="没有匹配的知识缺口"
                description="调整分类、状态或搜索词后再查看。"
              />
            )}
          </section>

          <section className="min-h-0 overflow-y-auto p-5">
            {selectedGap ? (
              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                  <div className="rounded-lg border border-border bg-white p-5 shadow-sm-soft">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent">
                            {gapTypeLabels[selectedGap.gap_type]}
                          </span>
                          <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${gapStatusClass(selectedGap.status)}`}>
                            {statusLabel(selectedGap.status, statusFlow)}
                          </span>
                          {isFalseRefusalCandidate(selectedGap) && (
                            <span className="rounded-md bg-danger-soft px-2 py-1 text-[11px] font-semibold text-danger">误拒疑似</span>
                          )}
                        </div>
                        <h2 className="text-xl font-semibold leading-snug text-text">{selectedGap.title}</h2>
                        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{selectedGap.representative_question}</p>
                      </div>
                      <div className="grid shrink-0 grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg border border-border bg-surface-page px-3 py-2">
                          <p className="text-[11px] font-semibold text-text-muted">频次</p>
                          <p className="mt-1 text-lg font-semibold text-text">{selectedGap.frequency_count}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-page px-3 py-2">
                          <p className="text-[11px] font-semibold text-text-muted">证据</p>
                          <p className="mt-1 text-lg font-semibold text-text">{selectedGap.retrieval_evidence.length}</p>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-page px-3 py-2">
                          <p className="text-[11px] font-semibold text-text-muted">最高分</p>
                          <p className="mt-1 text-lg font-semibold text-text">{percent(strongestEvidenceScore(selectedGap.retrieval_evidence))}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-border bg-surface-page p-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                          <History className="h-3.5 w-3.5" />
                          最近出现
                        </p>
                        <p className="mt-2 text-sm font-medium text-text">{formatDate(selectedGap.last_seen_at)}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-surface-page p-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          处理动作
                        </p>
                        <p className="mt-2 text-sm font-medium text-text">{actionLabel(selectedGap.status)}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-surface-page p-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                          <Split className="h-3.5 w-3.5" />
                          样本问题
                        </p>
                        <p className="mt-2 text-sm font-medium text-text">{selectedGap.sample_failed_question_ids.length || selectedFailedQuestions.length} 条</p>
                      </div>
                    </div>

                  </div>

                  <div className="rounded-lg border border-border bg-white p-5 shadow-sm-soft">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-text">失败问题样本</h3>
                      <span className="text-xs text-text-muted">用于判断是否转 FAQ、知识卡或文档补充</span>
                    </div>
                    {selectedFailedQuestions.length > 0 ? (
                      <div className="space-y-3">
                        {selectedFailedQuestions.map((item) => (
                          <div key={item.id} className="rounded-lg border border-border bg-surface-page p-4">
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div className="min-w-0">
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <span className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-text-secondary">
                                    {eventTypeLabels[item.event_type]}
                                  </span>
                                  <span className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-text-muted">
                                    置信度 {percent(item.confidence)}
                                  </span>
                                </div>
                                <p className="text-sm font-medium leading-relaxed text-text">{item.question}</p>
                              </div>
                              <span className="shrink-0 text-[11px] text-text-muted">{formatDate(item.created_at)}</span>
                            </div>
                            {(item.corrected_question || item.feedback_comment || item.answer_snapshot) && (
                              <div className="mt-3 grid gap-2 lg:grid-cols-3">
                                {item.corrected_question && (
                                  <p className="rounded-md bg-white px-3 py-2 text-xs leading-relaxed text-text-secondary">
                                    <span className="font-semibold text-text">修正：</span>{item.corrected_question}
                                  </p>
                                )}
                                {item.feedback_comment && (
                                  <p className="rounded-md bg-white px-3 py-2 text-xs leading-relaxed text-text-secondary">
                                    <span className="font-semibold text-text">反馈：</span>{item.feedback_comment}
                                  </p>
                                )}
                                {item.answer_snapshot && (
                                  <p className="rounded-md bg-white px-3 py-2 text-xs leading-relaxed text-text-secondary line-clamp-3">
                                    <span className="font-semibold text-text">回答：</span>{item.answer_snapshot}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title="暂无样本问题"
                        description="当前缺口尚未返回失败问题明细，可先按代表问题处理。"
                      />
                    )}
                  </div>

                  <div className="rounded-lg border border-border bg-white p-5 shadow-sm-soft">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-text">草稿建议</h3>
                      <span className="text-xs text-text-muted">只展示后端/RAG 生成的候选，不在前端编造内容</span>
                    </div>
                    {draftGroups(selectedGap).length > 0 ? (
                      <div className="grid gap-3 lg:grid-cols-2">
                        {draftGroups(selectedGap).flatMap((group) =>
                          group.items.slice(0, 4).map((item, index) => (
                            <div key={`${group.label}-${draftTitle(item)}-${index}`} className="rounded-lg border border-border bg-surface-page p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-text-muted">{group.label}</span>
                                <span className="text-[11px] text-text-muted">{percent(item.confidence)}</span>
                              </div>
                              <h4 className="mt-2 line-clamp-2 text-sm font-semibold leading-relaxed text-text">{draftTitle(item)}</h4>
                              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-text-secondary">{draftSummary(item)}</p>
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-border bg-surface-page px-3 py-4 text-center text-sm text-text-muted">
                        暂无草稿建议，可先聚类失败问题生成候选，再进入人工审核。
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-border bg-white p-5 shadow-sm-soft">
                    <h3 className="mb-4 text-sm font-semibold text-text">检索证据与查询理解</h3>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="mb-2 text-xs font-semibold text-text-muted">候选证据</p>
                        {selectedGap.retrieval_evidence.length > 0 ? (
                          <div className="space-y-2">
                            {selectedGap.retrieval_evidence.slice(0, 5).map((item, index) => (
                              <div key={`${item.document_id || item.chunk_id || index}`} className="rounded-lg border border-border bg-surface-page p-3">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="truncate text-sm font-semibold text-text">{item.title || item.section_path || `证据 ${index + 1}`}</p>
                                  <span className="shrink-0 text-xs text-text-muted">{percent(item.score)}</span>
                                </div>
                                {item.snippet && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-text-secondary">{item.snippet}</p>}
                                {item.retrieval_type && (
                                  <p className="mt-2 text-[11px] font-semibold text-text-muted">命中：{item.retrieval_type}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="rounded-lg border border-border bg-surface-page px-3 py-4 text-center text-sm text-text-muted">暂无候选证据</p>
                        )}
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-semibold text-text-muted">查询理解</p>
                        {selectedGap.query_understanding.length > 0 ? (
                          <div className="space-y-2">
                            {selectedGap.query_understanding.slice(0, 5).map((item, index) => (
                              <div key={`${item.raw_query || index}`} className="rounded-lg border border-border bg-surface-page p-3">
                                <p className="text-sm font-semibold text-text">{item.rewritten_query || item.raw_query || "未命名候选"}</p>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-muted">
                                  {item.intent && <span className="rounded bg-white px-2 py-1">意图：{item.intent}</span>}
                                  <span className="rounded bg-white px-2 py-1">置信度：{percent(item.confidence)}</span>
                                  {(item.terms || []).slice(0, 4).map((term) => (
                                    <span key={term} className="rounded bg-white px-2 py-1">{term}</span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="rounded-lg border border-border bg-surface-page px-3 py-4 text-center text-sm text-text-muted">暂无查询理解记录</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="space-y-4">
                  <div className="rounded-lg border border-border bg-white p-4 shadow-sm-soft">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                      <BookOpenCheck className="h-4 w-4 text-accent" />
                      推荐处理动作
                    </h3>
                    <div className="space-y-2">
                      {recommendActions(selectedGap).map((action, index) => (
                        <div key={action} className="flex items-start gap-3 rounded-lg border border-border bg-surface-page p-3">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-xs font-semibold text-accent">{index + 1}</span>
                          <p className="text-sm leading-relaxed text-text-secondary">{action}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-white p-4 shadow-sm-soft">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                      <CheckCircle2 className="h-4 w-4 text-accent" />
                      状态流
                    </h3>
                    <div className="space-y-2">
                      <div className="rounded-lg border border-border bg-surface-page p-3">
                        <p className="text-xs font-semibold text-text-muted">当前状态</p>
                        <p className="mt-1 text-sm font-semibold text-text">{statusLabel(selectedGap.status, statusFlow)}</p>
                      </div>
                      {(statusFlow?.transitions[selectedGap.status] || []).length > 0 && (
                        <div className="rounded-lg border border-border bg-surface-page p-3">
                          <p className="text-xs font-semibold text-text-muted">可流转到</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {statusFlow?.transitions[selectedGap.status].map((status) => (
                              <span key={status} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-text-secondary">
                                <ArrowRight className="h-3 w-3" />
                                {statusLabel(status, statusFlow)}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-white p-4 shadow-sm-soft">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                      <CircleHelp className="h-4 w-4 text-accent" />
                      分类说明
                    </h3>
                    <div className="space-y-3">
                      {segments.filter((segment) => segment.key !== "all").map(({ key, label, description, icon: Icon }) => (
                        <div key={key} className="flex items-start gap-3 text-sm">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                          <div>
                            <p className="font-semibold text-text">{label}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            ) : (
              <EmptyState
                title="请选择知识缺口"
                description="左侧选择一条缺口后查看样本、证据和推荐动作。"
              />
            )}
          </section>
        </main>
      )}
    </div>
  );
}
