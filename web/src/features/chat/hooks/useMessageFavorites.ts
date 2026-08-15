import { useEffect, useRef, useState } from "react";
import { showToast } from "../../../components/ui/Toast";
import { api } from "../../../services/api";

export function useMessageFavorites(persistedAssistantMessageKey: string) {
  const [favoriteStatus, setFavoriteStatus] = useState<Record<string, boolean>>({});
  const [favoriting, setFavoriting] = useState<Record<string, boolean>>({});
  const lastFavoriteFetchKey = useRef("");

  useEffect(() => {
    if (!persistedAssistantMessageKey) {
      lastFavoriteFetchKey.current = "";
      setFavoriteStatus({});
      return;
    }
    if (lastFavoriteFetchKey.current === persistedAssistantMessageKey) return;

    lastFavoriteFetchKey.current = persistedAssistantMessageKey;
    api.get<{ data: Record<string, boolean> }>(`/favorites/status?message_ids=${persistedAssistantMessageKey}`)
      .then((res) => setFavoriteStatus(res.data || {}))
      .catch(() => {});
  }, [persistedAssistantMessageKey]);

  const handleFavorite = async (messageId: string) => {
    if (favoriting[messageId]) return;

    const isSaved = !!favoriteStatus[messageId];
    setFavoriting((prev) => ({ ...prev, [messageId]: true }));
    setFavoriteStatus((prev) => ({ ...prev, [messageId]: !isSaved }));

    try {
      if (isSaved) {
        await api.delete(`/favorites/${encodeURIComponent(messageId)}`);
        showToast("success", "已取消收藏");
      } else {
        await api.post("/favorites", { message_id: messageId });
        showToast("success", "已收藏");
      }
    } catch {
      setFavoriteStatus((prev) => ({ ...prev, [messageId]: isSaved }));
      showToast("error", "收藏操作失败");
    } finally {
      setFavoriting((prev) => ({ ...prev, [messageId]: false }));
    }
  };

  return {
    favoriteStatus,
    favoriting,
    handleFavorite,
  };
}
