import { useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  ChevronRight,
  ClipboardList,
  FileSearch,
  GitBranch,
  MessageSquare,
  NotebookPen,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ChatMessage, ChatNote, Source } from "../../types";

type NavigatorView = "roadmap" | "notes";

type RoadmapItem = {
  id: string;
  targetId: string;
  turn: number;
  title: string;
  essence: string;
  status: "done" | "active" | "follow_up";
  sourceCount: number;
  artifactCount: number;
  createdAt?: string;
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
  return `${normalized.slice(0, maxLength - 1)}...`;
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

function formatShortDate(iso?: string) {
  if (!iso) return "刚刚";
  return new Date(iso).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

function artifactCount(message?: ChatMessage) {
  const withArtifacts = message as (ChatMessage & { artifacts?: unknown[] }) | undefined;
  if (Array.isArray(withArtifacts?.artifacts)) return withArtifacts.artifacts.length;

  const metadataArtifacts = message?.metadata?.artifacts;
  return Array.isArray(metadataArtifacts) ? metadataArtifacts.length : 0;
}

function noteScopeLabel(scope: ChatNote["scope"]) {
  if (scope === "source") return "引用";
  if (scope === "message") return "回答";
  return "会话";
}

function buildRoadmap(messages: ChatMessage[]): RoadmapItem[] {
  let turn = 0;
  return messages
    .map((message, index) => {
      if (message.role !== "user") return null;
      turn += 1;

      const answer = messages.slice(index + 1).find((item) => item.role === "assistant");
      const sourceCount = answer?.sources?.length || 0;
      const artifacts = artifactCount(answer);
      const answerId = answer ? answer.persistedId || answer.id : "";

      return {
        id: message.id,
        targetId: answerId || message.id,
        turn,
        title: truncateText(message.content || "未命名问题", 40),
        essence: answer
          ? truncateText(answer.content || "该轮回答尚无摘要", 44)
          : "等待知识库回答生成后沉淀要点。",
        status: answer ? "done" : "active",
        sourceCount,
        artifactCount: artifacts,
        createdAt: answer?.created_at || message.created_at,
      } satisfies RoadmapItem;
    })
    .filter(Boolean) as RoadmapItem[];
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
  const [view, setView] = useState<NavigatorView>("roadmap");
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    if (selectedSources && selectedSources.length > 0) {
      setView("notes");
      window.setTimeout(() => onHighlightDone(), 320);
    }
  }, [onHighlightDone, selectedSources]);

  useEffect(() => {
    if (!notesWritable) {
      setNoteEditorOpen(false);
      setEditingNoteId(null);
      setNoteDraft("");
    }
  }, [notesWritable]);

  const roadmap = useMemo(() => buildRoadmap(messages), [messages]);
  const currentSourceIndex = selectedSources?.[highlightSourceIdx ?? 0] ? highlightSourceIdx ?? 0 : 0;
  const currentSource = selectedSources?.[currentSourceIndex];
  const sourceCount = roadmap.reduce((total, item) => total + item.sourceCount, 0);
  const artifactCountTotal = roadmap.reduce((total, item) => total + item.artifactCount, 0);

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

    if (ok) closeNoteComposer();
  };

  const removeNote = async (noteId: string) => {
    const confirmed = window.confirm("删除这条笔记？");
    if (!confirmed) return;
    const ok = await onDeleteNote(noteId);
    if (ok && editingNoteId === noteId) closeNoteComposer();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <header className="shrink-0 border-b border-divider px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-accent" />
              <h2 className="truncate text-sm font-semibold text-text">知识工作台</h2>
            </div>
            <p className="mt-1 truncate text-[11px] text-text-muted">{activeTitle || "新会话"}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            title="关闭知识工作台"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-border bg-white px-2 py-2">
            <span className="block text-sm font-semibold text-text">{roadmap.length}</span>
            <span className="text-[10px] text-text-muted">节点</span>
          </div>
          <div className="rounded-lg border border-border bg-white px-2 py-2">
            <span className="block text-sm font-semibold text-text">{sourceCount}</span>
            <span className="text-[10px] text-text-muted">证据</span>
          </div>
          <div className="rounded-lg border border-border bg-white px-2 py-2">
            <span className="block text-sm font-semibold text-text">{notes.length}</span>
            <span className="text-[10px] text-text-muted">笔记</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-surface-page p-1">
          <button
            onClick={() => setView("roadmap")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              view === "roadmap" ? "bg-white text-text shadow-sm-soft" : "text-text-muted hover:text-text"
            }`}
          >
            路线图
          </button>
          <button
            onClick={() => setView("notes")}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              view === "notes" ? "bg-white text-text shadow-sm-soft" : "text-text-muted hover:text-text"
            }`}
          >
            知识笔记
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto chat-scroll-area px-4 py-4">
        {view === "roadmap" ? (
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BookOpenText className="h-4 w-4 text-text-muted" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">当前会话路线图</h3>
              </div>
              {artifactCountTotal > 0 && (
                <span className="rounded-full bg-accent-soft px-2 py-1 text-[10px] font-semibold text-accent">
                  {artifactCountTotal} 个图解
                </span>
              )}
            </div>

            {roadmap.length > 0 ? (
              <div className="space-y-2">
                {roadmap.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => scrollToMessage(item.targetId)}
                    className="group w-full rounded-xl border border-border bg-white px-3 py-2.5 text-left shadow-sm-soft transition-all hover:border-accent/35 hover:bg-accent-soft/25"
                  >
                    <span className="block min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            item.status === "done"
                              ? "bg-success-soft text-success"
                              : "bg-accent-soft text-accent"
                          }`}
                        >
                          {item.turn}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{item.title}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                      </span>
                      <span className="mt-0.5 block truncate text-xs leading-5 text-text-secondary">{item.essence}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
                        <span className="rounded-full bg-surface-page px-1.5 py-0.5">{item.status === "done" ? "已处理" : "进行中"}</span>
                        {item.sourceCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-surface-page px-1.5 py-0.5">
                            <FileSearch className="h-3 w-3" />
                            {item.sourceCount}
                          </span>
                        )}
                        {item.artifactCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-accent">
                            <Sparkles className="h-3 w-3" />
                            {item.artifactCount}
                          </span>
                        )}
                        <span>{formatShortDate(item.createdAt)}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
                暂无会话路线
              </div>
            )}
          </section>
        ) : (
          <section>
            {currentSource && selectedSources && (
              <div className="mb-4 rounded-xl border border-accent/25 bg-accent-soft/25 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileSearch className="h-4 w-4 text-accent" />
                      <h3 className="text-xs font-semibold text-text">当前引用资料</h3>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-text-muted">
                      {selectedSources.length} 条引用 · 当前第 {currentSourceIndex + 1} 条
                    </p>
                  </div>
                  <button
                    onClick={onClearSources}
                    className="rounded-lg p-1.5 text-text-muted hover:bg-white hover:text-text"
                    title="关闭当前引用"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-3 rounded-lg border border-border bg-white px-3 py-2.5 shadow-sm-soft">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-text">{currentSource.document_title}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-muted">
                        {currentSource.section_path || "未标注章节"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      {scoreLabel(currentSource.score)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-text-secondary">
                    {currentSource.content || currentSource.snippet || "暂无片段"}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => onPreviewSource(currentSource)}
                      className="rounded-lg border border-border bg-white px-2 py-1.5 text-[11px] font-medium text-text-secondary hover:border-accent/40 hover:text-accent"
                    >
                      原文
                    </button>
                    <button
                      onClick={() => onFollowUp(`请详细介绍《${currentSource.document_title}》中"${currentSource.section_path}"的相关内容`)}
                      className="rounded-lg bg-accent px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-hover"
                    >
                      追问
                    </button>
                  </div>
                  {selectedSources.length > 1 && (
                    <div className="mt-3 space-y-1">
                      {selectedSources.slice(0, 6).map((source, index) => (
                        <button
                          key={`${source.chunk_id || source.document_id}-${index}`}
                          onClick={() => onInspectSources(selectedSources, index)}
                          className={`grid w-full grid-cols-[1.5rem_1fr_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
                            index === currentSourceIndex ? "bg-accent-soft text-text" : "bg-surface-page text-text-muted hover:text-text"
                          }`}
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white text-[10px] font-semibold text-accent">
                            {index + 1}
                          </span>
                          <span className="min-w-0 truncate">{source.document_title}</span>
                          <span>{scoreLabel(source.score)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mb-2 flex items-center gap-2">
              <NotebookPen className="h-4 w-4 text-text-muted" />
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">知识笔记</h3>
                <span className="text-[10px] text-text-muted">{notes.length} 条</span>
              </div>
            </div>

            <button
              onClick={openNewNoteComposer}
              disabled={!notesWritable}
              className="flex w-full items-center justify-between rounded-lg border border-dashed border-border bg-white px-3 py-3 text-left transition-colors hover:border-accent/35 hover:bg-accent-soft/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ClipboardList className="h-4 w-4 shrink-0 text-text-muted" />
                <span className="truncate text-xs font-medium text-text-secondary">沉淀本轮结论或资料评论</span>
              </span>
              <span className="text-[10px] text-text-muted">{notesWritable ? "可编辑" : "无会话"}</span>
            </button>

            {noteEditorOpen && (
              <div className="mt-2 rounded-lg border border-border bg-white p-3 shadow-sm-soft">
                <textarea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  rows={4}
                  placeholder="记录当前会话结论、引用评论、风险提示或人工补充。"
                  className="w-full resize-none rounded-md border border-border bg-surface-page px-3 py-2 text-xs leading-relaxed text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-text-muted">
                    {editingNoteId ? "编辑现有笔记" : "新增知识笔记"}
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

            <div className="mt-3 space-y-2">
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
                          <span className="rounded-full bg-surface-page px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                            {noteScopeLabel(note.scope)}
                          </span>
                          {note.document_id && <span className="truncate">文档 {truncateText(note.document_id, 18)}</span>}
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
                <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-muted">
                  还没有知识笔记
                </div>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-border bg-white px-3 py-3 text-[11px] leading-relaxed text-text-muted">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-text-secondary">
                <MessageSquare className="h-3.5 w-3.5" />
                使用建议
              </div>
              将回答结论、引用资料评论、线下验证结果和风险提示沉淀在这里，后续会按回答和资料聚合。
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
