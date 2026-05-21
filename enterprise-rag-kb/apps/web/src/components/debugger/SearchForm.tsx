import { useState, type FormEvent } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Button, Input } from "../ui";

interface SearchFormProps {
  onSearch: (params: SearchParams) => void;
  loading: boolean;
}

export interface SearchParams {
  query: string;
  topK: number;
  mode: string;
  category: string;
  tags: string;
  includePrompt: boolean;
}

const MODES = [
  { value: "vector", label: "向量检索" },
  { value: "hybrid", label: "混合检索" },
  { value: "keyword", label: "关键词" },
];

const TOP_K_OPTIONS = [3, 5, 8, 10, 15, 20];

export default function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(8);
  const [mode, setMode] = useState("vector");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [includePrompt, setIncludePrompt] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;
    onSearch({ query: query.trim(), topK, mode, category: category.trim(), tags: tags.trim(), includePrompt });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <div className="flex-1">
          <Input
            placeholder="输入检索查询，如：CCD 检测频繁误判可能是什么原因？"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="text-sm"
          />
        </div>
        <Button type="submit" loading={loading} disabled={!query.trim()}>
          <Search className="h-4 w-4" />
          检索
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowFilters(!showFilters)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          筛选
        </Button>
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 gap-4 rounded-md border bg-surface p-4 md:grid-cols-4">
          {/* TopK */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">TopK</label>
            <select
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="rounded-md border bg-surface-page px-2 py-1.5 text-sm text-text focus:border-accent focus:outline-none"
            >
              {TOP_K_OPTIONS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>

          {/* Mode */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">检索模式</label>
            <div className="flex gap-1">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    mode === m.value
                      ? "bg-accent-soft text-accent"
                      : "bg-surface-page text-text-secondary hover:bg-primary-soft"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Category filter */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">分类筛选</label>
            <Input
              placeholder="如: 检测设备"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          {/* Tags filter */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-secondary">标签筛选</label>
            <Input
              placeholder="逗号分隔"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          {/* Include prompt toggle */}
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={includePrompt}
                onChange={(e) => setIncludePrompt(e.target.checked)}
                className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
              />
              包含 Prompt Preview
            </label>
          </div>
        </div>
      )}
    </form>
  );
}
