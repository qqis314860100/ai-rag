import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ChatThread from "../components/chat/ChatThread";
import { SessionList } from "../components/chat/SessionList";
import ChatInput from "../components/chat/ChatInput";
import SourcePanel from "../components/chat/SourcePanel";
import DocPreview from "../components/chat/DocPreview";
import { api } from "../services/api";
import { useStreamChat } from "../hooks/useStreamChat";
import { useChatHistory } from "../hooks/useChatHistory";
import { useChatDrafts } from "../hooks/useChatDrafts";
import { showToast } from "../components/ui/Toast";
import { track } from "../services/tracking";
import type { ChatMessage, Source } from "../types";
import { Menu, X, Plus, FileSearch } from "lucide-react";

function MessagesSkeleton() {
  return (
    <div className="py-6 space-y-10 px-4">
      {/* User bubble */}
      <div className="flex flex-col items-end">
        <div className="skeleton h-12 w-64 rounded-2xl" />
      </div>
      {/* AI response */}
      <div className="flex flex-col items-start space-y-3">
        <div className="skeleton h-6 w-48 rounded-lg" />
        <div className="skeleton h-4 w-full rounded-lg" />
        <div className="skeleton h-4 w-11/12 rounded-lg" />
        <div className="skeleton h-4 w-3/4 rounded-lg" />
        <div className="skeleton h-4 w-5/6 rounded-lg" />
      </div>
      {/* User bubble */}
      <div className="flex flex-col items-end">
        <div className="skeleton h-12 w-48 rounded-2xl" />
      </div>
      {/* AI response */}
      <div className="flex flex-col items-start space-y-3">
        <div className="skeleton h-4 w-10/12 rounded-lg" />
        <div className="skeleton h-4 w-full rounded-lg" />
        <div className="skeleton h-4 w-2/3 rounded-lg" />
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [searchParams] = useSearchParams();
  const urlSessionId = searchParams.get("session");
  const navigate = useNavigate();
  const {
    sessions,
    activeSessionId,
    messages,
    messagesLoading,
    setActiveSessionId,
    setMessages,
    loadSessions,
    createSession,
    deleteSession,
  } = useChatHistory(urlSessionId);

  const { saveDraft, getDraft, removeDraft } = useChatDrafts();
  const [selectedSources, setSelectedSources] = useState<Source[] | null>(null);
  const [previewSource, setPreviewSource] = useState<Source | null>(null);
  const [highlightSourceIdx, setHighlightSourceIdx] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scrollToBottomSignal, setScrollToBottomSignal] = useState(0);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSourcesRef = useRef<Source[] | null>(null);
  const pendingScrollSessionRef = useRef<string | null>(null);
  const sawLoadingForPendingSessionRef = useRef(false);

  const { stream, sendStream, cancelStream, isSending } = useStreamChat();

  // ── Sidebar: close on outside click (mobile overlay) + lock body scroll ──
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sidebarOpen && sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setSidebarOpen(false);
      }
    };
    if (sidebarOpen) {
      document.addEventListener("mousedown", handler);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.removeEventListener("mousedown", handler);
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "TEXTAREA" || target.tagName === "INPUT";
      // ESC: priority — DocPreview → SourcePanel → cancel stream
      if (e.key === "Escape") {
        if (previewSource) { setPreviewSource(null); return; }
        if (selectedSources) { setSelectedSources(null); return; }
        if (isSending) { cancelStream(); return; }
        return;
      }
      // "/" : focus input (only when not already in input)
      if (e.key === "/" && !isInput) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isSending, cancelStream, previewSource, selectedSources]);

  // ── Track page view ──
  useEffect(() => {
    track("page_view", "page", "chat");
  }, []);

  useEffect(() => {
    if (selectedSources && selectedSources.length > 0) {
      lastSourcesRef.current = selectedSources;
    }
  }, [selectedSources]);

  useEffect(() => {
    if (!activeSessionId) {
      pendingScrollSessionRef.current = null;
      sawLoadingForPendingSessionRef.current = false;
      return;
    }

    pendingScrollSessionRef.current = activeSessionId;
    sawLoadingForPendingSessionRef.current = false;
  }, [activeSessionId]);

  useEffect(() => {
    const pendingSession = pendingScrollSessionRef.current;
    if (!pendingSession || activeSessionId !== pendingSession) return;

    if (messagesLoading) {
      sawLoadingForPendingSessionRef.current = true;
      return;
    }

    if (!sawLoadingForPendingSessionRef.current || messages.length === 0) return;

    setScrollToBottomSignal((n) => n + 1);
    pendingScrollSessionRef.current = null;
    sawLoadingForPendingSessionRef.current = false;
  }, [activeSessionId, messages.length, messagesLoading]);

  // ── Streaming placeholders ──
  const placeholderIdRef = useRef<string | null>(null);
  const wasLoading = useRef(false);

  // Update streaming placeholder content during generation
  useEffect(() => {
    if (stream.loading && placeholderIdRef.current && stream.content) {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.id === placeholderIdRef.current) {
          return [...prev.slice(0, -1), { ...last, content: stream.content }];
        }
        return prev;
      });
    }
  }, [stream.content]); // Only depend on content changes, not loading

  // When stream ends (loading → false), finalize or remove placeholder
  useEffect(() => {
    if (stream.loading) {
      wasLoading.current = true;
      return;
    }
    if (!wasLoading.current || !placeholderIdRef.current) return;
    wasLoading.current = false;

    const pid = placeholderIdRef.current;
    placeholderIdRef.current = null;

    if (stream.error || stream.stopped) {
      setMessages((prev) => prev.filter((m) => m.id !== pid));
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pid
            ? {
                ...m,
                id: stream.messageId || pid,
                content: stream.content || m.content,
                sources: stream.sources,
                confidence: stream.confidence || undefined,
                followups: stream.followups || undefined,
                streaming: false,
                created_at: new Date().toISOString(),
              }
            : m
        )
      );
      loadSessions();
    }
  }, [stream.loading]);

  // ── Session actions ──
  const handleNewSession = useCallback(() => {
    if (activeSessionId && inputRef.current?.value) {
      saveDraft(activeSessionId, inputRef.current.value);
    }
    if (isSending) {
      cancelStream();
    }
    setActiveSessionId(null);
    setMessages([]);
    setSelectedSources(null);
    setSidebarOpen(false);
    navigate("/chat", { replace: true });
  }, [activeSessionId, cancelStream, isSending, navigate, saveDraft, setActiveSessionId, setMessages]);

  const handleToggleSources = useCallback(() => {
    if (selectedSources && selectedSources.length > 0) {
      setSelectedSources(null);
      return;
    }
    if (lastSourcesRef.current && lastSourcesRef.current.length > 0) {
      setSelectedSources(lastSourcesRef.current);
    }
  }, [selectedSources]);

  const handleSelectSession = useCallback((id: string) => {
    // Save current draft before switching
    if (activeSessionId && inputRef.current?.value) {
      saveDraft(activeSessionId, inputRef.current.value);
    }
    // Cancel in-flight stream
    if (isSending) cancelStream();
    setActiveSessionId(id);
    setSelectedSources(null);
    setSidebarOpen(false);
    navigate(`/chat?session=${encodeURIComponent(id)}`, { replace: true });
  }, [activeSessionId, setActiveSessionId, saveDraft, cancelStream, isSending, navigate]);

  const handleDeleteSession = useCallback(async (id: string) => {
    const ok = await deleteSession(id);
    if (ok) {
      if (activeSessionId === id) { setActiveSessionId(null); setMessages([]); }
      removeDraft(id);
    }
  }, [activeSessionId, deleteSession, removeDraft, setActiveSessionId, setMessages]);

  // ── Auto-save draft on input change ──
  const handleDraftChange = useCallback((val: string) => {
    if (activeSessionId) {
      saveDraft(activeSessionId, val);
    }
  }, [activeSessionId, saveDraft]);

  // ── Send message ──
  const handleSend = useCallback(async (message: string) => {
    if (!message.trim() || isSending) return;
    let sid = activeSessionId;
    if (!sid) {
      const session = await createSession(message.substring(0, 50));
      if (!session) return;
      sid = session.id;
      setActiveSessionId(sid);
    }
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`, session_id: sid, role: "user",
      content: message, created_at: new Date().toISOString(),
    };
    const placeholderId = `stream-${Date.now()}`;
    placeholderIdRef.current = placeholderId;
    const placeholderMsg: ChatMessage = {
      id: placeholderId, session_id: sid, role: "assistant",
      content: "", streaming: true, created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg, placeholderMsg]);
    setScrollToBottomSignal((n) => n + 1);
    setSelectedSources(null);

    // Clear draft for this session since message is sent
    removeDraft(sid);

    await sendStream(sid, message, 5);
  }, [activeSessionId, createSession, sendStream, isSending, removeDraft, setActiveSessionId, setMessages]);

  const handleFollowUp = useCallback((query: string) => {
    if (isSending) return;
    handleSend(query);
  }, [handleSend, isSending]);

  const handleInitialQuestion = useCallback((query: string) => {
    if (isSending) return;
    handleSend(query);
  }, [handleSend, isSending]);

  const handleRetry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    handleSend(lastUserMsg.content);
  }, [messages, handleSend]);

  const handleEditUser = useCallback((messageId: string, newContent: string) => {
    if (!newContent.trim() || isSending) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    setMessages((prev) => prev.slice(0, idx));
    handleSend(newContent.trim());
  }, [messages, handleSend, isSending]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;

    api.delete(`/chat/messages/${encodeURIComponent(messageId)}`)
      .then(() => {
        setMessages((prev) => prev.slice(0, idx));
        showToast("success", "消息已删除");
      })
      .catch(() => {
        showToast("error", "删除消息失败");
      });
  }, [messages, setMessages]);

  const activeTitle = activeSessionId
    ? (sessions.find((s) => s.id === activeSessionId)?.title || "会话")
    : "";

  const showSourcePanel = selectedSources && selectedSources.length > 0;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Session Sidebar (260px) ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        ref={sidebarRef}
        className={`shrink-0 border-r border-divider bg-surface-page flex flex-col transition-transform duration-slow ease-out z-40
          max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-lg
          ${sidebarOpen ? "max-lg:translate-x-0 w-[260px]" : "max-lg:-translate-x-full max-lg:w-[260px] lg:w-[260px]"}`}
      >
        <div className="flex items-center justify-between px-4 h-[57px] shrink-0">
          <span className="text-sm font-semibold text-text">会话历史</span>
          <div className="flex items-center gap-1">
            <button onClick={handleNewSession} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors" title="新建会话">
              <Plus className="h-4 w-4" />
            </button>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors lg:hidden">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SessionList
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={handleSelectSession}
            onDelete={handleDeleteSession}
          />
        </div>
      </aside>

      {/* ── Main Chat Area ── */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0 bg-white">
        {/* Chat Header */}
        <header className="shrink-0 flex items-center gap-3 h-[57px] px-4 border-b border-divider bg-white">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
            title="会话列表"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex-1 min-w-0 text-center">
            {activeTitle && (
              <span className="text-sm font-medium text-text truncate block">{activeTitle}</span>
            )}
          </div>

          {stream.loading && (
            <span className="text-xs text-accent animate-pulse shrink-0">生成中...</span>
          )}

          <button
            onClick={handleToggleSources}
            className={`p-1.5 rounded-lg transition-colors shrink-0 ${showSourcePanel ? "text-accent bg-accent-soft" : "text-text-muted hover:text-text hover:bg-surface-hover"}`}
            title={showSourcePanel ? "关闭来源面板" : lastSourcesRef.current ? "打开最近来源" : "路线图"}
          >
            <FileSearch className="h-5 w-5" />
          </button>
        </header>

        {/* Scroll area */}
        <div className="flex-1 overflow-y-auto bg-white chat-scroll-area">
          <div className="max-w-3xl mx-auto px-4">
            {messagesLoading && messages.length === 0 ? (
              <MessagesSkeleton />
            ) : (
              <ChatThread
                messages={messages}
                loading={stream.loading}
                streamingContent={stream.content}
                streamError={stream.error}
                streamStopped={stream.stopped}
                selectedSources={selectedSources}
                onSelectSources={setSelectedSources}
                onFollowUp={handleFollowUp}
                onCancelStream={cancelStream}
                onInitialQuestion={handleInitialQuestion}
                onRetry={handleRetry}
                onEditUser={handleEditUser}
                onDeleteMessage={handleDeleteMessage}
                onPreviewSource={setPreviewSource}
                onSourceAnchor={(sources, idx) => { setSelectedSources(sources); setHighlightSourceIdx(idx); }}
                scrollToBottomSignal={scrollToBottomSignal}
              />
            )}
          </div>
        </div>

        {/* Input */}
        <div className="shrink-0 bg-white">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <ChatInput
              onSend={handleSend}
              loading={stream.loading}
              inputRef={inputRef}
              draftValue={activeSessionId ? getDraft(activeSessionId) : ""}
              onDraftChange={handleDraftChange}
            />
          </div>
        </div>
      </div>

      {/* ── Source Panel (320px) ── */}
      <aside
        className="shrink-0 overflow-hidden transition-all duration-slow ease-out border-l border-divider bg-surface"
        style={{
          width: showSourcePanel ? 320 : 0,
          opacity: showSourcePanel ? 1 : 0,
        }}
      >
        <div style={{ width: 320 }}>
          {showSourcePanel && (
            <SourcePanel
              sources={selectedSources!}
              onClose={() => { setSelectedSources(null); setHighlightSourceIdx(null); }}
              onFollowUp={handleFollowUp}
              onPreview={setPreviewSource}
              highlightIdx={highlightSourceIdx}
              onHighlightDone={() => setHighlightSourceIdx(null)}
            />
          )}
        </div>
      </aside>

      {/* ── Doc Preview Overlay (384px) ── */}
      {previewSource && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setPreviewSource(null)} />
          <aside className="fixed right-0 top-0 bottom-0 w-[384px] max-w-[90vw] bg-surface shadow-xl-soft z-50 animate-fade-in-right border-l border-divider overflow-hidden">
            <DocPreview
              source={previewSource}
              onClose={() => setPreviewSource(null)}
              onAskAbout={(src) => {
                setPreviewSource(null);
                handleFollowUp(`请详细解释《${src.document_title}》中"${src.section_path}"的相关内容`);
              }}
            />
          </aside>
        </>
      )}
    </div>
  );
}
