import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const CHAT_SCROLL_STORAGE_KEY = "chat-scroll-positions:v1";
const CHAT_SCROLL_BOTTOM_THRESHOLD = 80;

type ChatScrollSnapshot = {
  top: number;
  distanceFromBottom: number;
  atBottom: boolean;
};

function readChatScrollPositions(): Record<string, ChatScrollSnapshot> {
  try {
    const raw = sessionStorage.getItem(CHAT_SCROLL_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ChatScrollSnapshot>;
  } catch {
    return {};
  }
}

export function useChatScrollMemory(input: {
  activeSessionId: string | null;
  messagesLength: number;
  messagesLoading: boolean;
}) {
  const { activeSessionId, messagesLength, messagesLoading } = input;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  const pendingScrollSessionRef = useRef<string | null>(null);
  const sawLoadingForPendingSessionRef = useRef(false);
  const scrollPositionsRef = useRef<Record<string, ChatScrollSnapshot>>(readChatScrollPositions());

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const persistScrollPositions = useCallback(() => {
    try {
      sessionStorage.setItem(CHAT_SCROLL_STORAGE_KEY, JSON.stringify(scrollPositionsRef.current));
    } catch {
      // 私密模式或容量限制不影响当前挂载周期内的内存恢复。
    }
  }, []);

  const saveScrollPosition = useCallback((sessionId = activeSessionIdRef.current) => {
    const el = scrollContainerRef.current;
    if (!sessionId || !el) return;

    const distanceFromBottom = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    scrollPositionsRef.current[sessionId] = {
      top: el.scrollTop,
      distanceFromBottom,
      atBottom: distanceFromBottom <= CHAT_SCROLL_BOTTOM_THRESHOLD,
    };
    persistScrollPositions();
  }, [persistScrollPositions]);

  const restoreScrollPosition = useCallback((sessionId: string) => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const snapshot = scrollPositionsRef.current[sessionId];
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = !snapshot || snapshot.atBottom ? maxTop : Math.min(snapshot.top, maxTop);
  }, []);

  const removeScrollPosition = useCallback((sessionId: string) => {
    delete scrollPositionsRef.current[sessionId];
    persistScrollPositions();
  }, [persistScrollPositions]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    let raf = 0;
    const handleScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        saveScrollPosition();
        raf = 0;
      });
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      saveScrollPosition();
      el.removeEventListener("scroll", handleScroll);
    };
  }, [saveScrollPosition]);

  useEffect(() => () => saveScrollPosition(), [saveScrollPosition]);

  useEffect(() => {
    if (!activeSessionId) {
      pendingScrollSessionRef.current = null;
      sawLoadingForPendingSessionRef.current = false;
      scrollContainerRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }

    pendingScrollSessionRef.current = activeSessionId;
    sawLoadingForPendingSessionRef.current = false;
  }, [activeSessionId]);

  useLayoutEffect(() => {
    const pendingSession = pendingScrollSessionRef.current;
    if (!pendingSession || activeSessionId !== pendingSession) return;

    if (messagesLoading) {
      sawLoadingForPendingSessionRef.current = true;
      return;
    }

    if (!sawLoadingForPendingSessionRef.current) return;

    let raf1 = 0;
    let raf2 = 0;
    const timer = window.setTimeout(() => restoreScrollPosition(pendingSession), 120);
    raf1 = requestAnimationFrame(() => {
      restoreScrollPosition(pendingSession);
      raf2 = requestAnimationFrame(() => restoreScrollPosition(pendingSession));
    });

    pendingScrollSessionRef.current = null;
    sawLoadingForPendingSessionRef.current = false;

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
  }, [activeSessionId, messagesLength, messagesLoading, restoreScrollPosition]);

  return {
    scrollContainerRef,
    activeSessionIdRef,
    saveScrollPosition,
    removeScrollPosition,
  };
}
