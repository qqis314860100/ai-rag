import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../../services/api";
import { showToast } from "../../../components/ui/Toast";
import type { ChatMessage, ChatSession } from "../types";

interface SessionListResponse {
  data: {
    items: ChatSession[];
  };
}

interface SessionDetailResponse {
  data?: {
    messages?: ChatMessage[];
  };
}

interface LoadMessagesOptions {
  silent?: boolean;
  merge?: boolean;
}

function isTemporaryPersistedId(id?: string) {
  return !id || id.startsWith("user-") || id.startsWith("stream-") || id.startsWith("interrupted-") || id.startsWith("pending-");
}

function mergePersistedMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  if (current.length === 0) return incoming;

  const used = new Set<number>();

  const merged = current.map((message) => {
    const persistedId = isTemporaryPersistedId(message.persistedId) ? undefined : message.persistedId;
    const exactIndex = incoming.findIndex((candidate, index) => {
      if (used.has(index)) return false;
      return candidate.id === message.id || (!!persistedId && candidate.id === persistedId);
    });
    const contentIndex = exactIndex >= 0
      ? exactIndex
      : incoming.findIndex((candidate, index) => {
          if (used.has(index)) return false;
          return candidate.role === message.role && candidate.content.trim() === message.content.trim();
        });

    if (contentIndex < 0) return message;

    used.add(contentIndex);
    const persistedMessage = incoming[contentIndex];
    return {
      ...persistedMessage,
      id: message.id,
      persistedId: persistedMessage.id,
      streaming: false,
    };
  });

  const remaining = incoming.filter((_, index) => !used.has(index));
  return remaining.length > 0 ? [...merged, ...remaining] : merged;
}

export function useChatHistory(initialSessionId?: string | null) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const initialSessionIdRef = useRef(initialSessionId || null);
  const sessionsLoadingRef = useRef(false);
  const messagesAbortRef = useRef<AbortController | null>(null);
  const optimisticSessionIdsRef = useRef(new Set<string>());

  // ── Load sessions ──
  const loadSessions = useCallback(async () => {
    if (sessionsLoadingRef.current) return;
    sessionsLoadingRef.current = true;
    try {
      const res = await api.get<SessionListResponse>("/chat/sessions");
      setSessions(res.data.items || []);
      return res.data.items || [];
    } catch {
      showToast("error", "加载会话列表失败");
      return [];
    } finally {
      sessionsLoadingRef.current = false;
    }
  }, []);

  // ── Load messages for active session (with AbortController for race conditions) ──
  const loadMessages = useCallback(async (sessionId: string, options: LoadMessagesOptions = {}) => {
    // Cancel any in-flight message request
    messagesAbortRef.current?.abort();
    messagesAbortRef.current = new AbortController();

    if (!options.silent) {
      setMessagesLoading(true);
    }
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        headers: {
          "Content-Type": "application/json",
          ...(localStorage.getItem("kb_token") ? { Authorization: `Bearer ${localStorage.getItem("kb_token")}` } : {}),
        },
        signal: messagesAbortRef.current.signal,
      });
      if (!res.ok) throw new Error("Failed");
      const data: SessionDetailResponse = await res.json();
      const nextMessages = data.data?.messages || [];
      setMessages((prev) => options.merge ? mergePersistedMessages(prev, nextMessages) : nextMessages);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (!options.silent) {
        setMessages([]);
      }
    } finally {
      if (!options.silent) {
        setMessagesLoading(false);
      }
    }
  }, []);

  // ── Init: load sessions, auto-select first ──
  useEffect(() => {
    loadSessions().then((items = []) => {
      if (items.length === 0 || activeSessionId) return;

      const initialSessionId = initialSessionIdRef.current;
      if (initialSessionId && items.some((item) => item.id === initialSessionId)) {
        setActiveSessionId(initialSessionId);
        return;
      }

      setActiveSessionId(items[0].id);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load messages when active session changes ──
  useEffect(() => {
    if (!activeSessionId) {
      messagesAbortRef.current?.abort();
      setMessages([]);
      setMessagesLoading(false);
      return;
    }
    if (optimisticSessionIdsRef.current.has(activeSessionId)) {
      optimisticSessionIdsRef.current.delete(activeSessionId);
      return;
    }
    loadMessages(activeSessionId);
  }, [activeSessionId, loadMessages]);

  useEffect(() => {
    return () => {
      messagesAbortRef.current?.abort();
    };
  }, []);

  // ── CRUD helpers ──
  const createSession = useCallback(async (title: string): Promise<ChatSession | null> => {
    try {
      const res = await api.post<{ data: { id: string; title: string } }>("/chat/sessions", { title: title.substring(0, 50) });
      const newSession = { id: res.data.id, title: res.data.title, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      setSessions(prev => [newSession, ...prev]);
      return newSession;
    } catch {
      showToast("error", "创建会话失败，请检查网络连接");
      return null;
    }
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    try {
      await api.delete(`/chat/sessions/${id}`);
      setSessions(prev => prev.filter(s => s.id !== id));
      return true;
    } catch { return false; }
  }, []);

  const markSessionOptimistic = useCallback((id: string) => {
    optimisticSessionIdsRef.current.add(id);
  }, []);

  return {
    sessions,
    activeSessionId,
    messages,
    messagesLoading,
    setActiveSessionId,
    setMessages,
    loadSessions,
    loadMessages,
    markSessionOptimistic,
    createSession,
    deleteSession,
  };
}
