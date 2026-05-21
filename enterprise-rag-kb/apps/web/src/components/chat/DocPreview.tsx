import { useState, useEffect } from "react";
import { X, FileText, ExternalLink, Loader2 } from "lucide-react";
import type { Source } from "../../types";

interface Props {
  source: Source;
  onClose: () => void;
}

export default function DocPreview({ source, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Try to fetch document content via API
    fetch(`/api/documents/${source.document_id}`)
      .then(r => r.json())
      .then(d => {
        const doc = d.data || d;
        setContent(doc.content || doc.full_text || doc.snippet || source.snippet);
      })
      .catch(() => setContent(source.snippet))
      .finally(() => setLoading(false));
  }, [source.document_id, source.snippet]);

  // Highlight the snippet in content
  const highlightContent = (text: string) => {
    if (!text || !source.snippet) return text;
    const snippetStart = source.snippet.substring(0, 40);
    const idx = text.indexOf(snippetStart);
    if (idx === -1) return text;
    const before = text.substring(0, idx);
    const match = text.substring(idx, idx + source.snippet.length);
    const after = text.substring(idx + source.snippet.length);
    return `${before}<mark class="bg-warning-soft text-warning rounded px-0.5">${match}</mark>${after}`;
  };

  return (
    <div className="flex w-96 shrink-0 flex-col border-l border-divider bg-surface overflow-hidden animate-fade-in-right">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-divider">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-accent shrink-0" />
          <h3 className="text-sm font-semibold text-text truncate">{source.document_title}</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Meta */}
      <div className="px-4 py-2 border-b border-divider bg-surface-page/50">
        <p className="text-xs text-text-muted">{source.section_path}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs font-semibold text-accent">相关度 {(source.score * 100).toFixed(0)}%</span>
          <span className="text-[10px] text-text-muted font-mono">{source.chunk_id}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 text-text-muted animate-spin" /></div>
        ) : content ? (
          <div className="prose prose-sm max-w-none text-sm text-text leading-relaxed">
            <div dangerouslySetInnerHTML={{ __html: highlightContent(content).replace(/\n/g, "<br/>") }} />
          </div>
        ) : (
          <p className="text-sm text-text-muted text-center py-12">无法加载文档内容</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-divider">
        <a href={`/documents`} className="flex items-center gap-1.5 text-xs text-accent hover:underline">
          <ExternalLink className="h-3 w-3" />
          在文档管理中打开
        </a>
      </div>
    </div>
  );
}
