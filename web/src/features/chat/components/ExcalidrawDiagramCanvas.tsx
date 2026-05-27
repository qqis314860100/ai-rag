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
  return fitNodeLayout(node, {
    x: typeof layout?.x === "number" ? layout.x : 80 + (index % 4) * 210,
    y: typeof layout?.y === "number" ? layout.y : 80 + Math.floor(index / 4) * 120,
    width: typeof layout?.width === "number" ? layout.width : 170,
    height: typeof layout?.height === "number" ? layout.height : 64,
  });
}

function fitNodeLayout(node: DiagramNode, layout: NodeLayout): NodeLayout {
  const render = getNodeRender(node);
  return fitLayoutToLabel({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
  }, compactLabel(node, render), render);
}

function nodeCenter(layout: NodeLayout) {
  return {
    x: layout.x + layout.width / 2,
    y: layout.y + layout.height / 2,
  };
}

function edgeAnchor(layout: NodeLayout, toward: { x: number; y: number }, gap = 14) {
  const center = nodeCenter(layout);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;

  const halfWidth = layout.width / 2;
  const halfHeight = layout.height / 2;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy),
  );
  const edgeX = center.x + dx * scale;
  const edgeY = center.y + dy * scale;
  const length = Math.max(Math.hypot(dx, dy), 1);
  return {
    x: edgeX + (dx / length) * gap,
    y: edgeY + (dy / length) * gap,
  };
}

function sideAnchor(layout: NodeLayout, side: "left" | "right", gap = 14) {
  const center = nodeCenter(layout);
  const direction = side === "right" ? 1 : -1;
  return {
    x: center.x + direction * (layout.width / 2 + gap),
    y: center.y,
  };
}

function connectorPoints(source: NodeLayout, target: NodeLayout) {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const start = edgeAnchor(source, targetCenter);
  const end = edgeAnchor(target, sourceCenter);
  return {
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    points: [[0, 0], [end.x - start.x, end.y - start.y]],
  };
}

function mindmapConnectorPoints(source: NodeLayout, target: NodeLayout) {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const targetOnRight = targetCenter.x >= sourceCenter.x;
  const start = sideAnchor(source, targetOnRight ? "right" : "left", 12);
  const end = sideAnchor(target, targetOnRight ? "left" : "right", 12);
  const width = end.x - start.x;
  const height = end.y - start.y;

  // 思维导图只表达父子归属，使用独立侧边连线，避免形成总线或流程感。
  return {
    x: start.x,
    y: start.y,
    width,
    height,
    points: [[0, 0], [width, height]],
  };
}

function getRenderableGraph(diagram: DiagramIR) {
  const nodes = diagram.nodes;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = diagram.edges.filter((edge) => {
    return nodeIds.has(edge.source) && nodeIds.has(edge.target);
  });
  if (diagram.type === "mindmap") {
    return { nodes, edges: normalizeMindmapEdges(nodes, edges) };
  }
  return { nodes, edges };
}

function uniqueEdges(edges: DiagramEdge[]) {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.source}->${edge.target}:${edge.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return edge.source !== edge.target;
  });
}

function normalizeMindmapEdges(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const root = nodes.find((node) => node.kind === "root") ?? nodes[0];
  if (!root) return edges;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childrenBySource = new Map<string, DiagramEdge[]>();
  edges.forEach((edge) => {
    const list = childrenBySource.get(edge.source) ?? [];
    list.push(edge);
    childrenBySource.set(edge.source, list);
  });

  const categories = nodes.filter((node) => node.kind === "category");
  const rebuilt: DiagramEdge[] = [];
  const connected = new Set([root.id]);

  if (categories.length > 0) {
    categories.forEach((category) => {
      rebuilt.push({ source: root.id, target: category.id, relation: "contains", metadata: {} });
      connected.add(category.id);

      (childrenBySource.get(category.id) ?? []).forEach((edge) => {
        const target = nodeById.get(edge.target);
        if (!target || target.kind === "root" || target.kind === "category") return;
        rebuilt.push({ ...edge, source: category.id, target: target.id, relation: target.kind === "evidence" ? "supported_by" : "contains" });
        connected.add(target.id);
      });
    });

    nodes.forEach((node) => {
      if (!connected.has(node.id) && node.kind !== "evidence") {
        rebuilt.push({ source: root.id, target: node.id, relation: "contains", metadata: {} });
        connected.add(node.id);
      }
    });
  } else {
    nodes.forEach((node) => {
      if (node.id !== root.id && node.kind !== "evidence") {
        rebuilt.push({ source: root.id, target: node.id, relation: "contains", metadata: {} });
        connected.add(node.id);
      }
    });
  }

  edges.forEach((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || target.kind !== "evidence") return;
    rebuilt.push({ ...edge, relation: "supported_by" });
  });

  return uniqueEdges(rebuilt);
}

function childrenBySource(edges: DiagramEdge[]) {
  const children = new Map<string, string[]>();
  edges.forEach((edge) => {
    const list = children.get(edge.source) ?? [];
    list.push(edge.target);
    children.set(edge.source, list);
  });
  return children;
}

function distributeBranches(nodes: DiagramNode[], root: DiagramNode, edges: DiagramEdge[]) {
  const children = childrenBySource(edges);
  const directChildren = (children.get(root.id) ?? [])
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is DiagramNode => node !== undefined);
  const branches = directChildren.length > 0 ? directChildren : nodes.filter((node) => node.id !== root.id && node.kind !== "evidence");
  const left: DiagramNode[] = [];
  const right: DiagramNode[] = [];
  branches.forEach((node, index) => {
    const layout = node.metadata?.layout as Partial<NodeLayout> | undefined;
    if (typeof layout?.x === "number") {
      const rootLayout = root.metadata?.layout as Partial<NodeLayout> | undefined;
      const rootX = typeof rootLayout?.x === "number" ? rootLayout.x : 490;
      (layout.x < rootX ? left : right).push(node);
      return;
    }
    (index % 2 === 0 ? left : right).push(node);
  });
  return { left, right, children };
}

function branchSlot(index: number, total: number, centerY: number, gap: number) {
  return centerY + (index - (total - 1) / 2) * gap;
}

function createMindmapLayouts(nodes: DiagramNode[], edges: DiagramEdge[], viewport: { width: number; height: number }) {
  const layouts = new Map<string, NodeLayout>();
  const root = nodes.find((node) => node.kind === "root") ?? nodes[0];
  if (!root) return layouts;

  const centerX = viewport.width / 2;
  const centerY = Math.max(330, viewport.height / 2);
  layouts.set(root.id, fitNodeLayout(root, { x: centerX - 128, y: centerY - 36, width: 256, height: 72 }));

  const { left, right, children } = distributeBranches(nodes, root, edges);
  const placeBranch = (branch: DiagramNode[], side: -1 | 1) => {
    const gap = branch.length > 3 ? 118 : 138;
    branch.forEach((node, index) => {
      const y = branchSlot(index, branch.length, centerY, gap);
      const distance = 330 + Math.min(150, Math.abs(y - centerY) * 0.22);
      const x = centerX + side * distance;
      layouts.set(node.id, fitNodeLayout(node, { x: x - 118, y: y - 32, width: 236, height: 64 }));

      const childNodes = (children.get(node.id) ?? [])
        .map((id) => nodes.find((child) => child.id === id))
        .filter((child): child is DiagramNode => child !== undefined && child.kind !== "evidence");
      childNodes.forEach((child, childIndex) => {
        const childY = y + (childIndex - (childNodes.length - 1) / 2) * 76;
        const childX = x + side * 270;
        layouts.set(child.id, fitNodeLayout(child, { x: childX - 102, y: childY - 28, width: 204, height: 56 }));
      });
    });
  };

  placeBranch(left, -1);
  placeBranch(right, 1);

  nodes.forEach((node, index) => {
    if (!layouts.has(node.id)) {
      layouts.set(node.id, getNodeLayout(node, index));
    }
  });
  return layouts;
}

function createLayouts(nodes: DiagramNode[], edges: DiagramEdge[], diagram: DiagramIR) {
  if (diagram.type === "mindmap") {
    return createMindmapLayouts(nodes, edges, getViewport(diagram));
  }
  return new Map(nodes.map((node, index) => [node.id, getNodeLayout(node, index)]));
}

function createFallbackScene(diagram: DiagramIR): ExcalidrawInitialDataState {
  const graph = getRenderableGraph(diagram);
  const layouts = createLayouts(graph.nodes, graph.edges, diagram);
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
    const line = diagram.type === "mindmap" ? mindmapConnectorPoints(source, target) : connectorPoints(source, target);
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
  const renderer = diagram.metadata?.renderer;
  const legacyRenderer = diagram.metadata?.legacy_renderer;
  if (diagram.type === "mindmap" || (renderer === "excalidraw" && legacyRenderer === "positioned-svg")) {
    return createFallbackScene(diagram);
  }
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
