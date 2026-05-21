import { useState, useEffect } from "react";
import { X, FileText, ExternalLink, Loader2, Eye } from "lucide-react";
import type { Source } from "../../types";
import { api } from "../../services/api";

interface Props { source: Source; onClose: () => void; }

export default function DocPreview({ source, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Track citation view
    api.post("/stats/browse", { event_type: "source_view", resource_type: "chunk", resource_id: source.chunk_id, metadata: { document_title: source.document_title, score: source.score } }).catch(() => {});
    // Use snippet directly — ChromaDB document_id doesn't match SQLite documents table
    setContent(source.snippet || null);
    setLoading(false);
  }, [source.chunk_id, source.snippet]);

  const highlightContent = (text: string) => {
    if (!text || !source.snippet) return text;
    const snippetStart = source.snippet.substring(0, 60);
    const idx = text.indexOf(snippetStart);
    if (idx === -1) return text.replace(/\n/g, "<br/>");
    const before = text.substring(Math.max(0, idx - 100), idx);
    const match = text.substring(idx, idx + Math.min(source.snippet.length, 500));
    const after = text.substring(idx + Math.min(source.snippet.length, 500), idx + Math.min(source.snippet.length, 500) + 200);
    return `${before ? `<span class="text-text-muted">…</span>${before.replace(/\n/g,"<br/>")}` : ""}<mark class="bg-warning-soft text-warning rounded px-0.5">${match.replace(/\n/g,"<br/>")}</mark>${after.replace(/\n/g,"<br/>")}${text.length > idx + source.snippet.length + 200 ? `<span class="text-text-muted">…</span>` : ""}`;
  };

  return (
    <div className="flex h-full flex-col bg-surface overflow-hidden animate-fade-in-right">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-accent shrink-0" />
          <h3 className="text-sm font-semibold text-text truncate">{source.document_title}</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text transition-colors"><X className="h-4 w-4" /></button>
      </div>

      <div className="px-4 py-2 border-b border-divider bg-surface-page/50 shrink-0">
        <p className="text-xs text-text-muted">{source.section_path}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs font-semibold text-accent">相关度 {(source.score * 100).toFixed(0)}%</span>
          <span className="text-[10px] text-text-muted font-mono">{source.chunk_id?.substring(0,16)}</span>
          <span className="text-[10px] text-text-muted flex items-center gap-1"><Eye className="h-2.5 w-2.5" />已记录</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 text-text-muted animate-spin" /></div>
        ) : content ? (
          <div className="prose prose-sm max-w-none text-sm text-text leading-relaxed" dangerouslySetInnerHTML={{ __html: highlightContent(content) }} />
        ) : (
          <div className="text-center py-12">
            <FileText className="h-8 w-8 text-text-muted/30 mx-auto mb-2" />
            <p className="text-sm text-text-muted">无法加载全文</p>
            <p className="text-xs text-text-muted mt-1">{source.snippet?.substring(0, 100)}...</p>
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-divider shrink-0 flex items-center justify-between">
        <a href="/documents" className="flex items-center gap-1.5 text-xs text-accent hover:underline"><ExternalLink className="h-3 w-3" />文档管理</a>
        <span className="text-[10px] text-text-muted">chunk: {source.chunk_id?.substring(0, 12)}</span>
      </div>
    </div>
  );
}
