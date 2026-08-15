import { AlertCircle, CircleHelp, FileCheck, X } from "lucide-react";
import type { AnswerQualityNotice, QueryUnderstandingNotice } from "./chatThreadUtils";

const queryNoticeToneClass: Record<QueryUnderstandingNotice["tone"], string> = {
  confirmed: "border-success/20 bg-success-soft/45 text-success",
  inferred: "border-accent/20 bg-accent-soft/45 text-accent",
  confirmation: "border-warning/25 bg-warning-soft/70 text-warning",
};

const answerQualityToneClass: Record<AnswerQualityNotice["tone"], string> = {
  answerable: "border-success/20 bg-success-soft/45 text-success",
  grey_answer: "border-accent/20 bg-accent-soft/45 text-accent",
  partial_answer: "border-warning/25 bg-warning-soft/70 text-warning",
  refused: "border-danger/20 bg-danger-soft/70 text-danger",
};

export function StreamingPlainText({ content }: { content: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-text">
      {content}
    </div>
  );
}

export function QueryUnderstandingHint({ notice }: { notice: QueryUnderstandingNotice }) {
  const Icon = notice.tone === "confirmed" ? FileCheck : notice.tone === "confirmation" ? AlertCircle : CircleHelp;

  return (
    <div className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] leading-relaxed ${queryNoticeToneClass[notice.tone]}`}>
      <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold">
        <Icon className="h-3.5 w-3.5" />
        {notice.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-secondary" title={notice.text}>{notice.text}</span>
      {notice.terms.map((term) => (
        <span key={term} className="hidden max-w-[9rem] truncate rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary sm:inline">
          {term}
        </span>
      ))}
    </div>
  );
}

export function AnswerQualityHint({ notice }: { notice: AnswerQualityNotice }) {
  const Icon = notice.tone === "answerable" ? FileCheck : notice.tone === "refused" ? X : notice.tone === "partial_answer" ? AlertCircle : CircleHelp;

  return (
    <div className={`mb-2 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] leading-relaxed ${answerQualityToneClass[notice.tone]}`}>
      <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold">
        <Icon className="h-3.5 w-3.5" />
        {notice.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-text-secondary" title={notice.text}>{notice.text}</span>
      {notice.confidence !== undefined && notice.confidence > 0 && (
        <span className="shrink-0 rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
          {Math.round(notice.confidence * 100)}%
        </span>
      )}
    </div>
  );
}
