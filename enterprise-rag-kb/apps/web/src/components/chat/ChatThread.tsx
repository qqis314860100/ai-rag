import { useRef, useEffect, useState } from "react";
import { User, ThumbsUp, ThumbsDown, Copy, StopCircle, Sparkles, FileSearch, ChevronRight, RefreshCw, Pencil, AlertCircle } from "lucide-react";
import type { ChatMessage, Source } from "../../types";
import { MarkdownContent } from "./MarkdownContent";
import { api } from "../../services/api";
import { showToast } from "../ui/Toast";

interface ChatThreadProps {
  messages: ChatMessage[];
  loading: boolean;
  streamingContent: string;
  streamError: string | null;
  streamStopped: boolean;
  selectedSources: Source[] | null;
  onSelectSources: (sources: Source[] | null) => void;
  onCopy?: (content: string) => void;
  onFollowUp: (query: string) => void;
  onCancelStream: () => void;
  onInitialQuestion: (query: string) => void;
  onRetry: () => void;
  onEditUser: (messageId: string, content: string) => void;
  onPreviewSource: (source: Source) => void;
}

export default function ChatThread({ messages, loading, streamingContent, streamError, streamStopped, selectedSources, onSelectSources, onCopy, onFollowUp, onCancelStream, onInitialQuestion, onRetry, onEditUser, onPreviewSource }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [feedbackCounts, setFeedbackCounts] = useState<Record<string, { up: number; down: number; userVote?: string }>>({});
  const [voting, setVoting] = useState<Record<string, boolean>>({});

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const prevContentLen = useRef(0);
  useEffect(() => {
    // Only auto-scroll during active streaming (content growing)
    // Don't scroll on completion — prevents flicker
    if (loading && streamingContent.length > prevContentLen.current) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
    prevContentLen.current = streamingContent.length;
    // Also scroll on new messages (user sent or switched session)
    if (!loading && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const justAdded = lastMsg && Date.now() - new Date(lastMsg.created_at).getTime() < 500;
      if (justAdded) {
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
      }
    }
  }, [messages, streamingContent, loading]);

  // Fetch feedback counts for all messages
  useEffect(() => {
    const msgIds = messages.filter(m => m.role === "assistant" && !m.id.startsWith("user-")).map(m => m.id);
    if (msgIds.length === 0) return;
    api.get<{ data: Record<string, { up: number; down: number; userVote?: string }> }>(`/stats/feedback-counts?message_ids=${msgIds.join(",")}`)
      .then(res => setFeedbackCounts(res.data || {}))
      .catch(() => {});
  }, [messages]);

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    showToast("success", "已复制到剪贴板");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleFeedback = async (messageId: string, rating: "up" | "down") => {
    if (voting[messageId]) return;
    setVoting(v => ({ ...v, [messageId]: true }));
    try {
      const current = feedbackCounts[messageId] || { up: 0, down: 0 };
      const isToggle = current.userVote === rating;

      if (isToggle) {
        // Toggle off — delete feedback (simplified: just remove local state)
        setFeedbackCounts(f => ({
          ...f,
          [messageId]: { ...current, userVote: undefined, [rating]: Math.max(0, current[rating] - 1) },
        }));
        showToast("success", "已取消反馈");
      } else {
        await api.post("/feedback", { message_id: messageId, rating });
        setFeedbackCounts(f => ({
          ...f,
          [messageId]: {
            up: current.up + (rating === "up" ? 1 : 0) - (current.userVote === "up" ? 1 : 0),
            down: current.down + (rating === "down" ? 1 : 0) - (current.userVote === "down" ? 1 : 0),
            userVote: rating,
          },
        }));
        showToast("success", rating === "up" ? "感谢点赞！" : "反馈已记录");
      }
    } catch {
      showToast("error", "反馈提交失败");
    } finally {
      setVoting(v => ({ ...v, [messageId]: false }));
    }
  };

  if (messages.length === 0 && !loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center px-8 py-12">
        <div className="w-16 h-16 rounded-2xl bg-accent-soft flex items-center justify-center mb-6">
          <Sparkles className="h-7 w-7 text-accent" />
        </div>
        <h2 className="text-[17px] font-serif font-normal text-text tracking-tight">智能问答助手</h2>
        <p className="mt-2 max-w-md text-[15px] text-text-secondary leading-relaxed">
          基于电池产线知识库，为你提供准确、可追溯的技术问答。每次回答都会标注引用来源。
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          {[
            "Busbar 激光焊接有哪些关键参数？",
            "模组 EOL 测试包含哪些项目？",
            "CCD 检测误判常见原因有哪些？",
            "电芯分选的标准是什么？",
          ].map((q) => (
            <button
              key={q}
              onClick={() => onInitialQuestion(q)}
              className="px-4 py-2.5 rounded-xl border border-border bg-surface text-[13px] text-text-secondary hover:border-accent hover:text-accent hover:bg-accent-soft/50 transition-all duration-normal ease-out"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8">
      {messages.map((msg, i) => (
        <div key={msg.id} className={`flex gap-3 items-start ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          style={{ animation: `fadeInUp var(--duration-normal) var(--ease-out) both`, animationDelay: `${Math.min(i * 40, 300)}ms` }}>
          {msg.role === "assistant" && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent mt-0.5">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
          )}

          <div className="max-w-[72%]">
            {msg.role === "assistant" ? (
              <div className="rounded-xl bg-surface px-5 py-4">
                <div className="prose prose-sm max-w-none text-sm text-text leading-relaxed">
                  <MarkdownContent content={msg.content} sources={msg.sources} onSourceClick={(idx) => { const s = msg.sources?.[idx]; if (s) onPreviewSource(s as Source); }} />
                </div>

                {/* Footer */}
                <div className="mt-4 flex items-center gap-3 pt-3 border-t border-divider">
                  {msg.sources && msg.sources.length > 0 && (
                    <button
                      onClick={() => onSelectSources(selectedSources === msg.sources ? null : msg.sources!)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent-hover transition-colors bg-accent-light hover:bg-accent-light/60 rounded-lg px-2.5 py-1"
                    >
                      <FileSearch className="h-3 w-3" />
                      查看 {msg.sources.length} 条引用
                    </button>
                  )}
                  {msg.confidence !== undefined && msg.confidence > 0 && (
                    <span className="text-xs text-text-muted">置信度 {(msg.confidence * 100).toFixed(0)}%</span>
                  )}
                  <div className="ml-auto flex items-center gap-0.5">
                    <button onClick={() => handleCopy(msg.id, msg.content)} className="min-w-[36px] min-h-[36px] rounded-lg p-1.5 text-text-muted hover:bg-surface-hover hover:text-text transition-colors flex items-center justify-center" title={copiedId === msg.id ? "已复制" : "复制"} aria-label="复制回答">
                      <Copy className="h-4 w-4" />
                    </button>
                    {(() => {
                      const fb = feedbackCounts[msg.id] || { up: 0, down: 0 };
                      const userVote = fb.userVote;
                      return (
                        <>
                          <button onClick={() => handleFeedback(msg.id, "up")} disabled={voting[msg.id]}
                            className={`min-w-[36px] min-h-[36px] rounded-lg p-1.5 transition-colors flex items-center justify-center gap-1 ${
                              userVote === "up" ? "text-success bg-success-soft" : "text-text-muted hover:bg-success-soft hover:text-success"
                            }`} aria-label="点赞">
                            <ThumbsUp className="h-4 w-4" fill={userVote === "up" ? "currentColor" : "none"} />
                            {fb.up > 0 && <span className="text-xs font-medium">{fb.up}</span>}
                          </button>
                          <button onClick={() => handleFeedback(msg.id, "down")} disabled={voting[msg.id]}
                            className={`min-w-[36px] min-h-[36px] rounded-lg p-1.5 transition-colors flex items-center justify-center gap-1 ${
                              userVote === "down" ? "text-danger bg-danger-soft" : "text-text-muted hover:bg-danger-soft hover:text-danger"
                            }`} aria-label="踩">
                            <ThumbsDown className="h-4 w-4" fill={userVote === "down" ? "currentColor" : "none"} />
                            {fb.down > 0 && <span className="text-xs font-medium">{fb.down}</span>}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Follow-ups */}
                {msg.followups && msg.followups.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-divider">
                    <p className="mb-2 text-xs font-medium text-text-muted uppercase tracking-wider">推荐追问</p>
                    <div className="flex flex-wrap gap-2">
                      {msg.followups.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => onFollowUp(q)}
                          className="inline-flex items-center gap-1 min-h-[36px] px-3 py-2 rounded-full border border-border bg-surface-page text-xs text-text-secondary hover:border-accent hover:text-accent hover:bg-accent-soft/30 transition-all duration-normal ease-out"
                        >
                          {q}
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="group relative rounded-xl bg-primary px-5 py-3 text-[15px] leading-relaxed text-white">
                {editingMsgId === msg.id ? (
                  <div className="flex flex-col gap-2 min-w-[280px]">
                    <textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEditUser(msg.id, editValue); setEditingMsgId(null); }
                        if (e.key === "Escape") { setEditingMsgId(null); }
                      }}
                      className="w-full min-h-[80px] px-3 py-2 text-sm text-text border border-white/20 rounded-lg bg-white/10 focus:outline-none focus:border-white/40 resize-none placeholder:text-white/40"
                      autoFocus
                      placeholder="编辑消息..."
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setEditingMsgId(null)}
                        className="px-3 py-1.5 text-xs rounded-lg bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => { onEditUser(msg.id, editValue); setEditingMsgId(null); }}
                        disabled={!editValue.trim()}
                        className="px-3 py-1.5 text-xs rounded-lg bg-white/20 text-white hover:bg-white/30 disabled:opacity-40 transition-colors"
                      >
                        保存并发送
                      </button>
                    </div>
                  </div>
                ) : (
                  msg.content
                )}
                {editingMsgId !== msg.id && (
                  <button
                    onClick={() => { setEditingMsgId(msg.id); setEditValue(msg.content); }}
                    className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-text-muted hover:text-text hover:bg-surface-hover"
                    title="编辑消息"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>

          {msg.role === "user" && (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary mt-0.5">
              <User className="h-3.5 w-3.5" />
            </div>
          )}
        </div>
      ))}

      {/* Streaming message */}
      {loading && streamingContent && (
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent mt-0.5 animate-pulse" style={{ animationDuration: "2s" }}>
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="max-w-[72%] rounded-xl bg-surface px-5 py-4 ring-1 ring-accent/20">
            <div className="prose prose-sm max-w-none text-sm text-text leading-relaxed">
              <MarkdownContent content={streamingContent} />
              <span className="inline-block w-[3px] h-5 ml-0.5 bg-accent align-middle" style={{ animation: "cursorBlink 0.6s step-end infinite", borderRadius: 1 }} />
            </div>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {loading && !streamingContent && (
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent shadow-sm-soft">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="rounded-lg glass shadow-sm-soft px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
                <span className="h-2.5 w-2.5 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
                <span className="h-2.5 w-2.5 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
              </div>
              <span className="text-sm text-text-muted">检索知识库中...</span>
              <button onClick={onCancelStream} className="ml-auto p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger-soft transition-colors" title="停止生成">
                <StopCircle size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error/Stopped state — shown when stream ends with error or is stopped */}
      {!loading && streamError && !streamStopped && (
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger shadow-sm-soft">
            <AlertCircle className="h-4 w-4" />
          </div>
          <div className="max-w-[72%]">
            <div className="rounded-lg bg-danger-soft/50 border border-danger/20 px-5 py-4">
              <p className="text-sm text-text-secondary">{streamError}</p>
              <button
                onClick={onRetry}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover text-xs font-medium text-accent transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />重试
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && streamStopped && (
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-text-muted shadow-sm-soft">
            <StopCircle className="h-4 w-4" />
          </div>
          <div className="max-w-[72%]">
            <p className="text-sm text-text-muted mb-1">已中断</p>
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover text-xs font-medium text-accent border border-border transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />重试
            </button>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
