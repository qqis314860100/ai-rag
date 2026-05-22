import { useState, useEffect, useCallback } from "react";
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

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSources, setSelectedSources] = useState<Source[] | null>(null);
  const [previewSource, setPreviewSource] = useState<Source | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { stream, sendStream, cancelStream, isSending } = useStreamChat();

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    try {
      const res = await api.get<{ data: { items: ChatSession[] } }>("/chat/sessions");
      setSessions(res.data.items || []);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    track("page_view", "page", "chat");
    loadSessions().then(() => {
      api.get<{ data: { items: ChatSession[] } }>("/chat/sessions").then((res) => {
        const items = res.data.items || [];
        if (items.length > 0 && !activeSessionId) setActiveSessionId(items[0].id);
      }).catch(() => {});
    });
  }, []); // only on mount

  // Load messages when session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    api
      .get<{ data: { messages: ChatMessage[] } }>(`/chat/sessions/${activeSessionId}`)
      .then((res) => setMessages(res.data.messages || []))
      .catch(() => setMessages([]));
  }, [activeSessionId]);

  // When stream completes, reload messages and sessions
  useEffect(() => {
    if (!stream.loading && stream.messageId && activeSessionId) {
      api
        .get<{ data: { messages: ChatMessage[] } }>(`/chat/sessions/${activeSessionId}`)
        .then((res) => {
          setMessages(res.data.messages || []);
        })
        .catch(() => {});
      loadSessions();
    }
  }, [stream.loading, stream.messageId]);

  const handleNewSession = useCallback(async () => {
    setActiveSessionId(null);
    setMessages([]);
    setSelectedSources(null);
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setSelectedSources(null);
  }, []);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/chat/sessions/${id}`);
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setMessages([]);
        }
        loadSessions();
      } catch {
        // silently fail
      }
    },
    [activeSessionId, loadSessions]
  );

  const handleSend = useCallback(
    async (message: string) => {
      if (!message.trim() || isSending) return;

      // Get or create session
      let sid = activeSessionId;
      if (!sid) {
        try {
          const res = await api.post<{ data: { id: string; title: string } }>("/chat/sessions", {
            title: message.substring(0, 50),
          });
          sid = res.data.id;
          setActiveSessionId(sid);
          loadSessions();
        } catch {
          showToast("error", "创建会话失败，请检查网络连接");
          return;
        }
      }

      // Add optimistic user message
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        session_id: sid,
        role: "user",
        content: message,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setSelectedSources(null);

      // Send with streaming — sendStream internally checks sendingRef too
      await sendStream(sid, message, 5);
    },
    [activeSessionId, sendStream, loadSessions, isSending]
  );

  const handleFollowUp = useCallback(
    (query: string) => {
      if (isSending) return;
      handleSend(query);
    },
    [handleSend, isSending]
  );

  const handleInitialQuestion = useCallback(
    (query: string) => {
      if (isSending) return;
      handleSend(query);
    },
    [handleSend, isSending]
  );

  const handleRetry = useCallback(() => {
    // Find the last user message and resend it
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    // Remove the failed streaming content from the stream state
    // and resend the user message
    handleSend(lastUserMsg.content);
  }, [messages, handleSend]);

  const handleEditUser = useCallback(
    (messageId: string, newContent: string) => {
      if (!newContent.trim() || isSending) return;
      // Remove this user message and all subsequent assistant messages
      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      setMessages((prev) => prev.slice(0, idx));
      // Send the edited message (this will create a new user message)
      handleSend(newContent.trim());
    },
    [messages, handleSend, isSending]
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Session sidebar — smooth width transition */}
      <div
        className="shrink-0 border-r border-divider bg-surface-page overflow-hidden transition-all duration-slow ease-out"
        style={{ width: sidebarOpen ? 240 : 0, opacity: sidebarOpen ? 1 : 0 }}
      >
        <div style={{ width: 240 }}>
          <SessionList
            sessions={sessions}
            activeId={activeSessionId}
            onSelect={handleSelectSession}
            onNew={handleNewSession}
            onDelete={handleDeleteSession}
          />
        </div>
      </div>

      {/* Main chat area — centered */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0 max-w-3xl mx-auto w-full">
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-divider bg-surface-page">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="min-w-[36px] min-h-[36px] p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-all duration-fast text-xs flex items-center justify-center"
            title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
            aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
          >
            {sidebarOpen ? "◁" : "▷"}
          </button>
          {activeSessionId && (
            <span className="text-xs text-text-muted truncate animate-fade-in">
              {sessions.find((s) => s.id === activeSessionId)?.title || "会话"}
            </span>
          )}
          {stream.loading && (
            <span className="ml-auto text-xs text-accent animate-pulse">生成中...</span>
          )}
        </div>

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
          onPreviewSource={setPreviewSource}
        />

        <div className="shrink-0 border-t border-divider bg-surface-page px-4 py-3">
          <ChatInput onSend={handleSend} loading={stream.loading} />
        </div>
      </div>

      {/* Source panel — slide-in from right */}
      <div
        className="shrink-0 overflow-hidden transition-all duration-slow ease-out"
        style={{ width: selectedSources && selectedSources.length > 0 ? 320 : 0, opacity: selectedSources && selectedSources.length > 0 ? 1 : 0 }}
      >
        <div style={{ width: 320 }}>
          {selectedSources && selectedSources.length > 0 && (
            <SourcePanel
              sources={selectedSources}
              onClose={() => setSelectedSources(null)}
              onFollowUp={handleFollowUp}
              onPreview={setPreviewSource}
            />
          )}
        </div>
      </div>

      {/* Document Preview Panel */}
      <div className="shrink-0 overflow-hidden transition-all duration-slow ease-out" style={{ width: previewSource ? 384 : 0, opacity: previewSource ? 1 : 0 }}>
        <div style={{ width: 384 }}>
          {previewSource && <DocPreview source={previewSource} onClose={() => setPreviewSource(null)} />}
        </div>
      </div>
    </div>
  );
}
