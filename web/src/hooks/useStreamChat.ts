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
  error: string | null;
  stopped: boolean;
}

const TICK_MS = 30;       // typewriter tick interval (~33 fps)
const CHARS_PER_TICK = 4;  // characters revealed per tick (~120 chars/sec, fast but readable)

export function useStreamChat() {
  const [stream, setStream] = useState<StreamState>({
    loading: false,
    content: "",
    sources: [],
    confidence: 0,
    followups: [],
    messageId: "",
    error: null,
    stopped: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendingRef = useRef(false);        // synchronous guard against duplicate sends
  const fullRef = useRef("");              // all received tokens
  const doneRef = useRef(false);            // stream done?
  const metaRef = useRef<{ sources?: Source[]; confidence?: number; followups?: string[] }>({});
  const savedRef = useRef<{ message_id?: string }>({});
  const runIdRef = useRef(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
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
      stopTimer();

      fullRef.current = "";
      doneRef.current = false;
      metaRef.current = {};
      savedRef.current = {};

      setStream({ loading: true, content: "", sources: [], confidence: 0, followups: [], messageId: "", error: null, stopped: false });

      // Typewriter timer: independently drives the displayed content
      timerRef.current = setInterval(() => {
        if (runIdRef.current !== runId) return;

        const full = fullRef.current;
        const done = doneRef.current;

        setStream((prev) => {
          const shown = prev.content.length;

          // All content revealed and stream is done → finalize
          if (done && shown >= full.length) {
            stopTimer();
            sendingRef.current = false;
            return {
              ...prev,
              loading: false,
              content: full,
              sources: metaRef.current.sources || [],
              confidence: metaRef.current.confidence || 0,
              followups: metaRef.current.followups || [],
              messageId: savedRef.current.message_id || "",
              error: null,
              stopped: false,
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
        }, controller.signal);

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
        if (runIdRef.current !== runId) return;
        doneRef.current = true;

      } catch (err) {
        if (runIdRef.current !== runId) return;
        stopTimer();
        sendingRef.current = false;
        const wasAborted = controller.signal.aborted;
        setStream((prev) => ({
          ...prev,
          loading: false,
          error: wasAborted ? null : (err instanceof TypeError ? "网络异常，请检查连接后重试" : "请求失败，请重试"),
          stopped: !!wasAborted,
          content: prev.content,
        }));
      }
    },
    [stopTimer]
  );

  const cancelStream = useCallback(() => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    stopTimer();
    sendingRef.current = false;
    setStream((prev) => ({ ...prev, loading: false, stopped: true, error: null }));
  }, [stopTimer]);

  return { stream, sendStream, cancelStream, get isSending() { return sendingRef.current; } };
}
