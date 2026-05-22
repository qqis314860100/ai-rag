import { useRef, useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Copy, StopCircle, Sparkles, FileSearch, ChevronRight, RefreshCw, Pencil, AlertCircle } from "lucide-react";
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

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export default function ChatThread({ messages, loading, streamingContent, streamError, streamStopped, selectedSources, onSelectSources, onFollowUp, onCancelStream, onInitialQuestion, onRetry, onEditUser, onPreviewSource }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [feedbackCounts, setFeedbackCounts] = useState<Record<string, { up: number; down: number; userVote?: string }>>({});
  const [voting, setVoting] = useState<Record<string, boolean>>({});

  const prevContentLen = useRef(0);
  useEffect(() => {
    if (loading && streamingContent.length > prevContentLen.current) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
    prevContentLen.current = streamingContent.length;
    if (!loading && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const justAdded = lastMsg && Date.now() - new Date(lastMsg.created_at).getTime() < 500;
      if (justAdded) bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [messages, streamingContent, loading]);

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
        setFeedbackCounts(f => ({ ...f, [messageId]: { ...current, userVote: undefined, [rating]: Math.max(0, current[rating] - 1) } }));
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
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-accent-soft flex items-center justify-center mb-6">
          <Sparkles className="h-7 w-7 text-accent" />
        </div>
        <h2 className="text-[17px] font-serif font-normal text-text">智能问答助手</h2>
        <p className="mt-2 max-w-md text-[15px] text-text-secondary leading-relaxed">
          基于电池产线知识库，为你提供准确、可追溯的技术问答。
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {["Busbar 激光焊接有哪些关键参数？", "模组 EOL 测试包含哪些项目？", "CCD 检测误判常见原因有哪些？", "电芯分选的标准是什么？"].map((q) => (
            <button key={q} onClick={() => onInitialQuestion(q)}
              className="px-4 py-2 rounded-xl border border-border text-[13px] text-text-secondary hover:border-accent hover:text-accent hover:bg-accent-soft/50 transition-all duration-normal">
              {q}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-8">
      {messages.map((msg, i) => {
        const isUser = msg.role === "user";
        const fb = feedbackCounts[msg.id] || { up: 0, down: 0 };

        return (
          <div key={msg.id}
            className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
            style={{ animation: `fadeInUp var(--duration-normal) var(--ease-out) both`, animationDelay: `${Math.min(i * 40, 300)}ms` }}
          >
            {/* Message text — no bubbles, plain text */}
            <div className={`max-w-[85%] ${isUser ? "text-right" : "text-left"}`}>
              {!isUser ? (
                <div className="text-[15px] leading-relaxed text-text">
                  <MarkdownContent content={msg.content} sources={msg.sources} onSourceClick={(idx) => { const s = msg.sources?.[idx]; if (s) onPreviewSource(s as Source); }} />
                </div>
              ) : editingMsgId === msg.id ? (
                <div className="flex flex-col gap-2 min-w-[280px]">
                  <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEditUser(msg.id, editValue); setEditingMsgId(null); } if (e.key === "Escape") setEditingMsgId(null); }}
                    className="w-full min-h-[80px] px-3 py-2 text-[15px] border border-border rounded-xl bg-surface focus:outline-none focus:border-accent resize-none"
                    autoFocus placeholder="编辑消息..." />
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setEditingMsgId(null)} className="px-3 py-1.5 text-xs rounded-lg bg-surface hover:bg-surface-hover text-text-secondary transition-colors">取消</button>
                    <button onClick={() => { onEditUser(msg.id, editValue); setEditingMsgId(null); }} disabled={!editValue.trim()}
                      className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-40 transition-colors">保存并发送</button>
                  </div>
                </div>
              ) : (
                <div className="group relative">
                  <p className="text-[15px] leading-relaxed text-text">{msg.content}</p>
                  <button onClick={() => { setEditingMsgId(msg.id); setEditValue(msg.content); }}
                    className="absolute -left-7 top-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-text-muted hover:text-text" title="编辑">
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* AI message: sources + follow-ups */}
              {!isUser && (
                <>
                  {msg.sources && msg.sources.length > 0 && (
                    <button onClick={() => onSelectSources(selectedSources === msg.sources ? null : msg.sources!)}
                      className="inline-flex items-center gap-1 mt-2 text-xs text-accent hover:text-accent-hover transition-colors">
                      <FileSearch className="h-3 w-3" />
                      查看 {msg.sources.length} 条引用
                      {msg.confidence !== undefined && msg.confidence > 0 && (
                        <span className="text-text-muted ml-1">· 置信度 {(msg.confidence * 100).toFixed(0)}%</span>
                      )}
                    </button>
                  )}
                  {msg.followups && msg.followups.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {msg.followups.map((q, j) => (
                        <button key={j} onClick={() => onFollowUp(q)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-border text-xs text-text-secondary hover:border-accent hover:text-accent transition-colors">
                          {q}<ChevronRight className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Time + actions row — small text below message */}
            <div className={`flex items-center gap-3 mt-1.5 ${isUser ? "justify-end" : "justify-start"}`}>
              <span className="text-[11px] text-text-muted">{formatTime(msg.created_at)}</span>
              <div className="flex items-center gap-0.5 opacity-0 hover:opacity-100 transition-opacity">
                <button onClick={() => handleCopy(msg.id, msg.content)}
                  className="p-0.5 rounded text-text-muted hover:text-text transition-colors" title="复制">
                  <Copy className="h-3 w-3" />
                </button>
                <button onClick={() => handleFeedback(msg.id, "up")} disabled={voting[msg.id]}
                  className={`p-0.5 rounded transition-colors ${fb.userVote === "up" ? "text-success" : "text-text-muted hover:text-success"}`} title="点赞">
                  <ThumbsUp className="h-3 w-3" fill={fb.userVote === "up" ? "currentColor" : "none"} />
                </button>
                {fb.up > 0 && <span className="text-[11px] text-text-muted">{fb.up}</span>}
                <button onClick={() => handleFeedback(msg.id, "down")} disabled={voting[msg.id]}
                  className={`p-0.5 rounded transition-colors ${fb.userVote === "down" ? "text-danger" : "text-text-muted hover:text-danger"}`} title="踩">
                  <ThumbsDown className="h-3 w-3" fill={fb.userVote === "down" ? "currentColor" : "none"} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Streaming message */}
      {loading && streamingContent && (
        <div className="flex flex-col items-start">
          <div className="max-w-[85%]">
            <div className="text-[15px] leading-relaxed text-text">
              <MarkdownContent content={streamingContent} />
              <span className="inline-block w-[3px] h-5 ml-0.5 bg-accent align-middle" style={{ animation: "cursorBlink 0.6s step-end infinite", borderRadius: 1 }} />
            </div>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {loading && !streamingContent && (
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span className="h-2 w-2 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
            <span className="h-2 w-2 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
            <span className="h-2 w-2 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
            检索知识库中...
            <button onClick={onCancelStream} className="ml-2 p-1 rounded text-text-muted hover:text-danger transition-colors" title="停止">
              <StopCircle size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {!loading && streamError && !streamStopped && (
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4" />
            {streamError}
          </div>
          <button onClick={onRetry} className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
            <RefreshCw className="h-3 w-3" />重试
          </button>
        </div>
      )}

      {!loading && streamStopped && (
        <div className="flex flex-col items-start">
          <span className="text-sm text-text-muted">已中断</span>
          <button onClick={onRetry} className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
            <RefreshCw className="h-3 w-3" />重试
          </button>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
