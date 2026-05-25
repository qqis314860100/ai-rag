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

function fixedLayout(node: DiagramNode, layout: NodeLayout): NodeLayout {
  const render = getNodeRender(node);
  return fitLayoutToLabel(layout, compactLabel(node, render), render);
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

function mindmapConnectorPoints(source: NodeLayout, target: NodeLayout) {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const startX = source.x + source.width + 8;
  const endX = target.x - 8;
  const width = endX - startX;
  const height = targetCenter.y - sourceCenter.y;
  const elbowX = width / 2;

  return {
    x: startX,
    y: sourceCenter.y,
    width,
    height,
    points: [[0, 0], [elbowX, 0], [elbowX, height], [width, height]],
  };
}

function getVisibleMindmapNodeIds(diagram: DiagramIR) {
  const visible = new Set<string>();
  const root = diagram.nodes.find((node) => node.kind === "root");
  if (root) visible.add(root.id);

  const categoryIds = diagram.edges
    .filter((edge) => edge.source === root?.id)
    .map((edge) => edge.target)
    .filter((nodeId) => diagram.nodes.some((node) => node.id === nodeId && node.kind === "category"))
    .slice(0, 5);

  categoryIds.forEach((categoryId) => {
    visible.add(categoryId);
    diagram.edges
      .filter((edge) => edge.source === categoryId)
      .map((edge) => edge.target)
      .filter((nodeId) => diagram.nodes.some((node) => node.id === nodeId && node.kind !== "evidence"))
      .slice(0, 4)
      .forEach((nodeId) => visible.add(nodeId));
  });

  if (visible.size === 0) {
    diagram.nodes
      .filter((node) => node.kind !== "evidence")
      .slice(0, 18)
      .forEach((node) => visible.add(node.id));
  }
  return visible;
}

function getRenderableGraph(diagram: DiagramIR) {
  const visibleIds = diagram.diagram_type === "mindmap"
    ? getVisibleMindmapNodeIds(diagram)
    : new Set(diagram.nodes.filter((node) => node.kind !== "evidence").map((node) => node.id));
  const nodes = diagram.nodes.filter((node) => visibleIds.has(node.id));
  const edges = diagram.edges.filter((edge) => {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return false;
    if (diagram.diagram_type !== "mindmap") return true;
    return !diagram.nodes.some((node) => node.id === edge.target && node.kind === "evidence");
  });
  return { nodes, edges };
}

function createMindmapLayouts(diagram: DiagramIR, nodes: DiagramNode[]) {
  const layouts = new Map<string, NodeLayout>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = nodes.find((node) => node.kind === "root");
  if (!root) return layouts;

  const categoryIds = diagram.edges
    .filter((edge) => edge.source === root.id && byId.get(edge.target)?.kind === "category")
    .map((edge) => edge.target)
    .filter((id) => byId.has(id));

  const categories = categoryIds.map((id) => byId.get(id)!).slice(0, 5);
  const keywordIdsByCategory = new Map<string, string[]>();
  categories.forEach((category) => {
    keywordIdsByCategory.set(
      category.id,
      diagram.edges
        .filter((edge) => edge.source === category.id && byId.get(edge.target)?.kind !== "evidence")
        .map((edge) => edge.target)
        .filter((id) => byId.has(id))
        .slice(0, 4)
    );
  });

  const blocks = categories.map((category) => {
    const keywords = keywordIdsByCategory.get(category.id) || [];
    return {
      category,
      keywords,
      height: Math.max(118, Math.max(1, keywords.length) * 74),
    };
  });
  const totalHeight = blocks.reduce((sum, block) => sum + block.height + 36, 0);
  const canvasHeight = Math.max(680, totalHeight + 96);
  const rootX = 80;
  const rootY = canvasHeight / 2 - 46;
  layouts.set(root.id, fixedLayout(root, { x: rootX, y: rootY, width: 300, height: 92 }));

  let cursorY = Math.max(56, (canvasHeight - totalHeight) / 2);
  blocks.forEach((block) => {
    const top = cursorY;
    cursorY += block.height + 36;

    // 中文注释：思维导图使用单向层级树，保证父节点到子节点的箭头不交叉、不穿卡片。
    const categoryX = 470;
    const keywordX = 820;
    const categoryY = top + block.height / 2 - 34;
    layouts.set(block.category.id, fixedLayout(block.category, { x: categoryX, y: categoryY, width: 210, height: 68 }));

    block.keywords.forEach((keywordId, index) => {
      const keyword = byId.get(keywordId);
      if (!keyword) return;
      layouts.set(keyword.id, fixedLayout(keyword, {
        x: keywordX,
        y: top + index * 74 + Math.max(0, block.height - block.keywords.length * 74) / 2,
        width: 280,
        height: 64,
      }));
    });
  });

  return layouts;
}

function createLayouts(diagram: DiagramIR, nodes: DiagramNode[]) {
  if (diagram.diagram_type === "mindmap") return createMindmapLayouts(diagram, nodes);
  return new Map(nodes.map((node, index) => [node.id, getNodeLayout(node, index)]));
}

function createFallbackScene(diagram: DiagramIR): ExcalidrawInitialDataState {
  const graph = getRenderableGraph(diagram);
  const layouts = createLayouts(diagram, graph.nodes);
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
    const isMindmap = diagram.diagram_type === "mindmap";
    const line = isMindmap ? mindmapConnectorPoints(source, target) : connectorPoints(source, target);
    edgeSkeleton.push({
      type: "arrow",
      id: `edge-${edge.source}-${edge.target}-${index}`,
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
      points: line.points,
      strokeColor: isMindmap ? "#94A3B8" : render.stroke,
      strokeWidth: isMindmap ? 1.5 : render.strokeWidth,
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

function toExcalidrawInitialData(diagram: DiagramIR): ExcalidrawInitialDataState {
  return createFallbackScene(diagram);
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
