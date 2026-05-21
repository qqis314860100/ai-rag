import { useState, useCallback, useRef } from "react";
import { sseStream } from "../services/api";
import type { Source } from "../types";

export interface StreamState {
  loading: boolean;
  content: string;
  sources: Source[];
  confidence: number;
  followups: string[];
  messageId: string;
}

const TICK_MS = 50;       // typewriter tick interval
const CHARS_PER_TICK = 1;  // characters revealed per tick (~20 chars/sec, clearly visible)

export function useStreamChat() {
  const [stream, setStream] = useState<StreamState>({
    loading: false,
    content: "",
    sources: [],
    confidence: 0,
    followups: [],
    messageId: "",
  });
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fullRef = useRef("");              // all received tokens
  const doneRef = useRef(false);            // stream done?
  const metaRef = useRef<{ sources?: Source[]; confidence?: number; followups?: string[] }>({});
  const savedRef = useRef<{ message_id?: string }>({});

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const sendStream = useCallback(
    async (sessionId: string, message: string, topK: number) => {
      abortRef.current?.abort();
      stopTimer();

      fullRef.current = "";
      doneRef.current = false;
      metaRef.current = {};
      savedRef.current = {};

      setStream({ loading: true, content: "", sources: [], confidence: 0, followups: [], messageId: "" });

      // Typewriter timer: independently drives the displayed content
      timerRef.current = setInterval(() => {
        const full = fullRef.current;
        const done = doneRef.current;

        setStream((prev) => {
          const shown = prev.content.length;

          // All content revealed and stream is done → finalize
          if (done && shown >= full.length) {
            stopTimer();
            return {
              ...prev,
              loading: false,
              content: full,
              sources: metaRef.current.sources || [],
              confidence: metaRef.current.confidence || 0,
              followups: metaRef.current.followups || [],
              messageId: savedRef.current.message_id || "",
            };
          }

          // Still revealing
          if (shown < full.length) {
            const next = Math.min(shown + CHARS_PER_TICK, full.length);
            return { ...prev, content: full.slice(0, next) };
          }

          // Waiting for more tokens
          return prev;
        });
      }, TICK_MS);

      // Fetch SSE stream
      try {
        const reader = await sseStream("/chat", {
          session_id: sessionId, message, top_k: topK, stream: true,
        });

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
              if (abortRef.current?.signal.aborted) return;

              switch (parsed.type) {
                case "token":
                  fullRef.current += parsed.content;
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
            } catch { /* skip */ }
          }
        }

        // Mark stream as done — timer will finalize when caught up
        doneRef.current = true;

      } catch (err) {
        stopTimer();
        if (!abortRef.current?.signal.aborted) {
          setStream((prev) => ({
            ...prev,
            loading: false,
            content: prev.content || "请求失败，请重试。",
          }));
        }
      }
    },
    [stopTimer]
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    stopTimer();
    setStream((prev) => ({ ...prev, loading: false }));
  }, [stopTimer]);

  return { stream, sendStream, cancelStream };
}
