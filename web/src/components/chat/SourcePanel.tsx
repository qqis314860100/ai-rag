import { useEffect, useMemo, useState } from "react";
import { X, FileText, ArrowRight, ShieldCheck, Copy, MessageSquare, Layers } from "lucide-react";
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
  const [activeIndex, setActiveIndex] = useState(() => {
    if (highlightIdx != null && sources[highlightIdx]) return highlightIdx;
    return 0;
  });

  useEffect(() => {
    if (highlightIdx == null || !sources[highlightIdx]) return;
    setActiveIndex(highlightIdx);
    const t = setTimeout(() => onHighlightDone?.(), 300);
    return () => clearTimeout(t);
  }, [highlightIdx, onHighlightDone, sources]);

  useEffect(() => {
    if (sources[activeIndex]) return;
    setActiveIndex(0);
  }, [activeIndex, sources]);

  const activeSource = sources[activeIndex] || sources[0];
  const activeMeta = useMemo(
    () => scoreMeta(activeSource?.score || 0),
    [activeSource?.score]
  );

  const handleFollowUpClick = (source: Source) => {
    if (!onFollowUp) return;
    const title = source.document_title || "该文档";
    onFollowUp(`请详细介绍《${title}》中"${source.section_path}"的相关内容`);
  };

  if (!activeSource) return null;

  const ActiveIcon = activeMeta.icon;
  const detailText = activeSource.content || activeSource.snippet || "暂无可展示的引用内容";

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-divider bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-divider">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text">证据详情</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-divider bg-surface-page/60 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${activeMeta.bg} ${activeMeta.color}`}>
              {activeIndex + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-text">{activeSource.document_title}</p>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{activeSource.section_path}</p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${activeMeta.bg} ${activeMeta.color}`}>
              <ActiveIcon className="h-3 w-3" />
              {activeMeta.label}
            </span>
            <span className="text-[11px] font-semibold text-text-secondary">
              相关度 {Math.round(activeSource.score * 100)}%
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${activeMeta.color.replace("text-", "bg-")}`}
                style={{ width: `${Math.round(activeSource.score * 100)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="space-y-2 rounded-xl border border-border bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-text">
              <FileText className="h-3.5 w-3.5 text-accent" />
              引用片段
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
              {detailText}
            </p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-text-muted">
            {activeSource.version && (
              <div className="rounded-lg bg-surface-page px-2 py-1.5">
                版本 <span className="font-mono text-text-secondary">V{activeSource.version}</span>
              </div>
            )}
            {activeSource.document_type && (
              <div className="rounded-lg bg-surface-page px-2 py-1.5">
                类型 <span className="text-text-secondary">{activeSource.document_type}</span>
              </div>
            )}
            {activeSource.category && (
              <div className="rounded-lg bg-surface-page px-2 py-1.5">
                分类 <span className="text-text-secondary">{activeSource.category}</span>
              </div>
            )}
            {activeSource.page_number !== undefined && activeSource.page_number > 0 && (
              <div className="rounded-lg bg-surface-page px-2 py-1.5">
                页码 <span className="text-text-secondary">{activeSource.page_number}</span>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(detailText)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-text transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              复制片段
            </button>
            {onFollowUp && (
              <button
                onClick={() => handleFollowUpClick(activeSource)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-accent transition-colors"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                基于证据追问
              </button>
            )}
            {onPreview && (
              <button
                onClick={() => onPreview(activeSource)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent hover:bg-accent hover:text-white transition-colors"
              >
                查看原文 <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {sources.length > 1 && (
          <div className="border-t border-divider p-3">
            <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-text-muted">
              <Layers className="h-3.5 w-3.5" />
              同一回答的其他证据
            </div>
            <div className="space-y-2">
              {sources.map((source, idx) => {
                const meta = scoreMeta(source.score);
                const selected = idx === activeIndex;
                return (
                  <button
                    key={source.chunk_id}
                    onClick={() => setActiveIndex(idx)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      selected
                        ? "border-accent/50 bg-accent-soft/60"
                        : "border-border bg-surface-page hover:border-accent/30 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${meta.bg} ${meta.color}`}>
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
                        {source.document_title}
                      </span>
                      <span className={`text-[10px] font-semibold ${meta.color}`}>
                        {Math.round(source.score * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 truncate pl-7 text-[11px] text-text-muted">{source.section_path}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
