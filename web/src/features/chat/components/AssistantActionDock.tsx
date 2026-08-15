import { BookMarked, Brain, CircleHelp, Eye, FileCheck, Loader2, Sparkles, Workflow } from "lucide-react";
import type { ChatArtifact, ChatMessage, DiagramType } from "../types";
import {
  assetStatusLabel,
  getDiagramActionLabel,
  getDiagramButtonLabel,
  getDiagramKey,
  type DiagramState,
} from "./chatThreadUtils";

interface AssistantActionDockProps {
  message: ChatMessage;
  messageId: string;
  artifacts: ChatArtifact[];
  assetStatus: { card?: string; faq?: string };
  canCreateAssetDraft: boolean;
  open: boolean;
  diagramStates: Record<string, DiagramState>;
  onToggle: () => void;
  onFollowUp: (query: string) => void;
  onCreateKnowledgeAssetDraft?: (messageId: string, type: "card" | "faq") => Promise<void>;
  onGenerateDiagram: (message: ChatMessage, type: DiagramType, artifact?: ChatArtifact) => void;
  onOpenArtifact: (artifact: ChatArtifact) => void;
}

function artifactLabel(type: string, subtype?: unknown) {
  if (type === "diagram") return subtype === "architecture" ? "架构图" : "图解";
  if (type === "mindmap") return "思维导图";
  if (type === "flowchart") return "流程图";
  if (type === "chart") return "图表";
  return type || "产物";
}

function artifactStatusLabel(status: string) {
  if (status === "ready") return "可查看";
  if (status === "pending") return "生成中";
  if (status === "failed") return "失败";
  return status;
}

function diagramArtifact(artifacts: ChatArtifact[], type: DiagramType) {
  return artifacts.find((artifact) => (
    artifact.type === type ||
    artifact.metadata?.type === type ||
    artifact.metadata?.diagram_type === type
  ));
}

export default function AssistantActionDock({
  message,
  messageId,
  artifacts,
  assetStatus,
  canCreateAssetDraft,
  open,
  diagramStates,
  onToggle,
  onFollowUp,
  onCreateKnowledgeAssetDraft,
  onGenerateDiagram,
  onOpenArtifact,
}: AssistantActionDockProps) {
  return (
    <div className="mt-4 flex justify-end border-t border-divider/70 pt-3">
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft/70 px-3 py-1.5 text-xs font-semibold text-accent shadow-sm-soft transition-colors hover:border-accent/60 hover:bg-accent-soft"
          title="整理本条回答"
        >
          <Sparkles className="h-3.5 w-3.5" />
          AI 整理
          {artifacts.length > 0 && (
            <span className="rounded-full bg-white/75 px-1.5 py-0.5 text-[10px] text-accent">{artifacts.length}</span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-white shadow-lg-soft">
            <div className="border-b border-divider/70 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                整理与沉淀
              </div>
              <p className="mt-0.5 text-[11px] text-text-muted">大型图解在后台生成，完成后用弹窗查看。</p>
            </div>
            <div className="grid gap-1 p-2">
              <button
                type="button"
                onClick={() => onFollowUp("请把上一条回答整理成 3 条关键结论，并保留必要的引用依据。")}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
              >
                <FileCheck className="h-4 w-4 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-text">总结精髓</span>
                  <span className="block truncate text-[11px] text-text-muted">生成 3 条关键结论并保留引用</span>
                </span>
              </button>

              {(["card", "faq"] as const).map((assetType) => {
                const Icon = assetType === "card" ? BookMarked : CircleHelp;
                const status = assetType === "card" ? assetStatus.card : assetStatus.faq;
                const label = assetType === "card" ? "知识卡草稿" : "FAQ 草稿";
                return (
                  <button
                    key={assetType}
                    type="button"
                    onClick={() => void onCreateKnowledgeAssetDraft?.(messageId, assetType)}
                    disabled={!canCreateAssetDraft || !onCreateKnowledgeAssetDraft || Boolean(status)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <Icon className="h-4 w-4 text-accent" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-text">{label}</span>
                      <span className="block truncate text-[11px] text-text-muted">
                        {status ? assetStatusLabel(status) : canCreateAssetDraft ? "沉淀为可审核知识资产" : "当前回答需先复核"}
                      </span>
                    </span>
                  </button>
                );
              })}

              {(["mindmap", "flowchart"] as DiagramType[]).map((type) => {
                const state = diagramStates[getDiagramKey(messageId, type)];
                const artifact = state?.data || diagramArtifact(artifacts, type);
                const Icon = type === "mindmap" ? Brain : Workflow;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => onGenerateDiagram(message, type, artifact)}
                    disabled={state?.loading}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-wait disabled:opacity-60"
                    title={getDiagramButtonLabel(type, Boolean(artifact))}
                  >
                    {state?.loading ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : <Icon className="h-4 w-4 text-accent" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-text">{getDiagramActionLabel(type, Boolean(artifact))}</span>
                      <span className="block truncate text-[11px] text-text-muted">{artifact ? artifactStatusLabel(artifact.status) : "基于回答与引用生成"}</span>
                    </span>
                  </button>
                );
              })}

              {artifacts.length > 0 && (
                <div className="mt-1 border-t border-divider/70 pt-2">
                  <div className="px-2 pb-1 text-[11px] font-semibold text-text-muted">已生成产物</div>
                  {artifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      onClick={() => {
                        if (artifact.status === "ready") onOpenArtifact(artifact);
                      }}
                      disabled={artifact.status !== "ready"}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Eye className="h-4 w-4 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-text">{artifact.title || artifactLabel(artifact.type, artifact.metadata?.subtype)}</span>
                        <span className="block truncate text-[11px] text-text-muted">
                          {artifactLabel(artifact.type, artifact.metadata?.subtype)} · {artifactStatusLabel(artifact.status)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {(["mindmap", "flowchart"] as DiagramType[]).map((type) => {
                const state = diagramStates[getDiagramKey(messageId, type)];
                return state?.error ? (
                  <div key={`${type}-error`} className="rounded-lg bg-warning-soft px-2.5 py-2 text-[11px] leading-relaxed text-warning">
                    {state.error}
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
