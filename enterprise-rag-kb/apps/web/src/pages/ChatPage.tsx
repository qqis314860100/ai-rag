import { useState, useEffect, useCallback, useRef } from "react";
import ChatThread from "../components/chat/ChatThread";
import { SessionList } from "../components/chat/SessionList";
import ChatInput from "../components/chat/ChatInput";
import SourcePanel from "../components/chat/SourcePanel";
import DocPreview from "../components/chat/DocPreview";
import { useStreamChat } from "../hooks/useStreamChat";
import { api } from "../services/api";
import { showToast } from "../components/ui/Toast";
import { track } from "../services/tracking";
import type { ChatMessage, ChatSession, Source } from "../types";
import { Menu, X, Plus, FileSearch } from "lucide-react";

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSources, setSelectedSources] = useState<Source[] | null>(null);
  const [previewSource, setPreviewSource] = useState<Source | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftsRef = useRef<Map<string, string>>(new Map());

  const { stream, sendStream, cancelStream, isSending } = useStreamChat();

  // Close sidebar on outside click (mobile overlay) + lock body scroll
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "TEXTAREA" || target.tagName === "INPUT";
      // ESC: cancel stream or close panels
      if (e.key === "Escape") {
        if (isSending) cancelStream();
        else if (previewSource) setPreviewSource(null);
        else if (selectedSources) setSelectedSources(null);
        return;
      }
      // / : focus input (only when not already in input)
      if (e.key === "/" && !isInput) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isSending, cancelStream, previewSource, selectedSources]);

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    try {
      const res = await api.get<{ data: { items: ChatSession[] } }>("/chat/sessions");
      setSessions(res.data.items || []);
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => {
    track("page_view", "page", "chat");
    loadSessions().then(() => {
      api.get<{ data: { items: ChatSession[] } }>("/chat/sessions").then((res) => {
        const items = res.data.items || [];
        if (items.length > 0 && !activeSessionId) setActiveSessionId(items[0].id);
      }).catch(() => {});
    });
  }, []);

  // Load messages when session changes
  useEffect(() => {
    if (!activeSessionId) { setMessages([]); return; }
    api.get<{ data: { messages: ChatMessage[] } }>(`/chat/sessions/${activeSessionId}`)
      .then((res) => setMessages(res.data.messages || []))
      .catch(() => setMessages([]));
  }, [activeSessionId]);

  const placeholderIdRef = useRef<string | null>(null);

  // Update streaming placeholder content
  useEffect(() => {
    if (stream.loading && placeholderIdRef.current && stream.content) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderIdRef.current
            ? { ...m, content: stream.content }
            : m
        )
      );
    }
  }, [stream.content]);

  // When stream completes, finalize the placeholder with sources/confidence/followups
  useEffect(() => {
    if (!stream.loading && placeholderIdRef.current && stream.messageId) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderIdRef.current
            ? {
                ...m,
                id: stream.messageId,
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
      placeholderIdRef.current = null;
      loadSessions();
    }
  }, [stream.loading, stream.messageId]);

  // Clean up orphaned placeholder on error/abort (no messageId)
  useEffect(() => {
    if (!stream.loading && !stream.messageId && placeholderIdRef.current) {
      setMessages((prev) => prev.filter((m) => m.id !== placeholderIdRef.current));
      placeholderIdRef.current = null;
    }
  }, [stream.loading]);

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setSelectedSources(null);
    setSidebarOpen(false);
    // Draft will be cleared since input resets when messages change
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    // Save current draft before switching
    const currentInput = inputRef.current?.value;
    if (activeSessionId && currentInput) {
      draftsRef.current.set(activeSessionId, currentInput);
    }
    setActiveSessionId(id);
    setSelectedSources(null);
    setSidebarOpen(false);
    // Restore draft for target session
    const saved = draftsRef.current.get(id);
    if (saved) {
      if (inputRef.current) inputRef.current.value = saved;
    }
  }, [activeSessionId]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await api.delete(`/chat/sessions/${id}`);
      if (activeSessionId === id) { setActiveSessionId(null); setMessages([]); }
      loadSessions();
    } catch { /* silently fail */ }
  }, [activeSessionId, loadSessions]);

  const handleSend = useCallback(async (message: string) => {
    if (!message.trim() || isSending) return;
    let sid = activeSessionId;
    if (!sid) {
      try {
        const res = await api.post<{ data: { id: string; title: string } }>("/chat/sessions", { title: message.substring(0, 50) });
        sid = res.data.id;
        setActiveSessionId(sid);
        loadSessions();
      } catch {
        showToast("error", "创建会话失败，请检查网络连接");
        return;
      }
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
    setSelectedSources(null);
    await sendStream(sid, message, 5);
  }, [activeSessionId, sendStream, loadSessions, isSending]);

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
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    showToast("success", "消息已删除");
  }, []);

  const activeTitle = activeSessionId
    ? (sessions.find((s) => s.id === activeSessionId)?.title || "会话")
    : "";

  const showSourcePanel = selectedSources && selectedSources.length > 0;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Session Sidebar (260px) ── */}
      {/* Mobile: overlay with backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        ref={sidebarRef}
        className={`shrink-0 border-r border-divider bg-surface-page flex flex-col transition-all duration-slow ease-out z-40
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
            onNew={handleNewSession}
            onDelete={handleDeleteSession}
          />
        </div>
      </aside>

      {/* ── Main Chat Area — Sitor layout: scroll full-width, content centered ── */}
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
            onClick={() => setRoadmapOpen(!roadmapOpen)}
            className={`p-1.5 rounded-lg transition-colors shrink-0 ${showSourcePanel ? "text-accent bg-accent-soft" : "text-text-muted hover:text-text hover:bg-surface-hover"}`}
            title={showSourcePanel ? "引用来源" : "路线图"}
          >
            <FileSearch className="h-5 w-5" />
          </button>
        </header>

        {/* Scroll area: full-width white bg, scrollbar inside */}
        <div className="flex-1 overflow-y-auto bg-white chat-scroll-area">
          <div className="max-w-3xl mx-auto px-4">
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
            />
          </div>
        </div>

        {/* Input: centered, sticky bottom, white bg */}
        <div className="shrink-0 bg-white">
          <div className="max-w-3xl mx-auto px-4 py-3">
            <ChatInput onSend={handleSend} loading={stream.loading} inputRef={inputRef} draftValue={activeSessionId ? (draftsRef.current.get(activeSessionId) || "") : ""} onDraftChange={(val) => { if (activeSessionId) draftsRef.current.set(activeSessionId, val); }} />
          </div>
        </div>
      </div>

      {/* ── Source Panel (320px, Sitor roadmap style) ── */}
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
              onClose={() => setSelectedSources(null)}
              onFollowUp={handleFollowUp}
              onPreview={setPreviewSource}
            />
          )}
        </div>
      </aside>

      {/* ── Doc Preview Panel (384px) ── */}
      <aside
        className="shrink-0 overflow-hidden transition-all duration-slow ease-out border-l border-divider bg-surface"
        style={{
          width: previewSource ? 384 : 0,
          opacity: previewSource ? 1 : 0,
        }}
      >
        <div style={{ width: 384 }}>
          {previewSource && <DocPreview source={previewSource} onClose={() => setPreviewSource(null)} />}
        </div>
      </aside>
    </div>
  );
}
