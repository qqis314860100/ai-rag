import { FileText, Hash } from "lucide-react";
import type { SearchHit } from "../../types";
import Badge, { getBadgeLabel } from "../ui/Badge";

interface DebugResultCardProps {
  hit: SearchHit;
  rank: number;
}

export default function DebugResultCard({ hit, rank }: DebugResultCardProps) {
  const scorePercent = (hit.score * 100).toFixed(1);

  return (
    <div className="rounded-md border bg-surface p-4 shadow-sm-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary-soft text-xs font-bold text-primary">
            {rank}
          </span>
          <div className="min-w-0">
            <h4 className="font-medium text-sm text-text truncate">
              {hit.document_title}
            </h4>
            <p className="text-xs text-text-muted mt-0.5 flex items-center gap-2">
              <FileText className="h-3 w-3" />
              {hit.section_path || "/"}
              {hit.page_number && (
                <span>· 第{hit.page_number}页</span>
              )}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
              hit.score >= 0.8
                ? "bg-success-soft text-success"
                : hit.score >= 0.6
                  ? "bg-accent-soft text-accent"
                  : hit.score >= 0.4
                    ? "bg-warning-soft text-warning"
                    : "bg-error-soft text-error"
            }`}
          >
            {scorePercent}%
          </span>
        </div>
      </div>

      {/* Score bar */}
      <div className="mt-3 h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${hit.score * 100}%` }}
        />
      </div>

      {/* Content */}
      <div className="mt-3">
        <p className="text-sm leading-relaxed text-text-secondary whitespace-pre-wrap">
          {hit.content}
        </p>
      </div>

      {/* Metadata */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2">
        <span className="flex items-center gap-1 text-xs text-text-muted font-mono">
          <Hash className="h-3 w-3" />
          {hit.chunk_id}
        </span>
        {hit.metadata &&
          Object.entries(hit.metadata).map(([key, value]) => (
            <Badge
              key={key}
              variant={
                key === "security_level"
                  ? (value as string) as "public" | "internal" | "confidential" | "restricted"
                  : "active"
              }
            >
              {key === "security_level"
                ? getBadgeLabel(value as "public" | "internal" | "confidential" | "restricted")
                : `${key}: ${String(value)}`}
            </Badge>
          ))}
      </div>
    </div>
  );
}
