import { lazy, Suspense } from "react";
import type { DiagramIR } from "../types";

const ExcalidrawDiagramCanvasImpl = lazy(() => import("./ExcalidrawDiagramCanvasImpl"));

export default function ExcalidrawDiagramCanvas({ diagram }: { diagram: DiagramIR }) {
  return (
    <Suspense
      fallback={
        <div
          className="flex h-[620px] min-w-[860px] items-center justify-center rounded-xl border border-border bg-surface-page text-sm text-text-muted"
          role="status"
        >
          正在加载图解画布...
        </div>
      }
    >
      <ExcalidrawDiagramCanvasImpl diagram={diagram} />
    </Suspense>
  );
}
