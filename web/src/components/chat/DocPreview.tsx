import { useState, useEffect, useCallback, useMemo } from "react";
import { X, FileText, MessageSquare, Send, Trash2, Pencil, FileCode, Globe, Loader2, ExternalLink, CornerDownRight } from "lucide-react";
import type { Source, DocComment } from "../../types";
import { api } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import { showToast } from "../ui/Toast";
import { MarkdownContent } from "./MarkdownContent";

interface Props {
  source: Source;
  onClose: () => void;
  onAskAbout?: (source: Source) => void;
}

type PreviewMode = "text" | "markdown" | "raw" | "pdf" | "html" | "code";

const PREVIEW_MODES: Array<{
  mode: PreviewMode;
  label: string;
  icon: typeof FileText;
  enabled: boolean;
  note?: string;
}> = [
  { mode: "text", label: "文本", icon: FileText, enabled: true },
  { mode: "markdown", label: "Markdown", icon: MessageSquare, enabled: true },
  { mode: "raw", label: "原文", icon: FileCode, enabled: true },
  { mode: "pdf", label: "PDF", icon: FileText, enabled: false, note: "待接入 PDF 预览" },
  { mode: "html", label: "HTML", icon: Globe, enabled: false, note: "待接入 HTML 清洗预览" },
  { mode: "code", label: "代码", icon: FileCode, enabled: false, note: "待接入代码高亮预览" },
];

function looksLikeMarkdown(text: string) {
  return /(^#{1,6}\s)|(```)|(^[-*]\s)|(^\d+[.)]\s)|(\|.+\|)|(\[[^\]]+\]\([^)]+\))/m.test(text);
}

function detectInitialMode(documentType: string | undefined, category: string | undefined, body: string): PreviewMode {
  const sourceType = `${documentType || ""} ${category || ""}`.toLowerCase();
  if (sourceType.includes("markdown") || sourceType.includes("md") || looksLikeMarkdown(body)) {
    return "markdown";
  }
  return "text";
}

function getDocumentFormatLabel(documentTypeValue?: string, pageNumber?: number) {
  const documentType = documentTypeValue?.trim();
  if (documentType) return documentType;
  if (pageNumber) return "page";
  return "文本";
}

function renderTextBody(text: string) {
  return (
    <div className="prose prose-sm max-w-none text-sm leading-relaxed text-text whitespace-pre-wrap">
      {text}
    </div>
  );
}

export default function DocPreview({ source, onClose, onAskAbout }: Props) {
  const { user } = useAuth();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<PreviewMode>(() => detectInitialMode(source.document_type, source.category, source.content || source.snippet || ""));
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [originalLoading, setOriginalLoading] = useState(false);

  const supportedContent = useMemo(() => content || source.content || source.snippet || "", [content, source.content, source.snippet]);
  const formatLabel = useMemo(() => getDocumentFormatLabel(source.document_type, source.page_number), [source.document_type, source.page_number]);

  const loadComments = useCallback(() => {
    api
      .get<{ data: { items: DocComment[] } }>(`/documents/${source.document_id}/comments?chunk_id=${source.chunk_id}`)
      .then((res) => setComments(res.data?.items || []))
      .catch(() => {})
      .finally(() => setCommentsLoading(false));
  }, [source.document_id, source.chunk_id]);

  useEffect(() => {
    setActiveTab(detectInitialMode(source.document_type, source.category, source.content || source.snippet || ""));
    setContent(null);
    setLoading(true);
    setComments([]);
    setCommentsLoading(true);
    setCommentText("");
    setReplyTo(null);
    setEditingId(null);
    setEditText("");
    setOriginalContent(null);
    setOriginalLoading(false);

    api.post("/stats/browse", {
      event_type: "source_view",
      resource_type: "chunk",
      resource_id: source.chunk_id,
      metadata: { document_title: source.document_title, score: source.score },
    }).catch(() => {});

    const immediateContent = source.content || source.snippet || "";
    if (immediateContent) {
      setContent(immediateContent);
      setLoading(false);
    }

    api
      .get<{ data: { content: string } }>(`/documents/chunks/${source.chunk_id}`)
      .then((res) => {
        if (res.data?.content) setContent(res.data.content);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    loadComments();
  }, [
    loadComments,
    source.category,
    source.chunk_id,
    source.content,
    source.document_title,
    source.document_type,
    source.score,
    source.snippet,
  ]);

  const loadOriginalFile = useCallback(() => {
    if (originalContent !== null) return;
    setOriginalLoading(true);
    const sectionPath = encodeURIComponent(source.section_path || "");
    api
      .get<{ data: { content: string } }>(`/documents/${source.document_id}/raw?section_path=${sectionPath}`)
      .then((res) => setOriginalContent(res.data?.content || ""))
      .catch(() => setOriginalContent(""))
      .finally(() => setOriginalLoading(false));
  }, [originalContent, source.document_id, source.section_path]);

  const handleSubmit = async (parentId?: string) => {
    const text = commentText;
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/documents/${source.document_id}/comments`, {
        content: text.trim(),
        chunk_id: source.chunk_id,
        parent_id: parentId || undefined,
      });
      setCommentText("");
      setReplyTo(null);
      loadComments();
      showToast("success", "评论已发布");
    } catch {
      showToast("error", "评论发布失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (commentId: string) => {
    if (!editText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.patch(`/documents/${source.document_id}/comments/${commentId}`, { content: editText.trim() });
      setEditingId(null);
      setEditText("");
      loadComments();
      showToast("success", "评论已更新");
    } catch {
      showToast("error", "编辑失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("确定删除此评论？")) return;
    try {
      await api.delete(`/documents/${source.document_id}/comments/${commentId}`);
      loadComments();
      showToast("success", "评论已删除");
    } catch {
      showToast("error", "删除失败");
    }
  };

  const startEdit = (c: DocComment) => {
    setEditingId(c.id);
    setEditText(c.content);
  };

  const topLevelComments = comments.filter((c) => !c.parent_id);
  const replies = (parentId: string) => comments.filter((c) => c.parent_id === parentId);

  const renderPreviewBody = () => {
    if (activeTab === "pdf" || activeTab === "html" || activeTab === "code") {
      const disabledTab = PREVIEW_MODES.find((item) => item.mode === activeTab);
      const DisabledIcon = disabledTab?.icon;
      return (
        <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-page px-4 py-10 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-text-muted shadow-sm-soft">
            {DisabledIcon ? <DisabledIcon className="h-5 w-5" /> : null}
          </div>
          <p className="mt-3 text-sm font-semibold text-text">{disabledTab?.label} 预览待接入</p>
          <p className="mt-1 max-w-[20rem] text-xs leading-relaxed text-text-muted">
            {disabledTab?.note || "当前仅支持文本、Markdown 和原文切换。"}
          </p>
        </div>
      );
    }

    if (activeTab === "raw") {
      if (originalLoading || originalContent === null) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>;
      }

      if (originalContent) {
        return (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-border bg-[#fafaf8] p-4 text-[13px] leading-relaxed text-text">
            {originalContent}
          </pre>
        );
      }

      if (originalContent === "") {
        return (
          <div className="rounded-2xl border border-dashed border-border bg-surface-page px-4 py-10 text-center">
            <FileText className="mx-auto h-8 w-8 text-text-muted/30" />
            <p className="mt-3 text-sm text-text-muted">无法加载原文</p>
            <p className="mt-1 text-xs text-text-muted">文档文件可能已被移动或删除</p>
          </div>
        );
      }
    }

    if (loading && !supportedContent) {
      return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>;
    }

    if (!supportedContent) {
      return (
        <div className="rounded-2xl border border-dashed border-border bg-surface-page px-4 py-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-text-muted/30" />
          <p className="mt-3 text-sm text-text-muted">无法加载内容</p>
          <p className="mt-1 text-xs text-text-muted">{(source.content || source.snippet || "").substring(0, 100)}...</p>
        </div>
      );
    }

    if (activeTab === "markdown") {
      return (
        <div className="rounded-2xl border border-border bg-white p-4">
          <MarkdownContent content={supportedContent} />
        </div>
      );
    }

    return renderTextBody(supportedContent);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface animate-fade-in-right">
      <div className="flex shrink-0 items-center justify-between border-b border-divider px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-accent" />
          <h3 className="truncate text-sm font-semibold text-text">{source.document_title}</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className={`shrink-0 border-b border-divider bg-surface-page/50 px-4 py-2 ${source.category === "安全规范" ? "border-l-[3px] border-l-danger" : ""}`}>
        <p className="text-xs text-text-muted">{source.section_path}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-accent">相关度 {(source.score * 100).toFixed(0)}%</span>
          <span className="text-[10px] text-text-muted font-mono">{formatLabel}</span>
          {source.version && <span className="text-[10px] text-text-muted font-mono">V{source.version}</span>}
          <span className="text-[10px] text-text-muted font-mono">{source.chunk_id?.substring(0, 16)}</span>
          <div className="ml-auto flex items-center gap-2">
            {onAskAbout && (
              <button
                onClick={() => onAskAbout(source)}
                className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-[10px] font-medium text-accent transition-all hover:bg-accent hover:text-white"
              >
                <MessageSquare className="h-3 w-3" />基于此段落追问
              </button>
            )}
            <a href={`/documents?doc_id=${source.document_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-accent hover:underline">
              <ExternalLink className="h-3 w-3" />
              打开原文
            </a>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-divider bg-surface-page/30 px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {PREVIEW_MODES.map((mode) => {
              const Icon = mode.icon;
              const selected = activeTab === mode.mode;
              return (
                <button
                  key={mode.mode}
                  type="button"
                  disabled={!mode.enabled}
                  onClick={() => {
                    if (!mode.enabled) return;
                    setActiveTab(mode.mode);
                    if (mode.mode === "raw") loadOriginalFile();
                  }}
                  title={mode.enabled ? `切换到${mode.label}` : mode.note}
                  className={`rounded-xl border px-2.5 py-2 text-left transition-colors ${
                    mode.enabled
                      ? selected
                        ? "border-accent bg-white text-text shadow-sm-soft"
                        : "border-border bg-white/90 text-text-muted hover:border-accent/40 hover:text-text"
                      : "cursor-not-allowed border-dashed border-border/70 bg-surface-page text-text-muted/70 opacity-70"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${selected && mode.enabled ? "text-accent" : "text-current"}`} />
                    <span className="text-xs font-medium">{mode.label}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-tight text-text-muted">
                    {mode.enabled ? (mode.mode === "raw" ? "原始文件视图" : "当前可用") : (mode.note || "待接入")}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-b border-divider bg-white px-4 py-4">
          {renderPreviewBody()}
        </div>

        <div className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-text-muted" />
            <h4 className="text-sm font-semibold text-text">评论 ({topLevelComments.length})</h4>
          </div>

          {commentsLoading ? (
            <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-text-muted" /></div>
          ) : (
            <div className="space-y-3">
              {topLevelComments.map((c) => (
                <div key={c.id}>
                  <div className="group rounded-lg bg-surface-page p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-text">{c.user_name}</span>
                        <span className="text-[10px] text-text-muted">{new Date(c.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {user && c.user_id === user.id && (
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button onClick={() => startEdit(c)} className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"><Pencil className="h-3 w-3" /></button>
                          <button onClick={() => handleDelete(c.id)} className="rounded p-1 text-text-muted hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3 w-3" /></button>
                        </div>
                      )}
                    </div>
                    {editingId === c.id ? (
                      <div className="mt-1 flex gap-2">
                        <input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEdit(c.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                          autoFocus
                        />
                        <button onClick={() => handleEdit(c.id)} disabled={submitting} className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50">保存</button>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed text-text-secondary">{c.content}</p>
                    )}
                    <button
                      onClick={() => {
                        setReplyTo(replyTo === c.id ? null : c.id);
                        setCommentText("");
                      }}
                      className="mt-1 text-[10px] text-text-muted transition-colors hover:text-accent"
                    >
                      回复
                    </button>
                  </div>

                  {replies(c.id).map((r) => (
                    <div key={r.id} className="group ml-4 mt-2 border-l-2 border-border pl-3">
                      <div className="rounded-lg bg-surface-page/70 p-2.5">
                        <div className="mb-1 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CornerDownRight className="h-3 w-3 text-text-muted" />
                            <span className="text-xs font-semibold text-text">{r.user_name}</span>
                            <span className="text-[10px] text-text-muted">{new Date(r.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          {user && r.user_id === user.id && (
                            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <button onClick={() => startEdit(r)} className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"><Pencil className="h-3 w-3" /></button>
                              <button onClick={() => handleDelete(r.id)} className="rounded p-1 text-text-muted hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3 w-3" /></button>
                            </div>
                          )}
                        </div>
                        {editingId === r.id ? (
                          <div className="mt-1 flex gap-2">
                            <input
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleEdit(r.id);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                              autoFocus
                            />
                            <button onClick={() => handleEdit(r.id)} disabled={submitting} className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50">保存</button>
                          </div>
                        ) : (
                          <p className="text-sm leading-relaxed text-text-secondary">{r.content}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {topLevelComments.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                  暂无评论
                </div>
              )}
            </div>
          )}

          <div className="mt-4 rounded-lg border border-border bg-surface-page p-3">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={replyTo ? "写回复..." : "写评论..."}
              rows={3}
              className="w-full resize-none rounded border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <button
                onClick={() => {
                  setReplyTo(null);
                  setCommentText("");
                }}
                className="text-xs text-text-muted hover:text-text"
              >
                清空
              </button>
              <button
                onClick={() => handleSubmit(replyTo || undefined)}
                disabled={!commentText.trim() || submitting}
                className="inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                发送
              </button>
            </div>
          </div>

          {replyTo && <p className="mt-2 text-[10px] text-text-muted">正在回复上方评论</p>}
        </div>
      </div>
    </div>
  );
}
