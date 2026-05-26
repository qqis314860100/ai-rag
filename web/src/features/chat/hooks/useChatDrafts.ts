import { useRef, useEffect, useCallback } from "react";

export function useChatDrafts() {
  const draftsRef = useRef<Map<string, string>>(new Map());

  // Load drafts from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("chat-drafts");
      if (raw) draftsRef.current = new Map(JSON.parse(raw));
    } catch { /* corrupted data, use empty map */ }
  }, []);

  const persist = useCallback(() => {
    try {
      localStorage.setItem("chat-drafts", JSON.stringify([...draftsRef.current]));
    } catch { /* quota exceeded, ignore */ }
  }, []);

  const saveDraft = useCallback((sessionId: string, content: string) => {
    if (!content.trim()) {
      draftsRef.current.delete(sessionId);
      persist();
      return;
    }

    draftsRef.current.set(sessionId, content);
    persist();
  }, [persist]);

  const getDraft = useCallback((sessionId: string): string => {
    return draftsRef.current.get(sessionId) || "";
  }, []);

  const removeDraft = useCallback((sessionId: string) => {
    draftsRef.current.delete(sessionId);
    persist();
  }, [persist]);

  return { saveDraft, getDraft, removeDraft };
}
