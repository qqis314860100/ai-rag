import { lazy, Suspense, useEffect } from "react";
import { Maximize2, Network, X } from "lucide-react";
import type { DiagramIR } from "../../types";

interface DiagramModalProps {
  diagram: DiagramIR;
  onClose: () => void;
}

const ExcalidrawDiagramCanvas = lazy(() => import("./ExcalidrawDiagramCanvas"));

function diagramLabel(diagram: DiagramIR) {
  if (diagram.type === "flowchart") return "流程图";
  if (diagram.type === "diagram") return "图解";
  if (diagram.type === "chart") return "图表";
  return "思维导图";
}

export function DiagramCanvas({ diagram }: { diagram: DiagramIR }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-[620px] min-w-[860px] items-center justify-center rounded-xl border border-border bg-white text-sm text-text-muted shadow-sm-soft">
          正在加载白板图解...
        </div>
      }
    >
      <ExcalidrawDiagramCanvas diagram={diagram} />
    </Suspense>
  );
}

export default function DiagramModal({ diagram, onClose }: DiagramModalProps) {
  const nodeCount = diagram.nodes.length;
  const edgeCount = diagram.edges.length;

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
                {diagramLabel(diagram)} · {nodeCount} 节点 · {edgeCount} 连线
              </p>
              <h2 className="truncate text-base font-semibold text-text">{diagram.title || "AI 整理"}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface-page px-2.5 py-1.5 text-xs text-text-muted sm:inline-flex">
              <Maximize2 className="h-3.5 w-3.5" />
              白板只读
            </span>
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
          <DiagramCanvas diagram={diagram} />
        </div>
      </div>
    </div>
  );
}
