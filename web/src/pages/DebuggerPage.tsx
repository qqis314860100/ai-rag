import { useState } from "react";
import { Search, Zap, Clock, Layers, FileText } from "lucide-react";
import DebugResultCard from "../components/debugger/DebugResultCard";
import DebugTrace from "../components/debugger/DebugTrace";
import { api } from "../services/api";
import type { ApiResponse, DebugResult } from "../types";

const TOP_K_OPTIONS = [3, 5, 8, 10];
const MODES = ["vector", "hybrid", "keyword"];

export default function DebuggerPage() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [mode, setMode] = useState("vector");
  const [includePrompt, setIncludePrompt] = useState(false);
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [result, setResult] = useState<DebugResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<Array<{ query: string; time: string }>>([]);
  const [showFilters, setShowFilters] = useState(true);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const filters: Record<string, string | string[]> = {};
      if (category) filters.category = category;
      if (tags) filters.tags = tags.split(",").map(t => t.trim()).filter(Boolean);
      const res = await api.post<ApiResponse<DebugResult>>("/search/debug", { query, top_k: topK, mode, filters, include_prompt: includePrompt });
      setResult(res.data);
      setHistory(h => [{ query, time: new Date().toLocaleTimeString("zh-CN") }, ...h].slice(0, 10));
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="p-6 space-y-5 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-text tracking-tight">检索调试</h1><p className="mt-1 text-sm text-text-secondary">调试 RAG 检索质量</p></div>
        <button onClick={() => setShowFilters(!showFilters)} className="text-xs text-text-muted hover:text-text transition-colors">{showFilters ? "收起筛选" : "展开筛选"}</button>
      </div>

      {/* Search Bar + Filters */}
      <div className="glass rounded-xl p-4 shadow-sm-soft space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative"><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key==="Enter" && handleSearch()} placeholder="输入查询关键词..." className="w-full rounded-xl border border-border bg-surface-page pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20" /><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" /></div>
          <button onClick={handleSearch} disabled={loading || !query.trim()} className="rounded-xl bg-accent text-white px-6 py-2.5 text-sm font-medium hover:bg-accent-hover disabled:opacity-40 transition-all active:scale-[0.97] flex items-center gap-2"><Zap className="h-4 w-4" />检索</button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-divider">
            <div className="flex items-center gap-1.5"><span className="text-xs text-text-muted mr-1">TopK</span>{TOP_K_OPTIONS.map(k => <button key={k} onClick={() => setTopK(k)} className={`min-w-[32px] min-h-[32px] rounded-lg text-xs font-medium transition-all flex items-center justify-center ${topK===k?"bg-accent text-white shadow-sm":"text-text-muted hover:bg-surface-hover"}`}>{k}</button>)}</div>
            <div className="flex items-center gap-1.5"><span className="text-xs text-text-muted mr-1">模式</span><select value={mode} onChange={e => setMode(e.target.value)} className="rounded-lg border border-border bg-surface-page px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent/20">{MODES.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
            <div className="flex items-center gap-2"><input value={category} onChange={e => setCategory(e.target.value)} placeholder="分类筛选" className="rounded-lg border border-border bg-surface-page px-3 py-1.5 text-xs w-24 focus:outline-none focus:ring-2 focus:ring-accent/20" /><input value={tags} onChange={e => setTags(e.target.value)} placeholder="标签,逗号分隔" className="rounded-lg border border-border bg-surface-page px-3 py-1.5 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-accent/20" /></div>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer"><input type="checkbox" checked={includePrompt} onChange={e => setIncludePrompt(e.target.checked)} className="rounded" />显示 Prompt</label>
          </div>
        )}
      </div>

      {/* Search History */}
      {history.length > 0 && <div className="flex flex-wrap gap-2">{history.map((h, i) => <button key={i} onClick={() => { setQuery(h.query); handleSearch(); }} className="text-xs text-text-secondary bg-surface-page rounded-full px-3 py-1 hover:bg-surface-hover hover:text-text transition-colors">{h.query}<span className="text-text-muted ml-1.5">{h.time}</span></button>)}</div>}

      {/* Stats Row */}
      {result && (
        <div className="grid grid-cols-4 gap-3">
          {[{ icon: Clock, label: "延迟", value: `${result.retrieval.latency_ms}ms` }, { icon: Layers, label: "结果数", value: `${result.retrieval.results.length}` }, { icon: FileText, label: "上下文", value: `${result.context_chars}字` }, { icon: Zap, label: "Token", value: `${result.estimated_tokens}` }].map(({ icon: Icon, label, value }) => <div key={label} className="glass rounded-xl p-3 text-center shadow-sm-soft"><Icon className="h-4 w-4 text-accent mx-auto mb-1" /><p className="text-xs text-text-muted">{label}</p><p className="text-sm font-semibold text-text">{value}</p></div>)}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <DebugTrace query={result.query} normalizedQuery={result.normalized_query} latencyMs={result.retrieval.latency_ms} topK={result.retrieval.top_k} mode={result.retrieval.mode} contextChars={result.context_chars} estimatedTokens={result.estimated_tokens} promptPreview={result.prompt_preview} resultCount={result.retrieval.results.length} />
          <div className="space-y-3">{result.retrieval.results.map((hit, idx) => <DebugResultCard key={hit.chunk_id} hit={hit} rank={idx+1} />)}</div>
        </div>
      )}

      {!result && !loading && history.length === 0 && <div className="flex flex-col items-center justify-center py-24 text-center"><Search className="h-10 w-10 text-text-muted/20 mb-3" /><p className="text-sm text-text-muted">输入查询关键词开始调试</p></div>}
    </div>
  );
}
