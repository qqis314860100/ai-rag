import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { showToast } from "../../../components/ui/Toast";
import { api } from "../../../services/api";
import type { ChatMessage, ChatSession, Source } from "../types";
import { useStreamChat } from "./useStreamChat";

const TEMP_PERSISTED_MESSAGE_ID_PREFIX = "pending-";

function getActionMessageId(message: ChatMessage) {
  return message.persistedId || message.id;
}

function isTemporaryActionMessageId(messageId: string) {
  return (
    messageId.startsWith("user-") ||
    messageId.startsWith("stream-") ||
    messageId.startsWith("interrupted-") ||
    messageId.startsWith(TEMP_PERSISTED_MESSAGE_ID_PREFIX)
  );
}

interface UseChatMessageFlowOptions {
  activeSessionId: string | null;
  activeSessionIdRef: MutableRefObject<string | null>;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  createSession: (title: string) => Promise<ChatSession | null>;
  markSessionOptimistic: (id: string) => void;
  loadMessages: (sessionId: string, options?: { silent?: boolean; merge?: boolean }) => Promise<void>;
  removeDraft: (sessionId: string) => void;
  setSelectedSources: Dispatch<SetStateAction<Source[] | null>>;
}

export function useChatMessageFlow({
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
}: UseChatMessageFlowOptions) {
  const { stream, sendStream, cancelStream, isSending } = useStreamChat();
  const [scrollToBottomSignal, setScrollToBottomSignal] = useState(0);
  const placeholderIdRef = useRef<string | null>(null);
  const wasLoading = useRef(false);

  useEffect(() => {
    if (stream.loading) {
      wasLoading.current = true;
      return;
    }
    if (!wasLoading.current || !placeholderIdRef.current) return;
    wasLoading.current = false;

    const pid = placeholderIdRef.current;
    placeholderIdRef.current = null;

    if (stream.stopped) {
      if (!stream.content.trim()) {
        setMessages((prev) => prev.filter((message) => message.id !== pid));
        return;
      }

      setMessages((prev) =>
        prev.map((message) =>
          message.id === pid
            ? {
                ...message,
                id: `interrupted-${pid}`,
                content: stream.content,
                sources: [],
                confidence: undefined,
                followups: undefined,
                streaming: false,
                created_at: new Date().toISOString(),
              }
            : message
        )
      );
      return;
    }

    if (stream.error) {
      setMessages((prev) => prev.filter((message) => message.id !== pid));
      return;
    }

    setMessages((prev) =>
      prev.map((message) =>
        message.id === pid
          ? {
              ...message,
              persistedId: stream.messageId || pid,
              content: stream.content || message.content,
              sources: stream.sources,
              confidence: stream.confidence || undefined,
              followups: stream.followups || undefined,
              metadata: stream.metadata,
              streaming: false,
              created_at: new Date().toISOString(),
            }
          : message
      )
    );

    const sessionId = activeSessionIdRef.current;
    if (sessionId) {
      // 最终回答先留在原气泡里，稍后只合并后端 ID，避免列表重排造成闪跳。
      window.setTimeout(() => {
        void loadMessages(sessionId, { silent: true, merge: true });
      }, 800);
    }
  }, [
    activeSessionIdRef,
    loadMessages,
    setMessages,
    stream.confidence,
    stream.content,
    stream.error,
    stream.followups,
    stream.loading,
    stream.metadata,
    stream.messageId,
    stream.sources,
    stream.stopped,
  ]);

  const startOptimisticStream = useCallback(async (
    sessionId: string,
    message: string,
    buildMessages: (prev: ChatMessage[], placeholder: ChatMessage) => ChatMessage[],
    placeholderIdOverride?: string
  ) => {
    const placeholderId = placeholderIdOverride || `stream-${Date.now()}`;
    placeholderIdRef.current = placeholderId;
    const placeholderMsg: ChatMessage = {
      id: placeholderId,
      session_id: sessionId,
      role: "assistant",
      content: "",
      streaming: true,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => buildMessages(prev, placeholderMsg));
    setScrollToBottomSignal((n) => n + 1);
    setSelectedSources(null);
    removeDraft(sessionId);

    await sendStream(sessionId, message, 5);
  }, [removeDraft, sendStream, setMessages, setSelectedSources]);

  const handleSend = useCallback(async (message: string) => {
    if (!message.trim() || isSending) return;
    let sessionId = activeSessionId;
    if (!sessionId) {
      const session = await createSession(message.substring(0, 50));
      if (!session) return;
      sessionId = session.id;
      activeSessionIdRef.current = sessionId;
      markSessionOptimistic(sessionId);
      setActiveSessionId(sessionId);
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      session_id: sessionId,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    };

    await startOptimisticStream(sessionId, message, (prev, placeholderMsg) => [...prev, userMsg, placeholderMsg]);
  }, [activeSessionId, activeSessionIdRef, createSession, isSending, markSessionOptimistic, setActiveSessionId, startOptimisticStream]);

  const handleEditUser = useCallback(async (messageId: string, newContent: string) => {
    if (!newContent.trim() || isSending) return;
    const index = messages.findIndex((message) => message.id === messageId || message.persistedId === messageId);
    if (index === -1) return;
    const message = messages[index];
    if (message.role !== "user") return;
    const apiMessageId = getActionMessageId(message);
    if (isTemporaryActionMessageId(apiMessageId)) return;

    const nextContent = newContent.trim();
    const pendingPersistedId = `${TEMP_PERSISTED_MESSAGE_ID_PREFIX}${Date.now()}`;
    const nextAssistant = messages[index + 1];
    const reusablePlaceholderId = nextAssistant?.role === "assistant" ? nextAssistant.id : undefined;

    try {
      await api.delete(`/chat/messages/${encodeURIComponent(apiMessageId)}`);
      setSelectedSources(null);
      await startOptimisticStream(message.session_id, nextContent, (prev, placeholderMsg) => {
        const currentIndex = prev.findIndex((item) => item.id === messageId || item.persistedId === messageId);
        if (currentIndex === -1) return prev;

        const currentUser = prev[currentIndex];
        return [
          ...prev.slice(0, currentIndex),
          {
            ...currentUser,
            content: nextContent,
            persistedId: pendingPersistedId,
            created_at: new Date().toISOString(),
          },
          placeholderMsg,
        ];
      }, reusablePlaceholderId);
    } catch {
      showToast("error", "编辑消息失败");
    }
  }, [isSending, messages, setSelectedSources, startOptimisticStream]);

  const handleRetry = useCallback((messageId?: string) => {
    if (isSending) return;

    let lastUserMsg: ChatMessage | undefined;
    if (messageId) {
      const answerIndex = messages.findIndex((message) => message.id === messageId || message.persistedId === messageId);
      for (let index = answerIndex - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user") {
          lastUserMsg = messages[index];
          break;
        }
      }
    }

    lastUserMsg ||= [...messages].reverse().find((message) => message.role === "user");
    if (!lastUserMsg) return;

    const actionMessageId = getActionMessageId(lastUserMsg);
    if (isTemporaryActionMessageId(actionMessageId)) {
      handleSend(lastUserMsg.content);
      return;
    }

    void handleEditUser(actionMessageId, lastUserMsg.content);
  }, [handleEditUser, handleSend, isSending, messages]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    const index = messages.findIndex((message) => message.id === messageId || message.persistedId === messageId);
    if (index === -1) return;
    const apiMessageId = getActionMessageId(messages[index]);
    if (isTemporaryActionMessageId(apiMessageId)) return;

    api.delete(`/chat/messages/${encodeURIComponent(apiMessageId)}`)
      .then(() => {
        setMessages((prev) => prev.slice(0, index));
        showToast("success", "消息已删除");
      })
      .catch(() => {
        showToast("error", "删除消息失败");
      });
  }, [messages, setMessages]);

  const handleFollowUp = useCallback((query: string) => {
    if (!isSending) {
      void handleSend(query);
    }
  }, [handleSend, isSending]);

  return {
    stream,
    cancelStream,
    isSending,
    scrollToBottomSignal,
    handleSend,
    handleFollowUp,
    handleInitialQuestion: handleFollowUp,
    handleEditUser,
    handleRetry,
    handleDeleteMessage,
  };
}
