import { X, FileText, ExternalLink, ArrowRight, Target } from "lucide-react";
import type { Source } from "../../types";

interface SourcePanelProps {
  sources: Source[];
  onClose: () => void;
  onFollowUp?: (query: string) => void;
  onPreview?: (source: Source) => void;
}

export default function SourcePanel({ sources, onClose, onFollowUp, onPreview }: SourcePanelProps) {
  const handleSourceClick = (source: Source) => {
    if (onPreview) { onPreview(source); return; }
    if (onFollowUp) {
      const title = source.document_title || "该文档";
      onFollowUp(`请详细介绍《${title}》中"${source.section_path}"的相关内容`);
    }
  };

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-divider bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-divider">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text">引用来源 · {sources.length}</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {sources.map((source, idx) => {
          const scorePct = Math.round(source.score * 100);
          const scoreColor = scorePct >= 80 ? "text-success" : scorePct >= 60 ? "text-accent" : "text-warning";
          const scoreBg = scorePct >= 80 ? "bg-success/10" : scorePct >= 60 ? "bg-accent/10" : "bg-warning/10";

          return (
            <div
              key={source.chunk_id}
              onClick={() => handleSourceClick(source)}
              className="group rounded-xl border border-border bg-surface-page p-3.5 cursor-pointer hover:border-accent/30 hover:shadow-md-soft transition-all duration-normal"
            >
              {/* Rank + Title */}
              <div className="flex items-start gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-xs font-bold text-accent">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text group-hover:text-accent transition-colors leading-snug line-clamp-2">
                    {source.document_title}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{source.section_path}</p>
                </div>
                {/* Score badge */}
                <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${scoreColor} ${scoreBg}`}>
                  {scorePct}%
                </span>
              </div>

              {/* Score bar */}
              <div className="mt-2.5 h-1 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-700 ease-out"
                  style={{ width: `${scorePct}%` }}
                />
              </div>

              {/* Snippet */}
              <p className="mt-2.5 text-xs leading-relaxed text-text-secondary line-clamp-3">{source.snippet}</p>

              {/* Footer */}
              <div className="mt-2.5 flex items-center gap-2 pt-2 border-t border-divider">
                <FileText className="h-3 w-3 text-text-muted" />
                <span className="text-[10px] text-text-muted font-mono truncate">{source.chunk_id}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(source.snippet); }}
                  className="ml-auto rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text transition-colors"
                  title="复制引用内容"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
                {onFollowUp && (
                  <span className="flex items-center gap-0.5 text-accent text-xs opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                    追问 <ArrowRight size={10} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
