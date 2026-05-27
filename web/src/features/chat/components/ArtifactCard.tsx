import { AlertCircle, BarChart3, Brain, CheckCircle2, Clock, Eye, FileText, Network, Workflow, XCircle } from "lucide-react";
import type { ChatArtifact } from "../types";

interface ArtifactCardProps {
  artifact: ChatArtifact;
  onOpen: (artifact: ChatArtifact) => void;
}

function artifactLabel(artifact: ChatArtifact) {
  if (artifact.type === "diagram") return artifact.metadata?.subtype === "architecture" ? "架构图" : "图解";
  if (artifact.type === "mindmap") return "思维导图";
  if (artifact.type === "flowchart") return "流程图";
  if (artifact.type === "chart") return "图表";
  return artifact.type || "产物";
}

function StatusBadge({ status }: { status: ChatArtifact["status"] }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-success-soft px-2 py-1 text-[11px] font-medium text-success">
        <CheckCircle2 className="h-3 w-3" />
        可查看
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-danger-soft px-2 py-1 text-[11px] font-medium text-danger">
        <XCircle className="h-3 w-3" />
        失败
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-2 py-1 text-[11px] font-medium text-text-muted">
      <Clock className="h-3 w-3" />
      处理中
    </span>
  );
}

export default function ArtifactCard({ artifact, onOpen }: ArtifactCardProps) {
  const Icon = artifact.type === "mindmap"
    ? Brain
    : artifact.type === "flowchart"
      ? Workflow
      : artifact.type === "diagram"
        ? Network
        : artifact.type === "chart"
          ? BarChart3
          : FileText;
  const isReady = artifact.status === "ready";
  const confidence = artifact.confidence > 0 ? `${Math.round(artifact.confidence * 100)}%` : null;
  const evidenceLabel = [
    confidence ? `可信度 ${confidence}` : "",
    artifact.source_ids.length > 0 ? `${artifact.source_ids.length} 条证据` : "",
  ].filter(Boolean).join(" · ");

  return (
    <article className="rounded-xl border border-border bg-white px-3 py-3 shadow-sm-soft">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={artifact.status} />
            {evidenceLabel && (
              <span className="text-[11px] font-medium text-text-muted">{evidenceLabel}</span>
            )}
          </div>
          <h3 className="mt-1.5 line-clamp-1 text-sm font-semibold leading-snug text-text">
            <span className="mr-1.5 text-[11px] font-semibold text-accent">{artifactLabel(artifact)}</span>
            {artifact.title || "AI 整理产物"}
          </h3>
          {artifact.summary && (
            <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-text-secondary">
              {artifact.summary}
            </p>
          )}
          {artifact.reason && (
            <p className="mt-2 inline-flex max-w-full items-start gap-1.5 rounded-lg bg-surface-page px-2 py-1.5 text-[11px] leading-relaxed text-text-muted">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{artifact.reason}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpen(artifact)}
          disabled={!isReady}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-page px-2.5 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          title={isReady ? "查看产物" : "产物未就绪"}
        >
          <Eye className="h-3.5 w-3.5" />
          查看
        </button>
      </div>
    </article>
  );
}
