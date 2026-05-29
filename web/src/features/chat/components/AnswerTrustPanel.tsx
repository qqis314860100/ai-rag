import { AlertCircle, FileCheck, FileSearch } from "lucide-react";
import type { Source } from "../types";
import type { AnswerTrustSummary } from "./chatThreadUtils";

const trustToneClass: Record<AnswerTrustSummary["tone"], { text: string; badge: string; icon: string }> = {
  strong: { text: "text-success", badge: "bg-success-soft text-success", icon: "text-success" },
  medium: { text: "text-accent", badge: "bg-accent-soft text-accent", icon: "text-accent" },
  weak: { text: "text-warning", badge: "bg-warning-soft text-warning", icon: "text-warning" },
  danger: { text: "text-danger", badge: "bg-danger-soft text-danger", icon: "text-danger" },
  neutral: { text: "text-text-secondary", badge: "bg-surface-hover text-text-secondary", icon: "text-text-muted" },
};

interface AnswerTrustPanelProps {
  summary: AnswerTrustSummary;
  sources?: Source[];
  isOpen: boolean;
  onToggleSources: () => void;
  onSourceAnchor?: (sources: Source[], index: number) => void;
}

function coverageText(summary: AnswerTrustSummary) {
  if (summary.claimCount > 0) return `${summary.supportedClaimCount}/${summary.claimCount} 条结论有引用`;
  if (summary.citedSourceCount > 0) return `${summary.citedSourceCount} 条引用支撑`;
  if (summary.sourceCount > 0) return `${summary.sourceCount} 条相关资料`;
  return "暂无引用";
}

function warningSummary(summary: AnswerTrustSummary) {
  const errorCount = summary.warnings.filter((warning) => warning.severity === "error").length;
  const primary = summary.warnings.find((warning) => warning.severity === "error") ?? summary.warnings[0];
  if (!primary) return "";
  const prefix = errorCount > 0 ? "高风险提示" : "核验提示";
  const suffix = summary.warnings.length > 1 ? `，另有 ${summary.warnings.length - 1} 条` : "";
  return `${prefix}：${primary.message}${suffix}`;
}

export default function AnswerTrustPanel({
  summary,
  sources,
  isOpen,
  onToggleSources,
  onSourceAnchor,
}: AnswerTrustPanelProps) {
  const tone = trustToneClass[summary.tone];
  const coverageRatioLabel = summary.claimCoverageRatio !== undefined && summary.claimCount > 0
    ? `${Math.round(summary.claimCoverageRatio * 100)}%`
    : "";
  const visibleWarning = warningSummary(summary);
  const hasSources = Boolean(sources?.length);

  return (
    <div className="mt-4 border-t border-divider/70 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${tone.text}`}>
          {summary.tone === "strong" ? <FileCheck className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          可信度 {summary.confidenceLabel}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-text-secondary">
          <FileSearch className={`h-3.5 w-3.5 shrink-0 ${tone.icon}`} />
          <span className="truncate">{coverageText(summary)}</span>
          {coverageRatioLabel && <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone.badge}`}>{coverageRatioLabel}</span>}
        </span>
        {summary.conflictCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">
            <AlertCircle className="h-3.5 w-3.5" />
            {summary.conflictLabels.join("、")}
          </span>
        )}
        {hasSources && (
          <button
            type="button"
            onClick={onToggleSources}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-page px-2.5 py-1.5 font-medium text-text-secondary transition-colors hover:border-accent/40 hover:bg-accent-soft/50 hover:text-accent"
          >
            <FileSearch className="h-3.5 w-3.5" />
            {isOpen ? "收起证据" : "查看证据"}
            <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">{sources?.length}</span>
          </button>
        )}
      </div>
      {visibleWarning && (
        <div className="mt-2 flex min-w-0 items-center gap-1.5 rounded-lg bg-surface-page px-2.5 py-1.5 text-[12px] leading-relaxed text-text-secondary">
          <AlertCircle className={`h-3.5 w-3.5 shrink-0 ${summary.tone === "danger" ? "text-danger" : "text-warning"}`} />
          <span className="min-w-0 flex-1 truncate" title={visibleWarning}>{visibleWarning}</span>
          {summary.warnings.some((warning) => warning.citationIds.length > 0) && (
            <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[11px] text-text-muted">
              见引用
            </span>
          )}
        </div>
      )}
      {hasSources && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources!.slice(0, 3).map((source, index) => (
            <button
              key={`${source.chunk_id}-${index}`}
              type="button"
              onClick={() => onSourceAnchor?.(sources!, index)}
              className="max-w-full truncate rounded-md border border-border bg-surface-page px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
              title={source.document_title || source.section_path || `证据 ${index + 1}`}
            >
              {index + 1}. {source.document_title || source.section_path || "引用资料"}
            </button>
          ))}
          {sources!.length > 3 && (
            <span className="rounded-md bg-surface-hover px-2 py-1 text-[11px] text-text-muted">
              另有 {sources!.length - 3} 条
            </span>
          )}
        </div>
      )}
    </div>
  );
}
