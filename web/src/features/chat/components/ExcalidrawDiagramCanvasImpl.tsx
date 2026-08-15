import { useMemo } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { DiagramIR } from "../types";
import { diagramLabel, getDiagramLanes, getViewport, toExcalidrawInitialData } from "./ExcalidrawDiagramScene";

export default function ExcalidrawDiagramCanvas({ diagram }: { diagram: DiagramIR }) {
  const initialData = useMemo(() => toExcalidrawInitialData(diagram), [diagram]);
  const viewport = getViewport(diagram);
  const laneCount = getDiagramLanes(diagram).length;
  const sceneKey = `${diagram.title}-${diagram.nodes.length}-${diagram.edges.length}-${laneCount}-controlled`;

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-white shadow-sm-soft"
      style={{ minWidth: Math.max(viewport.width, 860), height: Math.max(viewport.height, 620) }}
      role="img"
      aria-label={`${diagram.title} ${diagramLabel(diagram)}`}
    >
      <Excalidraw
        key={sceneKey}
        initialData={initialData}
        viewModeEnabled
        zenModeEnabled
        gridModeEnabled={false}
        detectScroll={false}
        handleKeyboardGlobally={false}
        autoFocus={false}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveAsImage: false,
            saveToActiveFile: false,
            toggleTheme: false,
          },
          tools: {
            image: false,
          },
        }}
      />
    </div>
  );
}
