import { useState } from "react";
import { Search, Zap, Clock, Layers, FileText } from "lucide-react";
import type { SearchParams } from "../components/debugger/SearchForm";
import SearchForm from "../components/debugger/SearchForm";
import DebugResultCard from "../components/debugger/DebugResultCard";
import DebugTrace from "../components/debugger/DebugTrace";
import { api } from "../services/api";
import type { ApiResponse, DebugResult } from "../types";

export default function DebuggerPage() {
  const [result, setResult] = useState<DebugResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ query: string; time: string }>>([]);

  const handleSearch = async (params: SearchParams) => {
    setLoading(true);
    try {
      const filters: Record<string, string | string[]> = {};
      if (params.category) filters.category = params.category;
      if (params.tags) filters.tags = params.tags.split(",").map((t) => t.trim());

      const res = await api.post<ApiResponse<DebugResult>>("/search/debug", {
        query: params.query,
        top_k: params.topK,
        mode: params.mode,
        filters,
        include_prompt: params.includePrompt,
      });
      setResult(res.data);
      setHistory((h) => [{ query: params.query, time: new Date().toLocaleTimeString("zh-CN") }, ...h].slice(0, 10));
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-text tracking-tight">检索调试</h1>
        <p className="mt-1 text-sm text-text-secondary">调试 RAG 检索质量，查看 score、chunk 内容和 prompt</p>
      </div>

      <div className="glass rounded-xl p-5 shadow-sm-soft">
        <SearchForm onSearch={handleSearch} loading={loading} />
      </div>

      {/* Quick stats row when results exist */}
      {result && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: Clock, label: "延迟", value: `${result.retrieval.latency_ms}ms` },
            { icon: Layers, label: "结果数", value: `${result.retrieval.results.length}` },
            { icon: FileText, label: "上下文字符", value: `${result.context_chars}` },
            { icon: Zap, label: "预估Token", value: `${result.estimated_tokens}` },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="glass rounded-xl p-3 text-center shadow-sm-soft">
              <Icon className="h-4 w-4 text-accent mx-auto mb-1" />
              <p className="text-xs text-text-muted">{label}</p>
              <p className="text-sm font-semibold text-text">{value}</p>
            </div>
          ))}
        </div>
      )}

      {result && (
        <>
          <DebugTrace
            query={result.query}
            normalizedQuery={result.normalized_query}
            latencyMs={result.retrieval.latency_ms}
            topK={result.retrieval.top_k}
            mode={result.retrieval.mode}
            contextChars={result.context_chars}
            estimatedTokens={result.estimated_tokens}
            promptPreview={result.prompt_preview}
            resultCount={result.retrieval.results.length}
          />
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-text">检索结果 ({result.retrieval.results.length})</h2>
            {result.retrieval.results.map((hit, idx) => (
              <DebugResultCard key={hit.chunk_id} hit={hit} rank={idx + 1} />
            ))}
          </div>
        </>
      )}

      {/* Search history */}
      {history.length > 0 && (
        <div className="glass rounded-xl p-4 shadow-sm-soft">
          <p className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">搜索历史</p>
          <div className="flex flex-wrap gap-2">
            {history.map((h, i) => (
              <span key={i} className="text-xs text-text-secondary bg-surface-page rounded-full px-3 py-1">
                {h.query} <span className="text-text-muted ml-1">{h.time}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {!result && !loading && history.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Search className="h-10 w-10 text-text-muted/30 mb-3" />
          <p className="text-sm text-text-muted">输入查询关键词并点击检索，查看 RAG 检索调试结果</p>
        </div>
      )}
    </div>
  );
}
