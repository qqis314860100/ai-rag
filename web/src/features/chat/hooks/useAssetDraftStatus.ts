import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "../../../components/ui/Toast";
import { api } from "../../../services/api";
import type { ChatMessage, KnowledgeCard, KnowledgeFaq } from "../types";

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

export function useAssetDraftStatus(messages: ChatMessage[]) {
  const [assetDraftStatusByMessage, setAssetDraftStatusByMessage] = useState<Record<string, { card?: string; faq?: string }>>({});
  const lastAssetStatusFetchKey = useRef("");

  const persistedAssistantMessageKey = useMemo(() => {
    return messages
      .filter((message) => message.role === "assistant" && !message.streaming)
      .map(getActionMessageId)
      .filter((messageId) => !isTemporaryActionMessageId(messageId))
      .join(",");
  }, [messages]);

  useEffect(() => {
    const assistantIds = persistedAssistantMessageKey ? persistedAssistantMessageKey.split(",") : [];
    if (assistantIds.length === 0) {
      lastAssetStatusFetchKey.current = "";
      setAssetDraftStatusByMessage({});
      return;
    }
    if (lastAssetStatusFetchKey.current === persistedAssistantMessageKey) return;

    let active = true;
    lastAssetStatusFetchKey.current = persistedAssistantMessageKey;
    api.get<{ data: Record<string, { card?: string; faq?: string }> }>(
      `/knowledge/assets/status-by-message?message_ids=${assistantIds.map(encodeURIComponent).join(",")}`
    )
      .then((res) => {
        if (active) setAssetDraftStatusByMessage(res.data || {});
      })
      .catch(() => {
        if (active) setAssetDraftStatusByMessage({});
      });

    return () => {
      active = false;
    };
  }, [persistedAssistantMessageKey]);

  const createKnowledgeAssetDraft = useCallback(async (messageId: string, type: "card" | "faq") => {
    if (isTemporaryActionMessageId(messageId)) return;
    const path = type === "card"
      ? "/knowledge/cards/draft/from-message"
      : "/knowledge/faqs/draft/from-message";
    try {
      const res = await api.post<{ data: KnowledgeCard | KnowledgeFaq }>(path, { message_id: messageId });
      const status = "status" in res.data ? res.data.status : "ai_draft";
      setAssetDraftStatusByMessage((current) => ({
        ...current,
        [messageId]: {
          ...(current[messageId] || {}),
          [type]: status,
        },
      }));
      showToast("success", type === "card" ? "已生成知识卡 AI 草稿" : "已生成 FAQ AI 草稿");
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "知识沉淀失败");
    }
  }, []);

  return {
    assetDraftStatusByMessage,
    createKnowledgeAssetDraft,
  };
}
