import { useState, useEffect, useCallback } from "react";
import { X, FileText, ExternalLink, Loader2, MessageSquare, Send, Trash2, Pencil, CornerDownRight, ArrowUpRight } from "lucide-react";
import type { Source, DocComment } from "../../types";
import { api } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import { showToast } from "../ui/Toast";

interface Props { source: Source; onClose: () => void; }

export default function DocPreview({ source, onClose }: Props) {
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

  const loadComments = useCallback(() => {
    api.get<{ data: { items: DocComment[] } }>(`/documents/${source.document_id}/comments?chunk_id=${source.chunk_id}`)
      .then((res) => setComments(res.data?.items || []))
      .catch(() => {})
      .finally(() => setCommentsLoading(false));
  }, [source.document_id, source.chunk_id]);

  useEffect(() => {
    api.post("/stats/browse", { event_type: "source_view", resource_type: "chunk", resource_id: source.chunk_id, metadata: { document_title: source.document_title, score: source.score } }).catch(() => {});

    const immediateContent = source.content || source.snippet || "";
    if (immediateContent) {
      setContent(immediateContent);
      setLoading(false);
    }

    api.get<{ data: { content: string } }>(`/documents/chunks/${source.chunk_id}`)
      .then((res) => {
        if (res.data?.content) setContent(res.data.content);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    loadComments();
  }, [source.chunk_id]);

  const handleSubmit = async (parentId?: string) => {
    const text = parentId ? commentText : commentText;
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

  const highlightSnippet = (text: string) => text.replace(/\n/g, "<br/>");

  const topLevelComments = comments.filter((c) => !c.parent_id);
  const replies = (parentId: string) => comments.filter((c) => c.parent_id === parentId);

  return (
    <div className="flex h-full flex-col bg-surface overflow-hidden animate-fade-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-accent shrink-0" />
          <h3 className="text-sm font-semibold text-text truncate">{source.document_title}</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text transition-colors"><X className="h-4 w-4" /></button>
      </div>

      {/* Meta bar */}
      <div className="px-4 py-2 border-b border-divider bg-surface-page/50 shrink-0">
        <p className="text-xs text-text-muted">{source.section_path}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs font-semibold text-accent">相关度 {(source.score * 100).toFixed(0)}%</span>
          <span className="text-[10px] text-text-muted font-mono">{source.chunk_id?.substring(0, 16)}</span>
          <a href={`/documents?doc_id=${source.document_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-accent hover:underline ml-auto"><ArrowUpRight className="h-3 w-3" />打开原文</a>
        </div>
      </div>

      {/* Content + Comments scrollable area */}
      <div className="flex-1 overflow-y-auto">
        {/* Document content */}
        <div className="p-4 border-b border-divider">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 text-text-muted animate-spin" /></div>
          ) : content ? (
            <div className="prose prose-sm max-w-none text-sm text-text leading-relaxed" dangerouslySetInnerHTML={{ __html: highlightSnippet(content) }} />
          ) : (
            <div className="text-center py-12">
              <FileText className="h-8 w-8 text-text-muted/30 mx-auto mb-2" />
              <p className="text-sm text-text-muted">无法加载全文</p>
              <p className="text-xs text-text-muted mt-1">{(source.content || source.snippet || "").substring(0, 100)}...</p>
            </div>
          )}
        </div>

        {/* Comments section */}
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-4 w-4 text-text-muted" />
            <h4 className="text-sm font-semibold text-text">评论 ({topLevelComments.length})</h4>
          </div>

          {commentsLoading ? (
            <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 text-text-muted animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              {topLevelComments.map((c) => (
                <div key={c.id}>
                  <div className="group rounded-lg bg-surface-page p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-text">{c.user_name}</span>
                        <span className="text-[10px] text-text-muted">{new Date(c.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {user && c.user_id === user.id && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEdit(c)} className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-hover"><Pencil className="h-3 w-3" /></button>
                          <button onClick={() => handleDelete(c.id)} className="p-1 rounded text-text-muted hover:text-danger hover:bg-danger-soft"><Trash2 className="h-3 w-3" /></button>
                        </div>
                      )}
                    </div>
                    {editingId === c.id ? (
                      <div className="flex gap-2 mt-1">
                        <input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleEdit(c.id); if (e.key === "Escape") setEditingId(null); }}
                          className="flex-1 px-2 py-1 text-xs border border-border rounded bg-surface focus:outline-none focus:border-accent"
                          autoFocus
                        />
                        <button onClick={() => handleEdit(c.id)} disabled={submitting} className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50">保存</button>
                      </div>
                    ) : (
                      <p className="text-sm text-text-secondary leading-relaxed">{c.content}</p>
                    )}
                    <button
                      onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setCommentText(""); }}
                      className="mt-1 text-[10px] text-text-muted hover:text-accent transition-colors"
                    >
                      回复
                    </button>
                  </div>

                  {/* Replies */}
                  {replies(c.id).map((r) => (
                    <div key={r.id} className="ml-6 mt-1 group rounded-lg bg-surface-page p-2.5 border-l-2 border-accent/20">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-2">
                          <CornerDownRight className="h-3 w-3 text-text-muted" />
                          <span className="text-xs font-semibold text-text">{r.user_name}</span>
                          <span className="text-[10px] text-text-muted">{new Date(r.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        {user && r.user_id === user.id && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEdit(r)} className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-hover"><Pencil className="h-3 w-3" /></button>
                            <button onClick={() => handleDelete(r.id)} className="p-1 rounded text-text-muted hover:text-danger hover:bg-danger-soft"><Trash2 className="h-3 w-3" /></button>
                          </div>
                        )}
                      </div>
                      {editingId === r.id ? (
                        <div className="flex gap-2 mt-1">
                          <input
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleEdit(r.id); if (e.key === "Escape") setEditingId(null); }}
                            className="flex-1 px-2 py-1 text-xs border border-border rounded bg-surface focus:outline-none focus:border-accent"
                            autoFocus
                          />
                          <button onClick={() => handleEdit(r.id)} disabled={submitting} className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50">保存</button>
                        </div>
                      ) : (
                        <p className="text-sm text-text-secondary leading-relaxed">{r.content}</p>
                      )}
                    </div>
                  ))}

                  {/* Reply input */}
                  {replyTo === c.id && (
                    <div className="ml-6 mt-1 flex gap-2">
                      <input
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(c.id); if (e.key === "Escape") setReplyTo(null); }}
                        placeholder="输入回复..."
                        className="flex-1 px-2 py-1.5 text-xs border border-border rounded-lg bg-surface focus:outline-none focus:border-accent"
                        autoFocus
                      />
                      <button onClick={() => handleSubmit(c.id)} disabled={submitting || !commentText.trim()} className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50"><Send className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </div>
              ))}
              {topLevelComments.length === 0 && (
                <p className="text-xs text-text-muted text-center py-4">暂无评论，来说点什么吧</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Comment input */}
      <div className="px-4 py-3 border-t border-divider shrink-0 flex gap-2">
        <input
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !replyTo) handleSubmit(); }}
          placeholder={replyTo ? `回复中...` : "添加评论..."}
          className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-surface-page focus:outline-none focus:border-accent"
        />
        <button onClick={() => handleSubmit()} disabled={submitting || !commentText.trim()} className="p-2 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50"><Send className="h-4 w-4" /></button>
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-divider shrink-0 flex items-center justify-between">
        <a href="/documents" className="flex items-center gap-1.5 text-xs text-accent hover:underline"><ExternalLink className="h-3 w-3" />文档管理</a>
        <span className="text-[10px] text-text-muted">chunk: {source.chunk_id?.substring(0, 12)}</span>
      </div>
    </div>
  );
}
