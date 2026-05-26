import { useMemo } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { DiagramEdge, DiagramIR, DiagramNode } from "../types";

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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function textUnits(value: string) {
  let units = 0;
  for (const char of value) {
    units += /[\u4e00-\u9fff]/.test(char) ? 1.7 : 1;
  }
  return units;
}

function compactLabel(node: DiagramNode, render: NodeRender) {
  const metadataRender = node.metadata?.render as Partial<{ labelMaxLength: number }> | undefined;
  const maxLength = numberValue(metadataRender?.labelMaxLength, render.shape === "diamond" ? 16 : 24);
  const normalized = node.label.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(6, maxLength - 3))}...`;
}

function fitLayoutToLabel(layout: NodeLayout, label: string, render: NodeRender): NodeLayout {
  const baseWidth = render.shape === "diamond" ? 260 : 210;
  const maxWidth = render.shape === "diamond" ? 360 : 330;
  const baseHeight = render.shape === "diamond" ? 104 : 72;
  const units = textUnits(label);
  const dynamicWidth = clamp(Math.ceil(units * render.fontSize * 0.74) + 48, baseWidth, maxWidth);
  const lineCount = Math.max(1, Math.ceil(units / (render.shape === "diamond" ? 12 : 18)));
  const dynamicHeight = clamp(48 + lineCount * render.fontSize * 1.25, baseHeight, render.shape === "diamond" ? 138 : 112);
  return {
    ...layout,
    x: layout.x - Math.max(dynamicWidth - layout.width, 0) / 2,
    y: layout.y - Math.max(dynamicHeight - layout.height, 0) / 2,
    width: Math.max(layout.width, dynamicWidth),
    height: Math.max(layout.height, dynamicHeight),
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
  const render = getNodeRender(node);
  return fitLayoutToLabel({
    x: typeof layout?.x === "number" ? layout.x : 80 + (index % 4) * 210,
    y: typeof layout?.y === "number" ? layout.y : 80 + Math.floor(index / 4) * 120,
    width: typeof layout?.width === "number" ? layout.width : 170,
    height: typeof layout?.height === "number" ? layout.height : 64,
  }, compactLabel(node, render), render);
}

function nodeCenter(layout: NodeLayout) {
  return {
    x: layout.x + layout.width / 2,
    y: layout.y + layout.height / 2,
  };
}

function connectorPoints(source: NodeLayout, target: NodeLayout) {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;

  if (Math.abs(dy) >= Math.abs(dx)) {
    const sourceY = dy >= 0 ? source.y + source.height + 10 : source.y - 10;
    const targetY = dy >= 0 ? target.y - 10 : target.y + target.height + 10;
    return {
      x: sourceCenter.x,
      y: sourceY,
      width: targetCenter.x - sourceCenter.x,
      height: targetY - sourceY,
      points: [[0, 0], [targetCenter.x - sourceCenter.x, targetY - sourceY]],
    };
  }

  const sourceX = dx >= 0 ? source.x + source.width + 10 : source.x - 10;
  const targetX = dx >= 0 ? target.x - 10 : target.x + target.width + 10;
  return {
    x: sourceX,
    y: sourceCenter.y,
    width: targetX - sourceX,
    height: targetCenter.y - sourceCenter.y,
    points: [[0, 0], [targetX - sourceX, targetCenter.y - sourceCenter.y]],
  };
}

function getRenderableGraph(diagram: DiagramIR) {
  const nodes = diagram.nodes;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = diagram.edges.filter((edge) => {
    return nodeIds.has(edge.source) && nodeIds.has(edge.target);
  });
  return { nodes, edges };
}

function createLayouts(nodes: DiagramNode[]) {
  return new Map(nodes.map((node, index) => [node.id, getNodeLayout(node, index)]));
}

function createFallbackScene(diagram: DiagramIR): ExcalidrawInitialDataState {
  const graph = getRenderableGraph(diagram);
  const layouts = createLayouts(graph.nodes);
  const edgeSkeleton: ExcalidrawElementSkeleton[] = [];
  const nodeSkeleton: ExcalidrawElementSkeleton[] = [];

  graph.nodes.forEach((node) => {
    const layout = layouts.get(node.id);
    if (!layout) return;
    const render = getNodeRender(node);
    const label = compactLabel(node, render);
    nodeSkeleton.push({
      type: render.shape === "diamond" ? "diamond" : "rectangle",
      id: `node-${node.id}`,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      backgroundColor: render.fill,
      strokeColor: render.stroke,
      strokeWidth: 2,
      roughness: 0.35,
      roundness: render.shape === "diamond" ? null : { type: 3, value: render.radius },
      label: {
        text: label,
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
        full_label: node.label,
      },
    } as ExcalidrawElementSkeleton);
  });

  graph.edges.forEach((edge, index) => {
    const source = layouts.get(edge.source);
    const target = layouts.get(edge.target);
    if (!source || !target) return;
    const render = getEdgeRender(edge);
    const line = connectorPoints(source, target);
    edgeSkeleton.push({
      type: "arrow",
      id: `edge-${edge.source}-${edge.target}-${index}`,
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
      points: line.points,
      strokeColor: render.stroke,
      strokeWidth: render.strokeWidth,
      roughness: 0.35,
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
    elements: convertToExcalidrawElements([...edgeSkeleton, ...nodeSkeleton], { regenerateIds: false }),
    appState: {
      viewBackgroundColor: "#F8FAFC",
      theme: "light",
    },
    files: {},
    scrollToContent: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createProvidedScene(diagram: DiagramIR): ExcalidrawInitialDataState | null {
  const scene = diagram.excalidraw_scene;
  if (!isRecord(scene) || !Array.isArray(scene.elements) || scene.elements.length === 0) return null;

  return {
    elements: scene.elements as ExcalidrawInitialDataState["elements"],
    appState: {
      viewBackgroundColor: "#FFFFFF",
      theme: "light",
      ...(isRecord(scene.appState) ? scene.appState : {}),
    } as ExcalidrawInitialDataState["appState"],
    files: isRecord(scene.files) ? scene.files as ExcalidrawInitialDataState["files"] : {},
    scrollToContent: true,
  };
}

function toExcalidrawInitialData(diagram: DiagramIR): ExcalidrawInitialDataState {
  return createProvidedScene(diagram) || createFallbackScene(diagram);
}

function diagramLabel(diagram: DiagramIR) {
  if (diagram.type === "flowchart") return "流程图";
  if (diagram.type === "diagram") return "图解";
  if (diagram.type === "chart") return "图表";
  return "思维导图";
}

export default function ExcalidrawDiagramCanvas({ diagram }: { diagram: DiagramIR }) {
  const initialData = useMemo(() => toExcalidrawInitialData(diagram), [diagram]);
  const viewport = getViewport(diagram);
  const sceneKey = `${diagram.title}-${diagram.nodes.length}-${diagram.edges.length}-controlled`;

  return (
    <div
      className="min-w-[860px] overflow-hidden rounded-xl border border-border bg-white shadow-sm-soft"
      style={{ height: Math.max(viewport.height, 620) }}
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
