import { useCallback, useEffect, useRef, useState } from "react";

type UseChatThreadScrollOptions = {
  loading: boolean;
  streamingContent: string;
  scrollToBottomSignal: number;
};

export function useChatThreadScroll({ loading, streamingContent, scrollToBottomSignal }: UseChatThreadScrollOptions) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevContentLen = useRef(0);
  const scrollRaf = useRef<number>(0);
  const wasLoading = useRef(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const nearBottom = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  useEffect(() => {
    const el = bottomRef.current?.closest(".chat-scroll-area") as HTMLElement | null;
    if (!el) return;
    containerRef.current = el;

    const handleScroll = () => {
      const threshold = 80;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      nearBottom.current = distFromBottom <= threshold;
      setShowScrollBtn(!nearBottom.current);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const c = containerRef.current;
    if (c) {
      c.scrollTo({ top: c.scrollHeight, behavior });
      nearBottom.current = true;
      setShowScrollBtn(false);
      return;
    }

    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  }, []);

  useEffect(() => {
    if (!scrollToBottomSignal) return;

    let raf = 0;
    const timer = window.setTimeout(() => scrollToBottom("auto"), 180);
    raf = requestAnimationFrame(() => {
      scrollToBottom("smooth");
    });

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [scrollToBottom, scrollToBottomSignal]);

  useEffect(() => {
    if (loading) {
      wasLoading.current = true;
      if (streamingContent.length > prevContentLen.current && !scrollRaf.current) {
        scrollRaf.current = requestAnimationFrame(() => {
          if (nearBottom.current) {
            scrollToBottom();
          }
          scrollRaf.current = 0;
        });
      }
    } else if (wasLoading.current) {
      wasLoading.current = false;
      if (nearBottom.current) {
        // 等一次 layout 后再追加滚动，避免消息定稿写回时出现轻微跳动。
        requestAnimationFrame(() => {
          requestAnimationFrame(() => scrollToBottom("auto"));
        });
      }
    }
    prevContentLen.current = streamingContent.length;
    return () => {
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    };
  }, [streamingContent, loading, scrollToBottom]);

  return {
    bottomRef,
    showScrollBtn,
    scrollToBottom,
  };
}
