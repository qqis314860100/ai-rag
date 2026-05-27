import { useEffect } from "react";
import { Code2, Maximize2, Network, X } from "lucide-react";
import type { ChatArtifact, DiagramEdge, DiagramIR, DiagramLane, DiagramNode } from "../types";
import { DiagramCanvas } from "./DiagramModal";

interface ArtifactModalProps {
  artifact: ChatArtifact;
  onClose: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNode(value: unknown): DiagramNode | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string") return null;
  return {
    id: value.id,
    label: value.label,
    kind: typeof value.kind === "string" ? value.kind : "topic",
    description: typeof value.description === "string" ? value.description : "",
    source_ids: Array.isArray(value.source_ids) ? value.source_ids.filter((id): id is string => typeof id === "string") : [],
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
}

function normalizeEdge(value: unknown, nodeIds: Set<string>): DiagramEdge | null {
  if (!isRecord(value) || typeof value.source !== "string" || typeof value.target !== "string") return null;
  if (!nodeIds.has(value.source) || !nodeIds.has(value.target)) return null;
  return {
    source: value.source,
    target: value.target,
    relation: typeof value.relation === "string" ? value.relation : "relates_to",
    label: typeof value.label === "string" ? value.label : "",
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
}

function normalizeLane(value: unknown): DiagramLane | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string") return null;
  return {
    id: value.id,
    label: value.label,
    order: typeof value.order === "number" ? value.order : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
}

function toDiagramIR(artifact: ChatArtifact): DiagramIR | null {
  if (!isRecord(artifact.payload)) return null;
  const rawNodes = artifact.payload.nodes;
  const rawEdges = artifact.payload.edges;
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) return null;
  const nodes = rawNodes.map(normalizeNode).filter((node): node is DiagramNode => Boolean(node));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = rawEdges.map((edge) => normalizeEdge(edge, nodeIds)).filter((edge): edge is DiagramEdge => Boolean(edge));
  const lanes = Array.isArray(artifact.payload.lanes)
    ? artifact.payload.lanes.map(normalizeLane).filter((lane): lane is DiagramLane => Boolean(lane))
    : [];
  if (nodes.length === 0) return null;

  return {
    title: typeof artifact.payload.title === "string" ? artifact.payload.title : artifact.title,
    objective: typeof artifact.payload.objective === "string" ? artifact.payload.objective : "",
    type: typeof artifact.payload.type === "string"
      ? artifact.payload.type
      : typeof artifact.payload.diagram_type === "string"
        ? artifact.payload.diagram_type
        : artifact.type,
    layout_hint: typeof artifact.payload.layout_hint === "string" ? artifact.payload.layout_hint : "",
    nodes,
    edges,
    lanes,
    notes: Array.isArray(artifact.payload.notes) ? artifact.payload.notes as string[] : [],
    renderer: typeof artifact.payload.renderer === "string" ? artifact.payload.renderer : undefined,
    reason: typeof artifact.payload.reason === "string" ? artifact.payload.reason : undefined,
    confidence: typeof artifact.payload.confidence === "number" ? artifact.payload.confidence : undefined,
    can_generate: typeof artifact.payload.can_generate === "boolean" ? artifact.payload.can_generate : undefined,
    quality_score: typeof artifact.payload.quality_score === "number" ? artifact.payload.quality_score : undefined,
    quality_warnings: Array.isArray(artifact.payload.quality_warnings) ? artifact.payload.quality_warnings as DiagramIR["quality_warnings"] : undefined,
    validation: isRecord(artifact.payload.validation) ? artifact.payload.validation as DiagramIR["validation"] : null,
    source_evidence: Array.isArray(artifact.payload.source_evidence) ? artifact.payload.source_evidence as Record<string, unknown>[] : undefined,
    excalidraw_scene: isRecord(artifact.payload.excalidraw_scene) ? artifact.payload.excalidraw_scene : null,
    metadata: isRecord(artifact.payload.metadata) ? artifact.payload.metadata : {},
  };
}

function artifactKindLabel(artifact: ChatArtifact) {
  if (artifact.type === "diagram") return artifact.metadata?.subtype === "architecture" ? "架构图" : "图解";
  if (artifact.type === "mindmap") return "思维导图";
  if (artifact.type === "flowchart") return "流程图";
  if (artifact.type === "chart") return "图表";
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
