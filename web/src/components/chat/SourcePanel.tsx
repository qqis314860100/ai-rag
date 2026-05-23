import { useEffect, useMemo, useState } from "react";
import { X, FileText, ArrowRight, ShieldCheck, Copy, MessageSquare, Layers, Search, ChevronDown, ChevronUp } from "lucide-react";
import type { Source } from "../../types";
import { MarkdownContent } from "./MarkdownContent";

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

const SOURCE_RENDER_LIMIT = 80;
const COLLAPSED_SNIPPET_HEIGHT = 280;

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, "");
}

export default function SourcePanel({ sources, onClose, onFollowUp, onPreview, highlightIdx, onHighlightDone }: SourcePanelProps) {
  const [activeIndex, setActiveIndex] = useState(() => {
    if (highlightIdx != null && sources[highlightIdx]) return highlightIdx;
    return 0;
  });
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

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

  useEffect(() => {
    setExpanded(false);
  }, [activeIndex]);

  const activeSource = sources[activeIndex] || sources[0];
  const activeMeta = useMemo(
    () => scoreMeta(activeSource?.score || 0),
    [activeSource?.score]
  );
  const filteredSources = useMemo(() => {
    const keyword = normalizeText(query.trim());
    const indexed = sources.map((source, index) => ({ source, index }));
    if (!keyword) return indexed;

    return indexed.filter(({ source }) => normalizeText([
      source.document_title,
      source.section_path,
      source.snippet,
      source.content || "",
    ].join(" ")).includes(keyword));
  }, [query, sources]);
  const visibleSources = filteredSources.slice(0, SOURCE_RENDER_LIMIT);

  const handleFollowUpClick = (source: Source) => {
    if (!onFollowUp) return;
    const title = source.document_title || "该文档";
    onFollowUp(`请详细介绍《${title}》中"${source.section_path}"的相关内容`);
  };

  if (!activeSource) return null;

  const ActiveIcon = activeMeta.icon;
  const detailText = activeSource.content || activeSource.snippet || "暂无可展示的引用内容";
  const isLongSnippet = detailText.length > 420;

  return (
    <div className="flex h-full min-h-0 w-80 shrink-0 flex-col bg-[#fbfaf7] overflow-hidden">
      <div className="shrink-0 border-b border-divider bg-white px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-text">证据导航</h3>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              {sources.length} 条引用 · 当前第 {activeIndex + 1} 条
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto chat-scroll-area overscroll-contain">
        <div className="sticky top-0 z-10 border-b border-divider bg-[#fbfaf7]/95 px-4 py-3 backdrop-blur">
          <div className="rounded-2xl border border-border bg-white p-3 shadow-sm-soft">
            <div className="flex items-start gap-2.5">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${activeMeta.bg} ${activeMeta.color}`}>
                {activeIndex + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-snug text-text">{activeSource.document_title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{activeSource.section_path}</p>
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
        </div>

        <div className="space-y-4 p-4">
          <div className="rounded-2xl border border-border bg-white p-4 shadow-sm-soft">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-text">
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-accent" />
                当前片段
              </div>
              {isLongSnippet && (
                <button
                  onClick={() => setExpanded((value) => !value)}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-page px-2 py-1 text-[11px] font-medium text-text-muted hover:text-accent transition-colors"
                >
                  {expanded ? "收起" : "展开"}
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
            </div>
            <div
              className="relative mt-3 overflow-hidden text-sm leading-relaxed text-text-secondary"
              style={{ maxHeight: expanded || !isLongSnippet ? "none" : COLLAPSED_SNIPPET_HEIGHT }}
            >
              <MarkdownContent content={detailText} />
              {!expanded && isLongSnippet && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white to-white/0" />
              )}
            </div>
            {!expanded && isLongSnippet && (
              <button
                onClick={() => setExpanded(true)}
                className="mt-3 w-full rounded-xl border border-dashed border-accent/35 bg-accent-soft/40 px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft transition-colors"
              >
                展开完整片段
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] text-text-muted">
            {activeSource.version && (
              <div className="rounded-lg bg-white px-2 py-1.5 border border-border/60">
                版本 <span className="font-mono text-text-secondary">V{activeSource.version}</span>
              </div>
            )}
            {activeSource.document_type && (
              <div className="rounded-lg bg-white px-2 py-1.5 border border-border/60">
                类型 <span className="text-text-secondary">{activeSource.document_type}</span>
              </div>
            )}
            {activeSource.category && (
              <div className="rounded-lg bg-white px-2 py-1.5 border border-border/60">
                分类 <span className="text-text-secondary">{activeSource.category}</span>
              </div>
            )}
            {activeSource.page_number !== undefined && activeSource.page_number > 0 && (
              <div className="rounded-lg bg-white px-2 py-1.5 border border-border/60">
                页码 <span className="text-text-secondary">{activeSource.page_number}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => navigator.clipboard.writeText(detailText)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-text transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              复制
            </button>
            {onFollowUp && (
              <button
                onClick={() => handleFollowUpClick(activeSource)}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2 text-xs font-medium text-text-secondary hover:border-accent/40 hover:text-accent transition-colors"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                追问
              </button>
            )}
            {onPreview && (
              <button
                onClick={() => onPreview(activeSource)}
                className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent-soft px-3 py-2.5 text-xs font-semibold text-accent hover:bg-accent hover:text-white transition-colors"
              >
                查看原文 <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {sources.length > 1 && (
            <div className="rounded-2xl border border-border bg-white p-3 shadow-sm-soft">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted">
                  <Layers className="h-3.5 w-3.5" />
                  证据索引
                </div>
                <span className="text-[10px] text-text-muted">
                  {filteredSources.length}/{sources.length}
                </span>
              </div>

              <label className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-surface-page px-3 py-2 text-xs text-text-muted focus-within:border-accent/50 focus-within:bg-white transition-colors">
                <Search className="h-3.5 w-3.5" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="按文档、章节或片段搜索"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-muted/70"
                />
              </label>

              <div className="space-y-1">
                {visibleSources.map(({ source, index }) => {
                  const meta = scoreMeta(source.score);
                  const selected = index === activeIndex;
                  return (
                    <button
                      key={`${source.chunk_id}-${index}`}
                      onClick={() => setActiveIndex(index)}
                      className={`grid w-full grid-cols-[1.5rem_1fr_auto] items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors ${
                        selected
                          ? "bg-accent-soft text-text"
                          : "hover:bg-surface-page text-text-secondary"
                      }`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${selected ? "bg-white text-accent" : `${meta.bg} ${meta.color}`}`}>
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">{source.document_title}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-text-muted">{source.section_path}</span>
                      </span>
                      <span className={`text-[10px] font-semibold ${meta.color}`}>
                        {Math.round(source.score * 100)}%
                      </span>
                    </button>
                  );
                })}
              </div>

              {filteredSources.length === 0 && (
                <div className="rounded-xl bg-surface-page px-3 py-6 text-center text-xs text-text-muted">
                  没有匹配的证据
                </div>
              )}

              {filteredSources.length > SOURCE_RENDER_LIMIT && (
                <p className="mt-3 rounded-lg bg-surface-page px-3 py-2 text-[11px] leading-relaxed text-text-muted">
                  已显示前 {SOURCE_RENDER_LIMIT} 条，请继续输入关键词缩小范围。
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
