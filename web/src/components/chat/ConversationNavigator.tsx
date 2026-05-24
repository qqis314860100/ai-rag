import { useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  BrainCircuit,
  ChevronRight,
  ClipboardList,
  FileSearch,
  GitBranch,
  Map,
  NotebookPen,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import SourcePanel from "./SourcePanel";
import { showToast } from "../ui/Toast";
import type { ChatMessage, Source } from "../../types";

type NavigatorView = "thread" | "evidence";

type AiOrganizeOption = {
  label: string;
  description: string;
  Icon: typeof BrainCircuit;
};

interface ConversationNavigatorProps {
  messages: ChatMessage[];
  activeTitle: string;
  selectedSources: Source[] | null;
  highlightSourceIdx: number | null;
  onClose: () => void;
  onClearSources: () => void;
  onFollowUp: (query: string) => void;
  onPreviewSource: (source: Source) => void;
  onInspectSources: (sources: Source[], index?: number) => void;
  onHighlightDone: () => void;
}

function getMessageElementId(messageId: string) {
  return `chat-message-${messageId}`;
}

function truncateText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function scoreLabel(score?: number) {
  if (!score) return "引用";
  return `${Math.round(score * 100)}%`;
}

const aiOrganizeOptions: AiOrganizeOption[] = [
  { label: "思维导图", description: "要点关系", Icon: BrainCircuit },
  { label: "流程图", description: "步骤路径", Icon: Workflow },
];

export default function ConversationNavigator({
  messages,
  activeTitle,
  selectedSources,
  highlightSourceIdx,
  onClose,
  onClearSources,
  onFollowUp,
  onPreviewSource,
  onInspectSources,
  onHighlightDone,
}: ConversationNavigatorProps) {
  const [view, setView] = useState<NavigatorView>("thread");

  useEffect(() => {
    if (selectedSources && selectedSources.length > 0) {
      setView("evidence");
    }
  }, [selectedSources]);

  const threadItems = useMemo(() => {
    let turn = 0;
    return messages
      .map((message, index) => {
        if (message.role !== "user") return null;
        turn += 1;
        const answer = messages.slice(index + 1).find((item) => item.role === "assistant");
        return {
          id: message.id,
          turn,
          title: truncateText(message.content || "未命名问题", 48),
          hasAnswer: !!answer,
          sourceCount: answer?.sources?.length || 0,
        };
      })
      .filter(Boolean) as Array<{ id: string; turn: number; title: string; hasAnswer: boolean; sourceCount: number }>;
  }, [messages]);

  const recentEvidence = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ source: Source; sources: Source[]; index: number }> = [];

    [...messages].reverse().forEach((message) => {
      if (message.role !== "assistant" || !message.sources?.length) return;
      message.sources.forEach((source, index) => {
        const key = source.chunk_id || `${source.document_id}-${source.section_path}-${index}`;
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ source, sources: message.sources!, index });
      });
    });

    return items.slice(0, 6);
  }, [messages]);

  const assistantCount = messages.filter((message) => message.role === "assistant").length;

  const scrollToMessage = (messageId: string) => {
    document.getElementById(getMessageElementId(messageId))?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const showPendingToast = (label: string) => {
    showToast("warning", `${label}待接入`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-divider px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-accent" />
              <h2 className="truncate text-sm font-semibold text-text">会话导航</h2>
            </div>
            <p className="mt-1 truncate text-[11px] text-text-muted">{activeTitle || "新会话"}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            title="关闭会话导航"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-border bg-white px-2 py-2">
            <span className="block text-sm font-semibold text-text">{threadItems.length}</span>
            <span className="text-[10px] text-text-muted">轮次</span>
          </div>
          <div className="rounded-lg border border-border bg-white px-2 py-2">
            <span className="block text-sm font-semibold text-text">{assistantCount}</span>
            <span className="text-[10px] text-text-muted">回答</span>
          </div>
          <div className="rounded-lg border border-border bg-white px-2 py-2">
            <span className="block text-sm font-semibold text-text">{recentEvidence.length}</span>
            <span className="text-[10px] text-text-muted">证据</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-surface-page p-1">
          <button
            onClick={() => setView("thread")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "thread" ? "bg-white text-text shadow-sm-soft" : "text-text-muted hover:text-text"
            }`}
          >
            线程
          </button>
          <button
            onClick={() => setView("evidence")}
            disabled={!selectedSources?.length && recentEvidence.length === 0}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              view === "evidence" ? "bg-white text-text shadow-sm-soft" : "text-text-muted hover:text-text"
            }`}
          >
            证据
          </button>
        </div>
      </header>

      {view === "evidence" && selectedSources?.length ? (
        <div className="min-h-0 flex-1">
          <SourcePanel
            sources={selectedSources}
            onClose={() => {
              onClearSources();
              setView("thread");
            }}
            onFollowUp={onFollowUp}
            onPreview={onPreviewSource}
            highlightIdx={highlightSourceIdx}
            onHighlightDone={onHighlightDone}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto chat-scroll-area px-4 py-4">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <BookOpenText className="h-4 w-4 text-text-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">当前线程目录</h3>
            </div>
            {threadItems.length > 0 ? (
              <div className="space-y-1.5">
                {threadItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => scrollToMessage(item.id)}
                    className="group w-full rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-accent/30 hover:bg-accent-soft/40"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-page text-[10px] font-semibold text-text-muted group-hover:bg-white group-hover:text-accent">
                        {item.turn}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-text">{item.title}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted">
                          {item.hasAnswer ? "已回答" : "等待回答"}
                          {item.sourceCount > 0 && (
                            <>
                              <span>·</span>
                              <FileSearch className="h-3 w-3" />
                              {item.sourceCount}
                            </>
                          )}
                        </span>
                      </span>
                      <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                暂无线程
              </div>
            )}
          </section>

          <section className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <FileSearch className="h-4 w-4 text-text-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">近期证据</h3>
            </div>
            {recentEvidence.length > 0 ? (
              <div className="space-y-2">
                {recentEvidence.map(({ source, sources, index }) => (
                  <button
                    key={`${source.chunk_id}-${index}`}
                    onClick={() => onInspectSources(sources, index)}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-left transition-all hover:border-accent/40 hover:shadow-sm-soft"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-text">{source.document_title}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-text-muted">{source.section_path || "未标注章节"}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        {scoreLabel(source.score)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                暂无证据
              </div>
            )}
          </section>

          <section className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <NotebookPen className="h-4 w-4 text-text-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">会话笔记</h3>
            </div>
            <button
              onClick={() => showPendingToast("会话笔记")}
              className="flex w-full items-center justify-between rounded-lg border border-dashed border-border bg-white px-3 py-3 text-left transition-colors hover:border-accent/35 hover:bg-accent-soft/30"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ClipboardList className="h-4 w-4 shrink-0 text-text-muted" />
                <span className="truncate text-xs font-medium text-text-secondary">添加本轮要点</span>
              </span>
              <span className="text-[10px] text-text-muted">待接入</span>
            </button>
          </section>

          <section className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-text-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">AI 整理</h3>
            </div>
            <button
              onClick={() => showPendingToast("AI 整理")}
              className="mb-2 flex w-full items-center justify-between rounded-lg border border-dashed border-border bg-white px-3 py-3 text-left transition-colors hover:border-accent/35 hover:bg-accent-soft/30"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Map className="h-4 w-4 shrink-0 text-text-muted" />
                <span className="truncate text-xs font-medium text-text-secondary">生成结构化摘要</span>
              </span>
              <span className="text-[10px] text-text-muted">待接入</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              {aiOrganizeOptions.map(({ label, description, Icon }) => (
                <button
                  key={label}
                  onClick={() => showPendingToast(label)}
                  className="rounded-lg border border-border bg-white px-3 py-2 text-left transition-colors hover:border-accent/35 hover:bg-accent-soft/30"
                >
                  <Icon className="mb-2 h-4 w-4 text-text-muted" />
                  <span className="block text-xs font-medium text-text-secondary">{label}</span>
                  <span className="text-[10px] text-text-muted">{description}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
