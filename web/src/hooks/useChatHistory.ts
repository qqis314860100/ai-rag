import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../services/api";
import { showToast } from "../components/ui/Toast";
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

export function useChatHistory(initialSessionId?: string | null) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const initialSessionIdRef = useRef(initialSessionId || null);
  const sessionsLoadingRef = useRef(false);
  const messagesAbortRef = useRef<AbortController | null>(null);

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
  const loadMessages = useCallback(async (sessionId: string) => {
    // Cancel any in-flight message request
    messagesAbortRef.current?.abort();
    messagesAbortRef.current = new AbortController();

    setMessagesLoading(true);
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
      setMessages(data.data?.messages || []);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setMessages([]);
    } finally {
      setMessagesLoading(false);
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

  return {
    sessions,
    activeSessionId,
    messages,
    messagesLoading,
    setActiveSessionId,
    setMessages,
    loadSessions,
    loadMessages,
    createSession,
    deleteSession,
  };
}
