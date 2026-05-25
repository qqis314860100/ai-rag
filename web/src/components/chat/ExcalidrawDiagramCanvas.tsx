import { useMemo } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { DiagramEdge, DiagramIR, DiagramNode } from "../../types";

type NodeLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type NodeRender = {
  shape: "rounded" | "diamond";
  fill: string;
  stroke: string;
  text: string;
  radius: number;
  fontSize: number;
};

type EdgeRender = {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  arrow: boolean;
};

type ExcalidrawScenePayload = {
  elements?: unknown;
  appState?: unknown;
  files?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getViewport(diagram: DiagramIR) {
  const viewport = diagram.metadata?.viewport as Partial<{ width: number; height: number }> | undefined;
  return {
    width: typeof viewport?.width === "number" ? viewport.width : 980,
    height: typeof viewport?.height === "number" ? viewport.height : 620,
  };
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function getNodeRender(node: DiagramNode): NodeRender {
  const render = node.metadata?.render as Partial<NodeRender> | undefined;
  const shape = render?.shape === "diamond" ? "diamond" : "rounded";
  return {
    shape,
    fill: stringValue(render?.fill, "#FFFFFF"),
    stroke: stringValue(render?.stroke, "#CBD5E1"),
    text: stringValue(render?.text, "#334155"),
    radius: numberValue(render?.radius, 14),
    fontSize: numberValue(render?.fontSize, 13),
  };
}

function getEdgeRender(edge: DiagramEdge): EdgeRender {
  const render = edge.metadata?.render as Partial<EdgeRender> | undefined;
  return {
    stroke: stringValue(render?.stroke, "#64748B"),
    strokeWidth: numberValue(render?.strokeWidth, 2),
    strokeDasharray: typeof render?.strokeDasharray === "string" ? render.strokeDasharray : undefined,
    arrow: typeof render?.arrow === "boolean" ? render.arrow : true,
  };
}

function getNodeLayout(node: DiagramNode, index: number): NodeLayout {
  const layout = node.metadata?.layout as Partial<NodeLayout> | undefined;
  return {
    x: typeof layout?.x === "number" ? layout.x : 80 + (index % 4) * 210,
    y: typeof layout?.y === "number" ? layout.y : 80 + Math.floor(index / 4) * 120,
    width: typeof layout?.width === "number" ? layout.width : 170,
    height: typeof layout?.height === "number" ? layout.height : 64,
  };
}

function nodeCenter(layout: NodeLayout) {
  return {
    x: layout.x + layout.width / 2,
    y: layout.y + layout.height / 2,
  };
}

function findScenePayload(diagram: DiagramIR): ExcalidrawScenePayload | null {
  const directScene = diagram.excalidraw_scene;
  if (isRecord(directScene) && Array.isArray(directScene.elements)) return directScene;

  const metadataScene = diagram.metadata?.excalidraw_scene;
  if (isRecord(metadataScene) && Array.isArray(metadataScene.elements)) return metadataScene;

  return null;
}

function createFallbackScene(diagram: DiagramIR): ExcalidrawInitialDataState {
  const layouts = new Map(diagram.nodes.map((node, index) => [node.id, getNodeLayout(node, index)]));
  const skeleton: ExcalidrawElementSkeleton[] = [];

  diagram.nodes.forEach((node) => {
    const layout = layouts.get(node.id);
    if (!layout) return;
    const render = getNodeRender(node);
    skeleton.push({
      type: render.shape === "diamond" ? "diamond" : "rectangle",
      id: `node-${node.id}`,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      backgroundColor: render.fill,
      strokeColor: render.stroke,
      strokeWidth: 2,
      roughness: 1,
      roundness: render.shape === "diamond" ? null : { type: 3, value: render.radius },
      label: {
        text: node.label,
        fontSize: render.fontSize,
        textAlign: "center",
        verticalAlign: "middle",
        strokeColor: render.text,
      },
      customData: {
        diagram_node_id: node.id,
        kind: node.kind,
        source_ids: node.source_ids,
        description: node.description,
      },
    } as ExcalidrawElementSkeleton);
  });

  diagram.edges.forEach((edge, index) => {
    const source = layouts.get(edge.source);
    const target = layouts.get(edge.target);
    if (!source || !target) return;
    const start = nodeCenter(source);
    const end = nodeCenter(target);
    const render = getEdgeRender(edge);
    skeleton.push({
      type: "arrow",
      id: `edge-${edge.source}-${edge.target}-${index}`,
      x: start.x,
      y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
      points: [[0, 0], [end.x - start.x, end.y - start.y]],
      strokeColor: render.stroke,
      strokeWidth: render.strokeWidth,
      strokeStyle: render.strokeDasharray ? "dashed" : "solid",
      startArrowhead: null,
      endArrowhead: render.arrow ? "arrow" : null,
      customData: {
        diagram_edge: {
          source: edge.source,
          target: edge.target,
          relation: edge.relation,
          label: edge.label,
        },
      },
    } as ExcalidrawElementSkeleton);
  });

  return {
    elements: convertToExcalidrawElements(skeleton, { regenerateIds: false }),
    appState: {
      viewBackgroundColor: "#F8FAFC",
      theme: "light",
    },
    files: {},
    scrollToContent: true,
  };
}

function toExcalidrawInitialData(diagram: DiagramIR): ExcalidrawInitialDataState {
  const scene = findScenePayload(diagram);
  if (!scene) return createFallbackScene(diagram);

  return {
    elements: scene.elements as ExcalidrawInitialDataState["elements"],
    appState: {
      ...(isRecord(scene.appState) ? scene.appState : {}),
      viewBackgroundColor: "#F8FAFC",
      theme: "light",
    },
    files: isRecord(scene.files) ? scene.files as ExcalidrawInitialDataState["files"] : {},
    scrollToContent: true,
  };
}

export default function ExcalidrawDiagramCanvas({ diagram }: { diagram: DiagramIR }) {
  const initialData = useMemo(() => toExcalidrawInitialData(diagram), [diagram]);
  const viewport = getViewport(diagram);
  const sceneKey = `${diagram.title}-${diagram.nodes.length}-${diagram.edges.length}-${diagram.excalidraw_scene ? "scene" : "ir"}`;

  return (
    <div
      className="min-w-[860px] overflow-hidden rounded-xl border border-border bg-white shadow-sm-soft"
      style={{ height: Math.max(viewport.height, 620) }}
      role="img"
      aria-label={`${diagram.title} ${diagram.diagram_type === "flowchart" ? "流程图" : "思维导图"}`}
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
