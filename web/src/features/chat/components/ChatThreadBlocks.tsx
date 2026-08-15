import { AlertCircle, ChevronRight, MessageSquare, RefreshCw, StopCircle } from "lucide-react";
import { StreamStages } from "./StreamStages";

export function StreamingPendingCard({ onCancelStream }: { onCancelStream: () => void }) {
  return (
    <div className="relative min-w-[18rem] rounded-2xl border border-border/60 bg-surface-page px-5 py-4 shadow-sm-soft">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-accent">
          <MessageSquare className="h-3.5 w-3.5" />
          正在准备回答...
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        </div>
        <button type="button" onClick={onCancelStream} className="rounded p-1 text-text-muted transition-colors hover:text-danger" title="停止生成">
          <StopCircle size={14} />
        </button>
      </div>
      <StreamStages />
    </div>
  );
}

export function FollowUpList({ items, onFollowUp }: { items?: string[]; onFollowUp: (query: string) => void }) {
  if (!items?.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onFollowUp(question)}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent"
        >
          {question}
          <ChevronRight className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}

export function ThreadInlineStatus({
  streamError,
  streamStopped,
  onRetry,
}: {
  streamError: string | null;
  streamStopped: boolean;
  onRetry: () => void;
}) {
  if (streamError && !streamStopped) {
    return (
      <div className="flex flex-col items-start">
        <div className="flex items-center gap-2 text-sm text-danger">
          <AlertCircle className="h-4 w-4" />
          {streamError}
        </div>
        <button type="button" onClick={onRetry} className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
          <RefreshCw className="h-3 w-3" />
          重试
        </button>
      </div>
    );
  }

  if (streamStopped) {
    return (
      <div className="flex flex-col items-start">
        <span className="text-sm text-text-muted">已中断</span>
        <button type="button" onClick={onRetry} className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
          <RefreshCw className="h-3 w-3" />
          重试
        </button>
      </div>
    );
  }

  return null;
}

export function FeedbackReasonPopup({
  feedbackReason,
  onSubmit,
  onCancel,
}: {
  feedbackReason: string | null;
  onSubmit: (messageId: string, reason: string) => void;
  onCancel: () => void;
}) {
  if (!feedbackReason) return null;

  return (
    <div className="sticky bottom-16 z-20 mx-auto w-full max-w-xs animate-fade-in-up rounded-xl border border-border bg-white p-3 shadow-lg-soft">
      <p className="mb-2 text-xs font-medium text-text">为什么觉得不够好？</p>
      <div className="flex flex-wrap gap-1.5">
        {[
          { label: "内容过时", reason: "outdated" },
          { label: "匹配错误", reason: "mismatch" },
          { label: "逻辑混乱", reason: "confusing" },
          { label: "信息不全", reason: "incomplete" },
          { label: "其他", reason: "other" },
        ].map(({ label, reason }) => (
          <button
            key={reason}
            type="button"
            onClick={() => onSubmit(feedbackReason, reason)}
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-secondary transition-all hover:border-accent hover:text-accent"
          >
            {label}
          </button>
        ))}
      </div>
      <button type="button" onClick={onCancel} className="mt-2 text-[10px] text-text-muted transition-colors hover:text-text">
        取消
      </button>
    </div>
  );
}
