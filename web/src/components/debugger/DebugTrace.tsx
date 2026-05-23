import { useState } from "react";
import { Clock, Database, FileCode, ChevronDown, ChevronRight, Zap } from "lucide-react";
import Card from "../ui/Card";

interface DebugTraceProps {
  query?: string;
  normalizedQuery?: string;
  latencyMs?: number;
  topK?: number;
  mode?: string;
  contextChars?: number;
  estimatedTokens?: number;
  promptPreview?: string;
  resultCount: number;
}

export default function DebugTrace({
  query,
  normalizedQuery,
  latencyMs,
  topK,
  mode,
  contextChars,
  estimatedTokens,
  promptPreview,
  resultCount,
}: DebugTraceProps) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [normalizedOpen, setNormalizedOpen] = useState(false);

  return (
    <div className="space-y-3">
      {/* Trace Summary Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-accent" />
          <div>
            <p className="text-xs text-text-muted">检索耗时</p>
            <p className="text-lg font-semibold text-text">
              {latencyMs !== undefined ? `${latencyMs} ms` : "-"}
            </p>
          </div>
        </Card>

        <Card className="flex items-center gap-3">
          <Database className="h-5 w-5 text-accent" />
          <div>
            <p className="text-xs text-text-muted">结果数 / TopK</p>
            <p className="text-lg font-semibold text-text">
              {resultCount} / {topK ?? "-"}
            </p>
          </div>
        </Card>

        <Card className="flex items-center gap-3">
          <FileCode className="h-5 w-5 text-accent" />
          <div>
            <p className="text-xs text-text-muted">上下文字符数</p>
            <p className="text-lg font-semibold text-text">
              {contextChars !== undefined ? contextChars.toLocaleString() : "-"}
            </p>
          </div>
        </Card>

        <Card className="flex items-center gap-3">
          <Zap className="h-5 w-5 text-accent" />
          <div>
            <p className="text-xs text-text-muted">预估 Tokens</p>
            <p className="text-lg font-semibold text-text">
              {estimatedTokens !== undefined ? estimatedTokens.toLocaleString() : "-"}
            </p>
          </div>
        </Card>
      </div>

      {/* Query Info */}
      {(query || normalizedQuery || mode) && (
        <Card className="space-y-2 text-sm">
          {query && (
            <div className="flex gap-2">
              <span className="shrink-0 text-text-muted">原始查询:</span>
              <span className="text-text">{query}</span>
            </div>
          )}
          {normalizedQuery && normalizedQuery !== query && (
            <div>
              <button
                onClick={() => setNormalizedOpen(!normalizedOpen)}
                className="flex items-center gap-1 text-text-muted hover:text-text"
              >
                {normalizedOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                归一化查询
              </button>
              {normalizedOpen && (
                <p className="mt-1 pl-5 text-text-secondary">{normalizedQuery}</p>
              )}
            </div>
          )}
          {mode && (
            <div className="flex gap-2">
              <span className="text-text-muted">检索模式:</span>
              <span className="rounded bg-primary-soft px-1.5 py-0.5 text-xs font-medium text-primary">
                {mode}
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Prompt Preview */}
      {promptPreview && (
        <Card>
          <button
            onClick={() => setPromptOpen(!promptOpen)}
            className="flex w-full items-center justify-between text-sm"
          >
            <span className="flex items-center gap-2 text-text-secondary">
              <FileCode className="h-4 w-4" />
              Prompt Preview
            </span>
            {promptOpen ? (
              <ChevronDown className="h-4 w-4 text-text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-text-muted" />
            )}
          </button>
          {promptOpen && (
            <div className="mt-3">
              <pre className="max-h-96 overflow-y-auto rounded-md bg-primary-soft/50 p-3 text-xs font-mono text-text-secondary whitespace-pre-wrap leading-relaxed border">
                {promptPreview}
              </pre>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
