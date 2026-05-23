import { useRef, useEffect } from "react";
import { X, FileText, ArrowRight, ShieldCheck, Copy } from "lucide-react";
import type { Source } from "../../types";

interface SourcePanelProps {
  sources: Source[];
  onClose: () => void;
  onFollowUp?: (query: string) => void;
  onPreview?: (source: Source) => void;
  highlightIdx?: number | null;
  onHighlightDone?: () => void;
}

function scoreMeta(score: number) {
  const pct = Math.round(score * 100);
  if (pct >= 85) return { color: "text-success", bg: "bg-success/10", border: "border-success/30", label: "高可信度", icon: ShieldCheck };
  if (pct >= 65) return { color: "text-accent", bg: "bg-accent/10", border: "border-accent/30", label: "参考引用", icon: FileText };
  return { color: "text-warning", bg: "bg-warning/10", border: "border-warning/30", label: "低相关度", icon: FileText };
}

export default function SourcePanel({ sources, onClose, onFollowUp, onPreview, highlightIdx, onHighlightDone }: SourcePanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll to highlighted source and flash it
  useEffect(() => {
    if (highlightIdx == null || !listRef.current) return;
    const el = listRef.current.children[highlightIdx] as HTMLElement | undefined;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("source-flash");
      const t = setTimeout(() => {
        el.classList.remove("source-flash");
        onHighlightDone?.();
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [highlightIdx, onHighlightDone]);

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
          <FileText className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text">引用来源 · {sources.length} 条</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {sources.map((source, idx) => {
          const meta = scoreMeta(source.score);
          const Icon = meta.icon;

          return (
            <div
              key={source.chunk_id}
              onClick={() => handleSourceClick(source)}
              className={`group rounded-xl border bg-surface-page p-4 cursor-pointer hover:border-accent/40 hover:shadow-md-soft transition-all duration-normal ${meta.border}`}
            >
              {/* Header: rank + document title */}
              <div className="flex items-start gap-2.5">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${meta.bg} ${meta.color}`}>
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text group-hover:text-accent transition-colors leading-snug">
                    {source.document_title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {source.version && (
                      <span className="text-[10px] text-text-muted bg-surface-hover rounded px-1.5 py-0.5 font-mono">
                        V{source.version}
                      </span>
                    )}
                    {source.document_type && (
                      <span className="text-[10px] text-text-muted bg-surface-hover rounded px-1.5 py-0.5">
                        {source.document_type}
                      </span>
                    )}
                    {source.category && (
                      <span className="text-[10px] text-text-muted bg-surface-hover rounded px-1.5 py-0.5">
                        {source.category}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Section path */}
              <div className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
                <span className="text-text-muted/50">章节</span>
                <span className="text-text-secondary font-medium">{source.section_path}</span>
              </div>

              {/* Score bar */}
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${meta.color.replace("text-", "bg-")}`}
                    style={{ width: `${Math.round(source.score * 100)}%` }}
                  />
                </div>
                <span className={`text-[11px] font-semibold ${meta.color}`}>
                  {Math.round(source.score * 100)}%
                </span>
              </div>

              {/* Snippet */}
              <p className="mt-3 text-xs leading-relaxed text-text-secondary line-clamp-3 pl-3 border-l-2 border-border/50">
                {source.snippet}
              </p>

              {/* Actions */}
              <div className="mt-3 flex items-center gap-2 pt-2.5 border-t border-divider">
                <span className="flex items-center gap-1 text-[10px] text-text-muted" title={meta.label}>
                  <Icon className="h-3 w-3" />
                  {meta.label}
                </span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(source.snippet);
                  }}
                  className="ml-auto rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text transition-colors"
                  title="复制引用内容"
                >
                  <Copy className="h-3 w-3" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSourceClick(source);
                  }}
                  className="rounded-md px-2 py-1 text-[11px] text-accent hover:bg-accent-soft transition-colors font-medium inline-flex items-center gap-1"
                >
                  查看原文 <ArrowRight size={10} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
