import { useMemo } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import type { DiagramEdge, DiagramIR, DiagramLane, DiagramNode } from "../types";

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

type FlowEdgeKind = "sequence" | "condition" | "fallback" | "loop" | "other";

type FlowPath = {
  mainIds: string[];
  branchIds: Set<string>;
};

type RouteLine = {
  x: number;
  y: number;
  width: number;
  height: number;
  points: number[][];
  labelX: number;
  labelY: number;
};

const FLOW_NODE_KINDS = new Set(["start", "end", "input", "output", "step", "action", "decision", "subflow"]);
const MAIN_EDGE_RELATIONS = new Set(["sequence", "flows_to", "condition"]);
const FLOW_LEVEL_GAP = 148;
const FLOW_BRANCH_GAP = 360;
const FLOW_BRANCH_ROW_GAP = 104;
const SWIMLANE_WIDTH = 360;
const SWIMLANE_LEFT = 48;
const SWIMLANE_TOP = 24;
const SWIMLANE_HEADER_HEIGHT = 44;

function getViewport(diagram: DiagramIR) {
  const viewport = diagram.metadata?.viewport as Partial<{ width: number; height: number }> | undefined;
  const laneCount = getDiagramLanes(diagram).length;
  return {
    width: Math.max(
      typeof viewport?.width === "number" ? viewport.width : 980,
      laneCount >= 2 ? laneCount * SWIMLANE_WIDTH + SWIMLANE_LEFT * 2 : 0,
    ),
    height: typeof viewport?.height === "number" ? viewport.height : 620,
  };
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function normalizeLane(value: unknown, index: number): DiagramLane | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string") return null;
  return {
    id: value.id,
    label: value.label,
    order: typeof value.order === "number" ? value.order : index,
    metadata: isRecord(value.metadata) ? value.metadata : {},
  };
}

function getDiagramLanes(diagram: DiagramIR): DiagramLane[] {
  const rawLanes = Array.isArray(diagram.lanes)
    ? diagram.lanes
    : Array.isArray(diagram.metadata?.lanes)
      ? diagram.metadata.lanes
      : [];
  return rawLanes
    .map(normalizeLane)
    .filter((lane): lane is DiagramLane => Boolean(lane))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
    labelX: (start.x + end.x) / 2,
    labelY: (start.y + end.y) / 2,
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
    labelX: start.x + width / 2,
    labelY: start.y + height / 2,
  };
}

function flowEdgeKind(edge: DiagramEdge): FlowEdgeKind {
  if (edge.relation === "loop") return "loop";
  if (edge.relation === "fallback") return "fallback";
  if (edge.relation === "condition") return "condition";
  if (edge.relation === "sequence" || edge.relation === "flows_to") return "sequence";
  return "other";
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isFallbackBranch(edge: DiagramEdge) {
  const branch = metadataString(edge.metadata, "branch");
  return (
    edge.relation === "fallback"
    || branch === "fallback"
    || branch === "fail"
    || branch === "no"
    || branch === "error"
  );
}

function isPositiveBranch(edge: DiagramEdge) {
  const branch = metadataString(edge.metadata, "branch");
  return branch === "yes" || branch === "pass" || branch === "ok" || branch === "success";
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

function getOutgoing(edges: DiagramEdge[]) {
  const outgoing = new Map<string, DiagramEdge[]>();
  edges.forEach((edge) => {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  });
  return outgoing;
}

function getIncoming(edges: DiagramEdge[]) {
  const incoming = new Map<string, DiagramEdge[]>();
  edges.forEach((edge) => {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge);
    incoming.set(edge.target, list);
  });
  return incoming;
}

function findFlowStart(nodes: DiagramNode[], edges: DiagramEdge[]) {
  const incoming = getIncoming(edges.filter((edge) => flowEdgeKind(edge) !== "loop" && flowEdgeKind(edge) !== "fallback"));
  return (
    nodes.find((node) => node.kind === "start")
    ?? nodes.find((node) => !incoming.has(node.id))
    ?? nodes[0]
  );
}

function chooseMainEdge(edges: DiagramEdge[], indexById: Map<string, number>, visited: Set<string>) {
  const candidates = edges
    .filter((edge) => {
      if (!MAIN_EDGE_RELATIONS.has(edge.relation) || visited.has(edge.target)) return false;
      return flowEdgeKind(edge) !== "loop" && !isFallbackBranch(edge);
    })
    .sort((a, b) => {
      const aScore = (isPositiveBranch(a) ? -5 : 0) + (a.relation === "condition" ? 2 : 0);
      const bScore = (isPositiveBranch(b) ? -5 : 0) + (b.relation === "condition" ? 2 : 0);
      if (aScore !== bScore) return aScore - bScore;
      return (indexById.get(a.target) ?? 0) - (indexById.get(b.target) ?? 0);
    });
  return candidates[0];
}

function collectBranchIds(nodes: DiagramNode[], edges: DiagramEdge[], mainIds: string[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const mainSet = new Set(mainIds);
  const outgoing = getOutgoing(edges);
  const branchIds = new Set<string>();
  const queue: string[] = [];

  const enqueueBranch = (id: string) => {
    if (!nodeIds.has(id) || mainSet.has(id) || branchIds.has(id)) return;
    branchIds.add(id);
    queue.push(id);
  };

  edges.forEach((edge) => {
    if (mainSet.has(edge.source) && !mainSet.has(edge.target)) {
      enqueueBranch(edge.target);
    }
    if (flowEdgeKind(edge) === "loop") {
      enqueueBranch(edge.source);
    }
  });

  while (queue.length > 0) {
    const sourceId = queue.shift();
    if (!sourceId) continue;
    (outgoing.get(sourceId) ?? []).forEach((edge) => {
      enqueueBranch(edge.target);
    });
  }

  nodes.forEach((node) => {
    if (node.kind !== "evidence" && !mainSet.has(node.id)) {
      enqueueBranch(node.id);
    }
  });

  return branchIds;
}

function analyzeFlowPath(nodes: DiagramNode[], edges: DiagramEdge[]): FlowPath {
  const start = findFlowStart(nodes, edges);
  if (!start) return { mainIds: [], branchIds: new Set() };

  const outgoing = getOutgoing(edges);
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const mainIds: string[] = [];
  const visited = new Set<string>();
  let current: DiagramNode | undefined = start;

  while (current && !visited.has(current.id)) {
    mainIds.push(current.id);
    visited.add(current.id);
    const edge = chooseMainEdge(outgoing.get(current.id) ?? [], indexById, visited);
    current = edge ? nodes.find((node) => node.id === edge.target) : undefined;
  }

  return { mainIds, branchIds: collectBranchIds(nodes, edges, mainIds) };
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

function createFlowchartLayouts(nodes: DiagramNode[], edges: DiagramEdge[], viewport: { width: number; height: number }) {
  const layouts = new Map<string, NodeLayout>();
  const flowNodes = nodes.filter((node) => FLOW_NODE_KINDS.has(node.kind) || node.kind !== "evidence");
  const nodeById = new Map(flowNodes.map((node) => [node.id, node]));
  const path = analyzeFlowPath(flowNodes, edges);
  const centerX = Math.max(520, viewport.width / 2);
  const top = 56;
  const mainIds = path.mainIds.length > 0 ? path.mainIds : flowNodes.map((node) => node.id);

  mainIds.forEach((id, index) => {
    const node = nodeById.get(id);
    if (!node || path.branchIds.has(id)) return;
    const width = node.kind === "decision" ? 320 : node.kind === "start" || node.kind === "end" ? 300 : 420;
    const height = node.kind === "decision" ? 116 : node.kind === "start" || node.kind === "end" ? 68 : 76;
    layouts.set(node.id, fitNodeLayout(node, {
      x: centerX - width / 2,
      y: top + index * FLOW_LEVEL_GAP,
      width,
      height,
    }));
  });

  const mainIndex = new Map(mainIds.map((id, index) => [id, index]));
  const branchColumns = new Map<string, { left: number; right: number }>();
  const nextBranchOffset = (sourceId: string, side: "left" | "right") => {
    const column = branchColumns.get(sourceId) ?? { left: 0, right: 0 };
    const value = column[side];
    column[side] += 1;
    branchColumns.set(sourceId, column);
    return value;
  };

  const placeBranchTarget = (edge: DiagramEdge) => {
    const target = nodeById.get(edge.target);
    if (!target || layouts.has(edge.target) || !path.branchIds.has(edge.target)) return false;
    const sourceLayout = layouts.get(edge.source);
    if (!sourceLayout) return false;
    const fallback = isFallbackBranch(edge);
    const side: "left" | "right" = fallback ? "right" : "left";
    const offset = nextBranchOffset(edge.source, side);
    const width = target.kind === "decision" ? 300 : target.kind === "subflow" ? 380 : 340;
    const height = target.kind === "decision" ? 108 : 72;
    // 分支位置只消费 DiagramIR 的结构语义：relation / metadata.branch，不在前端抽取业务含义。
    const branchBaseX = mainIndex.has(edge.source)
      ? centerX + (side === "right" ? FLOW_BRANCH_GAP : -FLOW_BRANCH_GAP)
      : sourceLayout.x + sourceLayout.width / 2;
    const y = sourceLayout.y + 92 + offset * FLOW_BRANCH_ROW_GAP;
    const x = branchBaseX - width / 2;
    layouts.set(target.id, fitNodeLayout(target, { x, y, width, height }));
    return true;
  };

  let placed = true;
  while (placed) {
    placed = false;
    edges.forEach((edge) => {
      if (placeBranchTarget(edge)) placed = true;
    });
  }

  flowNodes.forEach((node, index) => {
    if (layouts.has(node.id) || !path.branchIds.has(node.id)) return;
    const width = node.kind === "decision" ? 300 : 340;
    const side: "left" | "right" = index % 2 === 0 ? "left" : "right";
    const y = top + Math.max(1, mainIds.length - 1) * FLOW_LEVEL_GAP + index * FLOW_BRANCH_ROW_GAP;
    const x = centerX + (side === "right" ? FLOW_BRANCH_GAP : -FLOW_BRANCH_GAP) - width / 2;
    layouts.set(node.id, fitNodeLayout(node, { x, y, width, height: node.kind === "decision" ? 108 : 72 }));
  });

  flowNodes.forEach((node, index) => {
    if (layouts.has(node.id)) return;
    const width = node.kind === "decision" ? 300 : 360;
    const y = top + (mainIds.length + index) * 116;
    layouts.set(node.id, fitNodeLayout(node, { x: centerX - width / 2, y, width, height: node.kind === "decision" ? 108 : 72 }));
  });

  return layouts;
}

function nodeLaneId(node: DiagramNode) {
  const laneId = node.metadata?.lane_id;
  return typeof laneId === "string" && laneId.length > 0 ? laneId : null;
}

function createSwimlaneLayouts(nodes: DiagramNode[], edges: DiagramEdge[], diagram: DiagramIR, viewport: { width: number; height: number }) {
  const lanes = getDiagramLanes(diagram);
  const layouts = new Map<string, NodeLayout>();
  const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
  const flowNodes = nodes.filter((node) => FLOW_NODE_KINDS.has(node.kind) || node.kind !== "evidence");
  const path = analyzeFlowPath(flowNodes, edges);
  const orderedIds = [
    ...path.mainIds,
    ...flowNodes.map((node) => node.id).filter((id) => !path.mainIds.includes(id)),
  ];
  const orderedNodes = orderedIds
    .map((id) => flowNodes.find((node) => node.id === id))
    .filter((node): node is DiagramNode => Boolean(node));
  const laneBlockWidth = Math.max(SWIMLANE_WIDTH, Math.floor((viewport.width - SWIMLANE_LEFT * 2) / Math.max(lanes.length, 1)));
  const top = SWIMLANE_TOP + SWIMLANE_HEADER_HEIGHT + 36;

  orderedNodes.forEach((node, index) => {
    const laneId = nodeLaneId(node);
    const resolvedLaneIndex = laneId && laneIndex.has(laneId) ? laneIndex.get(laneId)! : 0;
    const laneCenterX = SWIMLANE_LEFT + resolvedLaneIndex * laneBlockWidth + laneBlockWidth / 2;
    const width = node.kind === "decision" ? 280 : node.kind === "start" || node.kind === "end" ? 260 : 300;
    const height = node.kind === "decision" ? 108 : node.kind === "start" || node.kind === "end" ? 68 : 76;
    layouts.set(node.id, fitNodeLayout(node, {
      x: laneCenterX - width / 2,
      y: top + index * FLOW_LEVEL_GAP,
      width,
      height,
    }));
  });

  flowNodes.forEach((node, index) => {
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
  if (diagram.type === "flowchart") {
    const viewport = getViewport(diagram);
    if (getDiagramLanes(diagram).length >= 2) {
      return createSwimlaneLayouts(nodes, edges, diagram, viewport);
    }
    return createFlowchartLayouts(nodes, edges, viewport);
  }
  return new Map(nodes.map((node, index) => [node.id, getNodeLayout(node, index)]));
}

function routePoints(points: Array<{ x: number; y: number }>): RouteLine {
  const start = points[0];
  const end = points[points.length - 1];
  const middle = points[Math.max(1, Math.floor(points.length / 2))] ?? start;
  return {
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
    points: points.map((point) => [point.x - start.x, point.y - start.y]),
    labelX: middle.x,
    labelY: middle.y,
  };
}

function topAnchor(layout: NodeLayout, gap = 14) {
  const center = nodeCenter(layout);
  return { x: center.x, y: layout.y - gap };
}

function bottomAnchor(layout: NodeLayout, gap = 14) {
  const center = nodeCenter(layout);
  return { x: center.x, y: layout.y + layout.height + gap };
}

function flowchartConnectorPoints(source: NodeLayout, target: NodeLayout, edge: DiagramEdge): RouteLine {
  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const kind = flowEdgeKind(edge);

  if (kind === "loop") {
    const targetAbove = targetCenter.y < sourceCenter.y;
    const side: "left" | "right" = sourceCenter.x >= targetCenter.x ? "right" : "left";
    const sourceAnchor = sideAnchor(source, side, 18);
    const targetAnchor = targetAbove ? sideAnchor(target, side, 18) : topAnchor(target, 18);
    const bendX = side === "right" ? Math.max(sourceAnchor.x, targetAnchor.x) + 80 : Math.min(sourceAnchor.x, targetAnchor.x) - 80;
    return routePoints([
      sourceAnchor,
      { x: bendX, y: sourceAnchor.y },
      { x: bendX, y: targetAnchor.y },
      targetAnchor,
    ]);
  }

  const mostlyVertical = Math.abs(sourceCenter.x - targetCenter.x) < 80;
  if (mostlyVertical && targetCenter.y >= sourceCenter.y) {
    const start = bottomAnchor(source);
    const end = topAnchor(target);
    return routePoints([start, end]);
  }

  const side: "left" | "right" = targetCenter.x >= sourceCenter.x ? "right" : "left";
  const start = sideAnchor(source, side, 16);
  const end = targetCenter.y >= sourceCenter.y ? topAnchor(target, 16) : sideAnchor(target, side === "right" ? "left" : "right", 16);
  const midY = start.y + Math.max(42, (end.y - start.y) * 0.48);
  return routePoints([
    start,
    { x: start.x, y: midY },
    { x: end.x, y: midY },
    end,
  ]);
}

function createSwimlaneSkeletons(diagram: DiagramIR, nodeCount: number): ExcalidrawElementSkeleton[] {
  if (diagram.type !== "flowchart") return [];
  const lanes = getDiagramLanes(diagram);
  if (lanes.length < 2) return [];

  const viewport = getViewport(diagram);
  const laneBlockWidth = Math.max(SWIMLANE_WIDTH, Math.floor((viewport.width - SWIMLANE_LEFT * 2) / lanes.length));
  const laneHeight = Math.max(viewport.height - SWIMLANE_TOP * 2, nodeCount * FLOW_LEVEL_GAP + SWIMLANE_HEADER_HEIGHT + 132);
  const palette = ["#F8FAFC", "#F7FEE7", "#EFF6FF", "#FFF7ED", "#FDF2F8", "#F0FDFA"];

  return lanes.flatMap((lane, index) => {
    const x = SWIMLANE_LEFT + index * laneBlockWidth;
    const fill = palette[index % palette.length];
    const label = lane.label.length > 18 ? `${lane.label.slice(0, 16)}...` : lane.label;
    return [
      {
        type: "rectangle",
        id: `lane-${lane.id}`,
        x,
        y: SWIMLANE_TOP,
        width: laneBlockWidth,
        height: laneHeight,
        backgroundColor: fill,
        strokeColor: "#CBD5E1",
        strokeWidth: 1,
        roughness: 0,
        roundness: { type: 3, value: 8 },
        customData: {
          diagram_lane_id: lane.id,
          label: lane.label,
        },
      },
      {
        type: "text",
        id: `lane-label-${lane.id}`,
        x: x + 16,
        y: SWIMLANE_TOP + 12,
        width: laneBlockWidth - 32,
        height: 24,
        text: label,
        fontSize: 14,
        strokeColor: "#334155",
        backgroundColor: "transparent",
        roughness: 0,
        customData: {
          diagram_lane_id: lane.id,
          full_label: lane.label,
        },
      },
    ] as ExcalidrawElementSkeleton[];
  });
}

function createFallbackScene(diagram: DiagramIR): ExcalidrawInitialDataState {
  const graph = getRenderableGraph(diagram);
  const layouts = createLayouts(graph.nodes, graph.edges, diagram);
  const laneSkeleton = createSwimlaneSkeletons(diagram, graph.nodes.length);
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
    const line = diagram.type === "mindmap"
      ? mindmapConnectorPoints(source, target)
      : diagram.type === "flowchart"
        ? flowchartConnectorPoints(source, target, edge)
        : connectorPoints(source, target);
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

    if (diagram.type === "flowchart" && edge.label) {
      edgeSkeleton.push({
        type: "text",
        id: `edge-label-${edge.source}-${edge.target}-${index}`,
        x: line.labelX - 34,
        y: line.labelY - 24,
        width: 68,
        height: 24,
        text: edge.label,
        fontSize: 12,
        strokeColor: render.stroke,
        backgroundColor: "#FFFFFF",
        roughness: 0,
        customData: {
          diagram_edge_label: {
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
          },
        },
      } as ExcalidrawElementSkeleton);
    }
  });

  return {
    elements: convertToExcalidrawElements([...laneSkeleton, ...edgeSkeleton, ...nodeSkeleton], { regenerateIds: false }),
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
  if (diagram.type === "mindmap" || diagram.type === "flowchart" || (renderer === "excalidraw" && legacyRenderer === "positioned-svg")) {
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
