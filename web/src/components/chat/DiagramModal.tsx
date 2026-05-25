import { useEffect, useId } from "react";
import { Maximize2, Network, X } from "lucide-react";
import type { DiagramEdge, DiagramIR, DiagramNode } from "../../types";

interface DiagramModalProps {
  diagram: DiagramIR;
  onClose: () => void;
}

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
  fontWeight: number;
  labelMaxLength: number;
  maxLines: number;
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
    fontSize: numberValue(render?.fontSize, 12),
    fontWeight: numberValue(render?.fontWeight, 600),
    labelMaxLength: numberValue(render?.labelMaxLength, 18),
    maxLines: numberValue(render?.maxLines, 2),
  };
}

function getEdgeRender(edge: DiagramEdge): EdgeRender {
  const render = edge.metadata?.render as Partial<EdgeRender> | undefined;
  return {
    stroke: stringValue(render?.stroke, "#94A3B8"),
    strokeWidth: numberValue(render?.strokeWidth, 1.6),
    strokeDasharray: typeof render?.strokeDasharray === "string" ? render.strokeDasharray : undefined,
    arrow: typeof render?.arrow === "boolean" ? render.arrow : true,
  };
}

function getNodeLayout(node: DiagramNode, index: number): NodeLayout {
  const layout = node.metadata?.layout as Partial<NodeLayout> | undefined;
  return {
    x: typeof layout?.x === "number" ? layout.x : 80 + (index % 4) * 210,
    y: typeof layout?.y === "number" ? layout.y : 80 + Math.floor(index / 4) * 110,
    width: typeof layout?.width === "number" ? layout.width : 160,
    height: typeof layout?.height === "number" ? layout.height : 56,
  };
}

function compactSvgText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1))}...`;
}

function wrapSvgText(text: string, maxLength: number, maxLines: number) {
  const compacted = compactSvgText(text, maxLength * maxLines);
  const lines: string[] = [];
  for (let index = 0; index < compacted.length && lines.length < maxLines; index += maxLength) {
    lines.push(compacted.slice(index, index + maxLength));
  }
  return lines.length ? lines : [""];
}

function nodeCenter(layout: NodeLayout) {
  return {
    x: layout.x + layout.width / 2,
    y: layout.y + layout.height / 2,
  };
}

function edgePath(source: NodeLayout, target: NodeLayout) {
  const start = nodeCenter(source);
  const end = nodeCenter(target);
  const vertical = Math.abs(end.y - start.y) > Math.abs(end.x - start.x);
  if (vertical) {
    return `M ${start.x} ${source.y + source.height} C ${start.x} ${(start.y + end.y) / 2}, ${end.x} ${(start.y + end.y) / 2}, ${end.x} ${target.y}`;
  }
  const direction = end.x >= start.x ? 1 : -1;
  return `M ${source.x + (direction > 0 ? source.width : 0)} ${start.y} C ${start.x + direction * 90} ${start.y}, ${end.x - direction * 90} ${end.y}, ${target.x + (direction > 0 ? 0 : target.width)} ${end.y}`;
}

function DiagramNodeShape({ node, layout }: { node: DiagramNode; layout: NodeLayout }) {
  const render = getNodeRender(node);
  const lines = wrapSvgText(node.label, render.labelMaxLength, render.maxLines);
  const lineHeight = render.fontSize + 3;
  const firstLineY = layout.y + layout.height / 2 - ((lines.length - 1) * lineHeight) / 2 + render.fontSize / 3;
  const commonTextProps = {
    textAnchor: "middle" as const,
    fill: render.text,
    fontSize: render.fontSize,
    fontWeight: render.fontWeight,
  };

  if (render.shape === "diamond") {
    const cx = layout.x + layout.width / 2;
    const cy = layout.y + layout.height / 2;
    return (
      <g>
        <title>{node.label}</title>
        <path
          d={`M ${cx} ${layout.y} L ${layout.x + layout.width} ${cy} L ${cx} ${layout.y + layout.height} L ${layout.x} ${cy} Z`}
          fill={render.fill}
          stroke={render.stroke}
          strokeWidth="1.6"
        />
        <text x={cx} y={firstLineY} {...commonTextProps}>
          {lines.map((line, index) => (
            <tspan key={`${node.id}-line-${index}`} x={cx} dy={index === 0 ? 0 : lineHeight}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  }

  return (
    <g>
      <title>{node.label}</title>
      <rect
        x={layout.x}
        y={layout.y}
        width={layout.width}
        height={layout.height}
        rx={render.radius}
        fill={render.fill}
        stroke={render.stroke}
        strokeWidth="1.5"
      />
      <text x={layout.x + layout.width / 2} y={firstLineY} {...commonTextProps}>
        {lines.map((line, index) => (
          <tspan key={`${node.id}-line-${index}`} x={layout.x + layout.width / 2} dy={index === 0 ? 0 : lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

export function DiagramCanvas({ diagram }: { diagram: DiagramIR }) {
  const markerId = useId().replace(/:/g, "");
  const viewport = getViewport(diagram);
  const nodeLayouts = new Map(diagram.nodes.map((node, index) => [node.id, getNodeLayout(node, index)]));

  return (
    <svg
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      className="min-w-[860px] rounded-2xl border border-border bg-white shadow-sm-soft"
      role="img"
      aria-label={`${diagram.title} ${diagram.diagram_type === "flowchart" ? "流程图" : "思维导图"}`}
    >
      <defs>
        <marker id={`${markerId}-arrow`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
          <path d="M0,0 L9,4.5 L0,9 Z" fill="#64748B" />
        </marker>
      </defs>
      {diagram.edges.map((edge, index) => {
        const source = nodeLayouts.get(edge.source);
        const target = nodeLayouts.get(edge.target);
        if (!source || !target) return null;
        const render = getEdgeRender(edge);
        return (
          <path
            key={`${edge.source}-${edge.target}-${index}`}
            d={edgePath(source, target)}
            fill="none"
            stroke={render.stroke}
            strokeWidth={render.strokeWidth}
            strokeDasharray={render.strokeDasharray}
            markerEnd={render.arrow ? `url(#${markerId}-arrow)` : undefined}
          />
        );
      })}
      {diagram.nodes.map((node, index) => (
        <DiagramNodeShape key={node.id} node={node} layout={nodeLayouts.get(node.id) || getNodeLayout(node, index)} />
      ))}
    </svg>
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
                {diagram.diagram_type === "flowchart" ? "流程图" : "思维导图"} · {nodeCount} 节点 · {edgeCount} 连线
              </p>
              <h2 className="truncate text-base font-semibold text-text">{diagram.title || "AI 整理"}</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface-page px-2.5 py-1.5 text-xs text-text-muted sm:inline-flex">
              <Maximize2 className="h-3.5 w-3.5" />
              滚动查看
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
