import { useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  Brain,
  ChevronRight,
  ClipboardList,
  Clock3,
  FileSearch,
  GitBranch,
  Loader2,
  NotebookPen,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import SourcePanel from "./SourcePanel";
import { api } from "../../services/api";
import type { ApiResponse, ChatMessage, ChatNote, DiagramIR, DiagramNode, DiagramType, Source } from "../../types";

type NavigatorView = "thread" | "evidence";

type StructuredSummary = {
  id: string;
  turn: number;
  question: string;
  answer: string;
  createdAt?: string;
  sourceCount: number;
  confidence?: number;
  followups: string[];
  retrievalMs?: number;
  llmMs?: number;
  totalMs?: number;
  hitCount?: number;
};

type DiagramState = {
  loading: boolean;
  data?: DiagramIR;
  error?: string;
};

interface ConversationNavigatorProps {
  messages: ChatMessage[];
  activeTitle: string;
  selectedSources: Source[] | null;
  highlightSourceIdx: number | null;
  notes: ChatNote[];
  notesLoading: boolean;
  notesWritable: boolean;
  onClose: () => void;
  onClearSources: () => void;
  onFollowUp: (query: string) => void;
  onPreviewSource: (source: Source) => void;
  onInspectSources: (sources: Source[], index?: number) => void;
  onHighlightDone: () => void;
  onCreateNote: (content: string) => Promise<boolean>;
  onUpdateNote: (noteId: string, content: string) => Promise<boolean>;
  onDeleteNote: (noteId: string) => Promise<boolean>;
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

function formatTimeLabel(iso?: string) {
  if (!iso) return "刚刚";
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms?: number) {
  if (ms == null || Number.isNaN(ms)) return "未返回";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function getDiagramKey(messageId: string, diagramType: DiagramType) {
  return `${messageId}:${diagramType}`;
}

function nodeLabel(node: DiagramNode, maxLength = 14) {
  return truncateText(node.label, maxLength);
}

function MindmapPreview({ diagram }: { diagram: DiagramIR }) {
  const root = diagram.nodes.find((node) => node.kind === "root") || diagram.nodes[0];
  const categories = diagram.nodes.filter((node) => node.kind === "category");
  const keywords = diagram.nodes.filter((node) => node.kind === "keyword" || node.kind === "topic");
  const categoryById = new Map(categories.map((node) => [node.id, node]));
  const keywordGroups = new Map<string, DiagramNode[]>();

  categories.forEach((category) => keywordGroups.set(category.id, []));
  diagram.edges.forEach((edge) => {
    const target = keywords.find((node) => node.id === edge.target);
    if (target && categoryById.has(edge.source)) {
      keywordGroups.get(edge.source)?.push(target);
    }
  });
  if (categories.length === 0) {
    keywordGroups.set("root", keywords);
  }

  const groupIds = categories.length > 0 ? categories.map((node) => node.id) : ["root"];
  const height = Math.max(190, groupIds.length * 76 + 38);
  const rootY = height / 2 - 18;

  return (
    <div className="rounded-lg border border-border bg-surface-page p-2">
      <svg viewBox={`0 0 340 ${height}`} className="h-auto w-full" role="img" aria-label={`${diagram.title} 思维导图`}>
        <defs>
          <marker id="mindmap-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" className="fill-accent/60" />
          </marker>
        </defs>
        {root && (
          <g>
            <rect x="12" y={rootY} width="82" height="36" rx="8" className="fill-accent-soft stroke-accent/40" />
            <text x="53" y={rootY + 22} textAnchor="middle" className="fill-accent text-[10px] font-semibold">
              {nodeLabel(root, 8)}
            </text>
          </g>
        )}
        {groupIds.map((groupId, groupIndex) => {
          const category = categoryById.get(groupId);
          const groupKeywords = keywordGroups.get(groupId) || [];
          const y = 24 + groupIndex * 76;
          const categoryY = y + Math.max(0, (Math.min(groupKeywords.length, 3) - 1) * 16);

          return (
            <g key={groupId}>
              <path
                d={`M94 ${rootY + 18} C120 ${rootY + 18}, 118 ${categoryY + 15}, 136 ${categoryY + 15}`}
                className="fill-none stroke-accent/35"
                strokeWidth="1.5"
                markerEnd="url(#mindmap-arrow)"
              />
              <rect x="136" y={categoryY} width="66" height="30" rx="7" className="fill-white stroke-border" />
              <text x="169" y={categoryY + 19} textAnchor="middle" className="fill-text text-[10px] font-semibold">
                {nodeLabel(category || root, 6)}
              </text>
              {groupKeywords.slice(0, 3).map((keyword, keywordIndex) => {
                const keywordY = y + keywordIndex * 28;
                return (
                  <g key={keyword.id}>
                    <path
                      d={`M202 ${categoryY + 15} C218 ${categoryY + 15}, 218 ${keywordY + 13}, 232 ${keywordY + 13}`}
                      className="fill-none stroke-border"
                      strokeWidth="1.25"
                    />
                    <rect x="232" y={keywordY} width="88" height="26" rx="13" className="fill-white stroke-accent/25" />
                    <text x="276" y={keywordY + 17} textAnchor="middle" className="fill-text-secondary text-[9px] font-medium">
                      {nodeLabel(keyword, 9)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {keywords.slice(0, 6).map((node) => (
          <span key={node.id} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-text-muted">
            {node.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function FlowchartPreview({ diagram }: { diagram: DiagramIR }) {
  const nodes = diagram.nodes.slice(0, 8);
  const height = Math.max(160, nodes.length * 68 + 24);

  return (
    <div className="rounded-lg border border-border bg-surface-page p-2">
      <svg viewBox={`0 0 340 ${height}`} className="h-auto w-full" role="img" aria-label={`${diagram.title} 流程图`}>
        <defs>
          <marker id="flow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" className="fill-text-muted" />
          </marker>
        </defs>
        {nodes.map((node, index) => {
          const y = 18 + index * 68;
          const isDecision = node.kind === "decision";
          const nextY = y + 68;
          return (
            <g key={node.id}>
              {index < nodes.length - 1 && (
                <line
                  x1="170"
                  y1={isDecision ? y + 48 : y + 42}
                  x2="170"
                  y2={nextY - 6}
                  className="stroke-text-muted"
                  strokeWidth="1.5"
                  markerEnd="url(#flow-arrow)"
                />
              )}
              {isDecision ? (
                <path d={`M170 ${y} L246 ${y + 26} L170 ${y + 52} L94 ${y + 26} Z`} className="fill-warning/10 stroke-warning/40" />
              ) : (
                <rect x="72" y={y} width="196" height="44" rx="9" className="fill-white stroke-border" />
              )}
              <text
                x="170"
                y={y + (isDecision ? 30 : 26)}
                textAnchor="middle"
                className={`text-[10px] font-semibold ${isDecision ? "fill-warning" : "fill-text"}`}
              >
                {nodeLabel(node, isDecision ? 14 : 18)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 grid grid-cols-2 gap-1.5 text-[10px] text-text-muted">
        <span className="rounded-md bg-white px-2 py-1">步骤 {nodes.length}</span>
        <span className="rounded-md bg-white px-2 py-1">判断 {nodes.filter((node) => node.kind === "decision").length}</span>
      </div>
    </div>
  );
}

function DiagramPreview({ diagram }: { diagram: DiagramIR }) {
  if (!diagram.nodes.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-page px-3 py-4 text-center text-xs text-text-muted">
        暂无可视化节点
      </div>
    );
  }

  if (diagram.diagram_type === "mindmap") {
    return <MindmapPreview diagram={diagram} />;
  }

  return <FlowchartPreview diagram={diagram} />;
}

export default function ConversationNavigator({
  messages,
  activeTitle,
  selectedSources,
  highlightSourceIdx,
  notes,
  notesLoading,
  notesWritable,
  onClose,
  onClearSources,
  onFollowUp,
  onPreviewSource,
  onInspectSources,
  onHighlightDone,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
}: ConversationNavigatorProps) {
  const [view, setView] = useState<NavigatorView>("thread");
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [diagramType, setDiagramType] = useState<DiagramType>("mindmap");
  const [diagramStates, setDiagramStates] = useState<Record<string, DiagramState>>({});

  useEffect(() => {
    if (selectedSources && selectedSources.length > 0) {
      setView("evidence");
    }
  }, [selectedSources]);

  useEffect(() => {
    if (!notesWritable) {
      setNoteEditorOpen(false);
      setEditingNoteId(null);
      setNoteDraft("");
    }
  }, [notesWritable]);

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

  const structuredSummaries = useMemo<StructuredSummary[]>(() => {
    let turn = 0;
    return messages
      .map((message, index) => {
        if (message.role !== "user") return null;
        turn += 1;
        const answer = messages.slice(index + 1).find((item) => item.role === "assistant");
        if (!answer) return null;

        const trace = answer.metadata?.trace;
        return {
          id: answer.persistedId || answer.id,
          turn,
          question: truncateText(message.content || "未命名问题", 36),
          answer: truncateText(answer.content || "暂无回答", 88),
          createdAt: answer.created_at,
          sourceCount: answer.sources?.length || 0,
          confidence: answer.confidence,
          followups: answer.followups || [],
          retrievalMs: trace?.retrieval_ms,
          llmMs: trace?.llm_ms,
          totalMs: trace?.total_ms ?? answer.latency_ms ?? undefined,
          hitCount: trace?.hit_count,
        };
      })
      .filter(Boolean)
      .slice(-3)
      .reverse() as StructuredSummary[];
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

  const latestSummary = structuredSummaries[0];
  const latestDiagramKey = latestSummary ? getDiagramKey(latestSummary.id, diagramType) : "";
  const latestDiagramState = latestDiagramKey ? diagramStates[latestDiagramKey] : undefined;
  const assistantCount = messages.filter((message) => message.role === "assistant").length;
  const noteCount = notes.length;

  const scrollToMessage = (messageId: string) => {
    document.getElementById(getMessageElementId(messageId))?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const openNewNoteComposer = () => {
    if (!notesWritable) return;
    setEditingNoteId(null);
    setNoteDraft("");
    setNoteEditorOpen(true);
  };

  const openEditNoteComposer = (note: ChatNote) => {
    if (!notesWritable) return;
    setEditingNoteId(note.id);
    setNoteDraft(note.content);
    setNoteEditorOpen(true);
  };

  const closeNoteComposer = () => {
    setNoteEditorOpen(false);
    setEditingNoteId(null);
    setNoteDraft("");
  };

  const saveNote = async () => {
    const content = noteDraft.trim();
    if (!content || savingNote) return;

    setSavingNote(true);
    const ok = editingNoteId
      ? await onUpdateNote(editingNoteId, content)
      : await onCreateNote(content);
    setSavingNote(false);

    if (ok) {
      closeNoteComposer();
    }
  };

  const removeNote = async (noteId: string) => {
    const confirmed = window.confirm("删除这条笔记？");
    if (!confirmed) return;
    const ok = await onDeleteNote(noteId);
    if (ok && editingNoteId === noteId) {
      closeNoteComposer();
    }
  };

  const generateDiagram = async (nextType: DiagramType) => {
    if (!latestSummary) return;
    setDiagramType(nextType);
    const key = getDiagramKey(latestSummary.id, nextType);
    const existing = diagramStates[key];
    if (existing?.data || existing?.loading) return;

    setDiagramStates((prev) => ({
      ...prev,
      [key]: { loading: true },
    }));

    try {
      const res = await api.post<ApiResponse<DiagramIR>>(
        `/chat/messages/${encodeURIComponent(latestSummary.id)}/diagram`,
        {
          diagram_type: nextType,
          title: latestSummary.question,
        }
      );
      setDiagramStates((prev) => ({
        ...prev,
        [key]: { loading: false, data: res.data },
      }));
    } catch (error) {
      setDiagramStates((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          error: error instanceof Error ? error.message : "生成失败",
        },
      }));
    }
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
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">会话笔记</h3>
                <span className="text-[10px] text-text-muted">{noteCount} 条</span>
              </div>
            </div>
            <button
              onClick={openNewNoteComposer}
              disabled={!notesWritable}
              className="flex w-full items-center justify-between rounded-lg border border-dashed border-border bg-white px-3 py-3 text-left transition-colors hover:border-accent/35 hover:bg-accent-soft/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ClipboardList className="h-4 w-4 shrink-0 text-text-muted" />
                <span className="truncate text-xs font-medium text-text-secondary">添加本轮要点</span>
              </span>
              <span className="text-[10px] text-text-muted">{notesWritable ? "可编辑" : "无会话"}</span>
            </button>

            {noteEditorOpen && (
              <div className="mt-2 rounded-lg border border-border bg-white p-3 shadow-sm-soft">
                <textarea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  rows={4}
                  placeholder="记录当前会话要点。"
                  className="w-full resize-none rounded-md border border-border bg-surface-page px-3 py-2 text-xs leading-relaxed text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-text-muted">
                    {editingNoteId ? "编辑现有笔记" : "新增会话笔记"}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={closeNoteComposer}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11px] font-medium text-text-muted hover:text-text"
                    >
                      <X className="h-3.5 w-3.5" />
                      取消
                    </button>
                    <button
                      onClick={() => void saveNote()}
                      disabled={!noteDraft.trim() || savingNote}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      保存
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-2 space-y-2">
              {notesLoading ? (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                  正在加载笔记
                </div>
              ) : notes.length > 0 ? (
                notes.map((note) => (
                  <div key={note.id} className="rounded-lg border border-border bg-white px-3 py-2.5 shadow-sm-soft">
                    <div className="flex items-start gap-2">
                      <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-4 text-xs leading-relaxed text-text-secondary">{note.content}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-text-muted">
                          <span>{formatTimeLabel(note.updated_at)}</span>
                          <span className="rounded-full bg-surface-page px-1.5 py-0.5 text-[10px] font-medium text-text-muted">会话</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => openEditNoteComposer(note)}
                          className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text"
                          title="编辑笔记"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => void removeNote(note.id)}
                          className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-warning"
                          title="删除笔记"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                  还没有会话笔记
                </div>
              )}
            </div>
          </section>

          <section className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-text-muted" />
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">结构化输出</h3>
                {latestSummary && (
                  <span className="text-[10px] text-text-muted">最新轮次 {latestSummary.turn}</span>
                )}
              </div>
            </div>
            {latestSummary ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border bg-white px-2.5 py-2">
                    <span className="block text-[10px] text-text-muted">置信度</span>
                    <span className="block text-sm font-semibold text-text">
                      {latestSummary.confidence != null ? scoreLabel(latestSummary.confidence) : "未返回"}
                    </span>
                  </div>
                  <div className="rounded-lg border border-border bg-white px-2.5 py-2">
                    <span className="block text-[10px] text-text-muted">引用</span>
                    <span className="block text-sm font-semibold text-text">{latestSummary.sourceCount}</span>
                  </div>
                  <div className="rounded-lg border border-border bg-white px-2.5 py-2">
                    <span className="block text-[10px] text-text-muted">检索</span>
                    <span className="block text-sm font-semibold text-text">{formatDuration(latestSummary.retrievalMs)}</span>
                  </div>
                  <div className="rounded-lg border border-border bg-white px-2.5 py-2">
                    <span className="block text-[10px] text-text-muted">总耗时</span>
                    <span className="block text-sm font-semibold text-text">{formatDuration(latestSummary.totalMs)}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-white px-3 py-2.5 shadow-sm-soft">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Clock3 className="h-3.5 w-3.5 text-text-muted" />
                      <span className="text-xs font-semibold text-text">最新回答</span>
                    </div>
                    <span className="text-[10px] text-text-muted">{latestSummary.question}</span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-text-secondary">{latestSummary.answer}</p>
                  {latestSummary.followups.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {latestSummary.followups.slice(0, 3).map((question) => (
                        <button
                          key={question}
                          onClick={() => onFollowUp(question)}
                          className="rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-medium text-accent hover:bg-accent hover:text-white"
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-text-muted">
                    <span className="rounded-md bg-surface-page px-2 py-1">模型 {formatDuration(latestSummary.llmMs)}</span>
                    <span className="rounded-md bg-surface-page px-2 py-1">命中 {latestSummary.hitCount ?? "—"}</span>
                    <span className="rounded-md bg-surface-page px-2 py-1">更新时间 {formatTimeLabel(latestSummary.createdAt)}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-white px-3 py-2.5 shadow-sm-soft">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-text-muted" />
                      <span className="text-xs font-semibold text-text">AI 整理</span>
                    </div>
                    <span className="text-[10px] text-text-muted">
                      {latestDiagramState?.data
                        ? `${latestDiagramState.data.nodes.length} 节点`
                        : "未生成"}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void generateDiagram("mindmap")}
                      disabled={latestDiagramState?.loading}
                      className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        diagramType === "mindmap"
                          ? "border-accent/40 bg-accent-soft text-accent"
                          : "border-border bg-white text-text-muted hover:border-accent/35 hover:text-text"
                      }`}
                    >
                      {diagramType === "mindmap" && latestDiagramState?.loading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Brain className="h-3.5 w-3.5" />
                      )}
                      <span className="truncate">思维导图</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateDiagram("flowchart")}
                      disabled={latestDiagramState?.loading}
                      className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        diagramType === "flowchart"
                          ? "border-accent/40 bg-accent-soft text-accent"
                          : "border-border bg-white text-text-muted hover:border-accent/35 hover:text-text"
                      }`}
                    >
                      {diagramType === "flowchart" && latestDiagramState?.loading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Workflow className="h-3.5 w-3.5" />
                      )}
                      <span className="truncate">流程图</span>
                    </button>
                  </div>

                  {latestDiagramState?.error && (
                    <div className="mt-3 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-warning">
                      {latestDiagramState.error}
                    </div>
                  )}
                  {latestDiagramState?.data && (
                    <div className="mt-3">
                      <DiagramPreview diagram={latestDiagramState.data} />
                    </div>
                  )}
                </div>

                {structuredSummaries.length > 1 && (
                  <div className="space-y-1.5">
                    {structuredSummaries.slice(1).map((item) => (
                      <div key={item.id} className="rounded-lg border border-border bg-white px-3 py-2 text-xs shadow-sm-soft">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-text">第 {item.turn} 轮</span>
                          <span className="text-[10px] text-text-muted">{item.sourceCount} 条引用</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-secondary">{item.answer}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                当前还没有可展示的结构化输出
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
