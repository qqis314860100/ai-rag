import { lazy, Suspense } from "react";
import { Maximize2, Network } from "lucide-react";
import { ModalShell } from "../../../components/ui";
import type { DiagramIR } from "../types";

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

  return (
    <ModalShell
      title={diagram.title || "AI 整理"}
      eyebrow={`${diagramLabel(diagram)} · ${nodeCount} 节点 · ${edgeCount} 连线`}
      icon={<Network className="h-5 w-5" />}
      actions={(
        <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface-page px-2.5 py-1.5 text-xs text-text-muted sm:inline-flex">
          <Maximize2 className="h-3.5 w-3.5" />
          白板只读
        </span>
      )}
      onClose={onClose}
    >
        <div className="min-h-0 flex-1 overflow-auto bg-surface-page p-5">
          <DiagramCanvas diagram={diagram} />
        </div>
    </ModalShell>
  );
}
