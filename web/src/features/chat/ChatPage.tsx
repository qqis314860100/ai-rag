import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ChatThread from "./components/ChatThread";
import ChatInput from "./components/ChatInput";
import ConversationNavigator from "./components/ConversationNavigator";
import ChatHeader from "./components/ChatHeader";
import ChatHistorySidebar from "./components/ChatHistorySidebar";
import DocPreviewDrawer from "./components/DocPreviewDrawer";
import { useChatHistory } from "./hooks/useChatHistory";
import { useChatDrafts } from "./hooks/useChatDrafts";
import { useAssetDraftStatus } from "./hooks/useAssetDraftStatus";
import { useSessionNotes } from "./hooks/useSessionNotes";
import { useChatScrollMemory } from "./hooks/useChatScrollMemory";
import { useChatMessageFlow } from "./hooks/useChatMessageFlow";
import { track } from "../../services/tracking";
import type { Source } from "./types";

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
    loadMessages,
    markSessionOptimistic,
    createSession,
    deleteSession,
  } = useChatHistory(urlSessionId);

  const { saveDraft, getDraft, removeDraft } = useChatDrafts();
  const [selectedSources, setSelectedSources] = useState<Source[] | null>(null);
  const [previewSource, setPreviewSource] = useState<Source | null>(null);
  const [highlightSourceIdx, setHighlightSourceIdx] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 1536px)").matches
  );
  const [compactRightPanel, setCompactRightPanel] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 639px)").matches
  );
  const [historyCollapsed, setHistoryCollapsed] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    scrollContainerRef,
    activeSessionIdRef,
    saveScrollPosition,
    removeScrollPosition,
  } = useChatScrollMemory({
    activeSessionId,
    messagesLength: messages.length,
    messagesLoading,
  });

  const {
    stream,
    cancelStream,
    isSending,
    scrollToBottomSignal,
    handleSend,
    handleFollowUp,
    handleInitialQuestion,
    handleEditUser,
    handleRetry,
    handleDeleteMessage,
  } = useChatMessageFlow({
    activeSessionId,
    activeSessionIdRef,
    messages,
    setMessages,
    setActiveSessionId,
    createSession,
    markSessionOptimistic,
    loadMessages,
    removeDraft,
    setSelectedSources,
  });
  const {
    sessionNotes,
    noteAggregateItems,
    sessionNotesLoading,
    createNote: handleCreateNote,
    updateNote: handleUpdateNote,
    deleteNote: handleDeleteNote,
  } = useSessionNotes(activeSessionId);
  const {
    assetDraftStatusByMessage,
    createKnowledgeAssetDraft: handleCreateKnowledgeAssetDraft,
  } = useAssetDraftStatus(messages);

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
      // ESC: priority — DocPreview → evidence detail → cancel stream
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
      setRightPanelOpen(true);
    }
  }, [selectedSources]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1536px)");
    const syncRightPanel = () => {
      if (!media.matches) setRightPanelOpen(false);
    };
    syncRightPanel();
    media.addEventListener("change", syncRightPanel);
    return () => media.removeEventListener("change", syncRightPanel);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const syncCompactPanel = () => setCompactRightPanel(media.matches);
    syncCompactPanel();
    media.addEventListener("change", syncCompactPanel);
    return () => media.removeEventListener("change", syncCompactPanel);
  }, []);

  // ── Session actions ──
  const handleNewSession = useCallback(() => {
    saveScrollPosition();
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
  }, [activeSessionId, cancelStream, isSending, navigate, saveDraft, saveScrollPosition, setActiveSessionId, setMessages]);

  const handleToggleRightPanel = useCallback(() => {
    setRightPanelOpen((open) => !open);
  }, []);

  const handleInspectSources = useCallback((sources: Source[], index = 0) => {
    setSelectedSources(sources);
    setHighlightSourceIdx(index);
    setRightPanelOpen(true);
  }, []);

  const handleToggleHistory = useCallback(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setHistoryCollapsed((collapsed) => !collapsed);
      return;
    }

    setSidebarOpen((open) => !open);
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    if (id === activeSessionId) {
      setSidebarOpen(false);
      return;
    }
    saveScrollPosition();
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
  }, [activeSessionId, setActiveSessionId, saveDraft, saveScrollPosition, cancelStream, isSending, navigate]);

  const handleDeleteSession = useCallback(async (id: string) => {
    if (!window.confirm("确认删除该会话？会话内的全部消息将不可恢复。")) return;
    const ok = await deleteSession(id);
    if (ok) {
      if (activeSessionId === id) { setActiveSessionId(null); setMessages([]); }
      removeDraft(id);
      removeScrollPosition(id);
    }
  }, [activeSessionId, deleteSession, removeDraft, removeScrollPosition, setActiveSessionId, setMessages]);

  // ── Auto-save draft on input change ──
  const handleDraftChange = useCallback((val: string) => {
    if (activeSessionId) {
      saveDraft(activeSessionId, val);
    }
  }, [activeSessionId, saveDraft]);

  const activeTitle = activeSessionId
    ? (sessions.find((s) => s.id === activeSessionId)?.title || "会话")
    : "";

  const hasSelectedSources = !!(selectedSources && selectedSources.length > 0);
  // 主聊天区固定 max-width，不再随 history 折叠在 max-w-3xl↔max-w-6xl 之间跳变；
  // 右侧栏宽度变化期间，markdown 容器宽度保持稳定，避免长答案重排。
  const chatContentClass = "w-full mx-auto px-4 max-w-3xl";

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <ChatHistorySidebar
        open={sidebarOpen}
        collapsed={historyCollapsed}
        sidebarRef={sidebarRef}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onClose={() => setSidebarOpen(false)}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
      />

      {/* ── Main Chat Area ── */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0 bg-white">
        <ChatHeader
          activeTitle={activeTitle}
          streamLoading={stream.loading}
          historyCollapsed={historyCollapsed}
          rightPanelOpen={rightPanelOpen}
          onToggleHistory={handleToggleHistory}
          onToggleRightPanel={handleToggleRightPanel}
        />

        {/* Scroll area */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto bg-white chat-scroll-area">
          <div className={chatContentClass}>
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
                onSelectSources={(sources) => {
                  setSelectedSources(sources);
                  if (sources && sources.length > 0) {
                    setRightPanelOpen(true);
                  }
                }}
                onFollowUp={handleFollowUp}
                onCancelStream={cancelStream}
                onInitialQuestion={handleInitialQuestion}
                onRetry={handleRetry}
                onEditUser={handleEditUser}
                onDeleteMessage={handleDeleteMessage}
                onSourceAnchor={handleInspectSources}
                assetDraftStatusByMessage={assetDraftStatusByMessage}
                onCreateKnowledgeAssetDraft={handleCreateKnowledgeAssetDraft}
                scrollToBottomSignal={scrollToBottomSignal}
              />
            )}
          </div>
        </div>

        {/* Input */}
        <div className="shrink-0 bg-white">
          <div className={`${chatContentClass} py-3`}>
            <ChatInput
              onSend={handleSend}
              onCancel={cancelStream}
              loading={stream.loading}
              inputRef={inputRef}
              draftValue={activeSessionId ? getDraft(activeSessionId) : ""}
              onDraftChange={handleDraftChange}
            />
          </div>
        </div>
      </div>

      {/* ── Conversation Navigator (336px) ── */}
      {rightPanelOpen && (
        <div className="fixed inset-0 z-40 bg-black/20 2xl:hidden" onClick={() => setRightPanelOpen(false)} />
      )}
      <aside
        className={`shrink-0 overflow-hidden border-l bg-surface transition-all duration-slow ease-out
          max-2xl:fixed max-2xl:inset-y-0 max-2xl:right-0 max-2xl:z-50 max-2xl:shadow-xl-soft max-sm:left-0
          ${hasSelectedSources ? "border-accent/25" : "border-divider"}`}
        style={{
          width: rightPanelOpen ? (compactRightPanel ? "100vw" : "min(100vw, 336px)") : 0,
          opacity: rightPanelOpen ? 1 : 0,
          pointerEvents: rightPanelOpen ? "auto" : "none",
        }}
      >
        <div className="h-full min-h-0 w-full 2xl:w-[336px]">
          {rightPanelOpen && (
            <ConversationNavigator
              messages={messages}
              activeTitle={activeTitle}
              selectedSources={selectedSources}
              highlightSourceIdx={highlightSourceIdx}
              notes={sessionNotes}
              noteAggregateItems={noteAggregateItems}
              notesLoading={sessionNotesLoading}
              notesWritable={!!activeSessionId}
              onClose={() => setRightPanelOpen(false)}
              onClearSources={() => { setSelectedSources(null); setHighlightSourceIdx(null); }}
              onFollowUp={handleFollowUp}
              onPreviewSource={setPreviewSource}
              onInspectSources={handleInspectSources}
              onHighlightDone={() => setHighlightSourceIdx(null)}
              onCreateNote={handleCreateNote}
              onUpdateNote={handleUpdateNote}
              onDeleteNote={handleDeleteNote}
              assetDraftStatusByMessage={assetDraftStatusByMessage}
              onCreateKnowledgeAssetDraft={handleCreateKnowledgeAssetDraft}
            />
          )}
        </div>
      </aside>

      {/* ── Doc Preview Overlay (384px) ── */}
      {previewSource && (
        <DocPreviewDrawer
          source={previewSource}
          onClose={() => setPreviewSource(null)}
          onAskAbout={(source) => {
            setPreviewSource(null);
            handleFollowUp(`请详细解释《${source.document_title}》中"${source.section_path}"的相关内容`);
          }}
        />
      )}
    </div>
  );
}
