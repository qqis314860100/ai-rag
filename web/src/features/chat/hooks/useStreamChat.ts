import { useState, useCallback, useRef } from "react";
import { sseStream } from "../../../services/api";
import type { Source } from "../types";

export interface StreamState {
  loading: boolean;
  content: string;
  sources: Source[];
  confidence: number;
  followups: string[];
  messageId: string;
  error: string | null;
  stopped: boolean;
}

const INITIAL_STATE: StreamState = {
  loading: false,
  content: "",
  sources: [],
  confidence: 0,
  followups: [],
  messageId: "",
  error: null,
  stopped: false,
};

export function useStreamChat() {
  const [stream, setStream] = useState<StreamState>(INITIAL_STATE);

  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const runIdRef = useRef(0);

  // 缓冲：token 累积到 ref，rAF 内统一 setState，避免每个 token 都触发 reconcile
  const bufferRef = useRef("");
  const flushScheduledRef = useRef(false);
  const metaRef = useRef<{ sources?: Source[]; confidence?: number; followups?: string[] }>({});
  const savedRef = useRef<{ message_id?: string }>({});

  const scheduleFlush = useCallback((runId: number) => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    requestAnimationFrame(() => {
      flushScheduledRef.current = false;
      if (runIdRef.current !== runId) return;
      const content = bufferRef.current;
      setStream((prev) => (prev.content === content ? prev : { ...prev, content }));
    });
  }, []);

  const sendStream = useCallback(
    async (sessionId: string, message: string, topK: number) => {
      if (sendingRef.current) return;
      sendingRef.current = true;

      abortRef.current?.abort();
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      const controller = new AbortController();
      abortRef.current = controller;

      bufferRef.current = "";
      flushScheduledRef.current = false;
      metaRef.current = {};
      savedRef.current = {};

      setStream({ ...INITIAL_STATE, loading: true });

      try {
        const reader = await sseStream(
          "/chat",
          { session_id: sessionId, message, top_k: topK, stream: true },
          controller.signal
        );

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              if (controller.signal.aborted || runIdRef.current !== runId) return;

              switch (parsed.type) {
                case "token":
                  bufferRef.current += parsed.content;
                  scheduleFlush(runId);
                  break;
                case "done":
                  metaRef.current = {
                    sources: parsed.sources,
                    confidence: parsed.confidence,
                    followups: parsed.followups,
                  };
                  break;
                case "saved":
                  savedRef.current = { message_id: parsed.message_id };
                  break;
              }
            } catch {
              /* skip malformed frame */
            }
          }
        }

        if (runIdRef.current !== runId) return;

        // 流结束：一次性把最终内容 + meta + messageId 合并写入
        sendingRef.current = false;
        setStream({
          loading: false,
          content: bufferRef.current,
          sources: metaRef.current.sources || [],
          confidence: metaRef.current.confidence || 0,
          followups: metaRef.current.followups || [],
          messageId: savedRef.current.message_id || "",
          error: null,
          stopped: false,
        });
      } catch (err) {
        if (runIdRef.current !== runId) return;
        sendingRef.current = false;
        const wasAborted = controller.signal.aborted;
        setStream((prev) => ({
          ...prev,
          content: bufferRef.current,
          loading: false,
          error: wasAborted ? null : err instanceof TypeError ? "网络异常，请检查连接后重试" : "请求失败，请重试",
          stopped: !!wasAborted,
        }));
      }
    },
    [scheduleFlush]
  );

  const cancelStream = useCallback(() => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    sendingRef.current = false;
    setStream((prev) => ({
      ...prev,
      content: bufferRef.current,
      loading: false,
      stopped: true,
      error: null,
    }));
  }, []);

  return {
    stream,
    sendStream,
    cancelStream,
    get isSending() {
      return sendingRef.current;
    },
  };
}
