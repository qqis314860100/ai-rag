import { useEffect } from "react";
import { Code2, Maximize2, Network, X } from "lucide-react";
import type { ChatArtifact, DiagramIR } from "../../types";
import { DiagramCanvas } from "./DiagramModal";

interface ArtifactModalProps {
  artifact: ChatArtifact;
  onClose: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDiagramIR(artifact: ChatArtifact): DiagramIR | null {
  if (!isRecord(artifact.payload)) return null;
  const nodes = artifact.payload.nodes;
  const edges = artifact.payload.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;

  return {
    title: typeof artifact.payload.title === "string" ? artifact.payload.title : artifact.title,
    objective: typeof artifact.payload.objective === "string" ? artifact.payload.objective : "",
    diagram_type: typeof artifact.payload.diagram_type === "string" ? artifact.payload.diagram_type : artifact.type,
    layout_hint: typeof artifact.payload.layout_hint === "string" ? artifact.payload.layout_hint : "",
    nodes: nodes as DiagramIR["nodes"],
    edges: edges as DiagramIR["edges"],
    notes: Array.isArray(artifact.payload.notes) ? artifact.payload.notes as string[] : [],
    metadata: isRecord(artifact.payload.metadata) ? artifact.payload.metadata : {},
  };
}

function artifactKindLabel(artifact: ChatArtifact) {
  if (artifact.type === "mindmap") return "思维导图";
  if (artifact.type === "flowchart") return "流程图";
  return artifact.type || "产物";
}

export default function ArtifactModal({ artifact, onClose }: ArtifactModalProps) {
  const diagram = toDiagramIR(artifact);
  const nodeCount = diagram?.nodes.length ?? 0;
  const edgeCount = diagram?.edges.length ?? 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 px-4 py-6 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mx-auto flex h-full max-h-[880px] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-xl-soft"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-divider px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Network className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-text-muted">
                {artifactKindLabel(artifact)}
                {diagram ? ` · ${nodeCount} 节点 · ${edgeCount} 连线` : " · 原始数据"}
              </p>
              <h2 className="truncate text-base font-semibold text-text">{artifact.title || "AI 整理产物"}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {diagram && (
              <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface-page px-2.5 py-1.5 text-xs text-text-muted sm:inline-flex">
                <Maximize2 className="h-3.5 w-3.5" />
                滚动查看
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
              title="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-surface-page p-5">
          {diagram ? (
            <DiagramCanvas diagram={diagram} />
          ) : (
            <div className="rounded-2xl border border-border bg-white p-4 shadow-sm-soft">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-secondary">
                <Code2 className="h-4 w-4 text-accent" />
                Artifact Payload
              </div>
              <pre className="max-h-[640px] overflow-auto rounded-xl bg-[#111827] p-4 text-xs leading-relaxed text-[#E5E7EB]">
                {JSON.stringify(artifact.payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
