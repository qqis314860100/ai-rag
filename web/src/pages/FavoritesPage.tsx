import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, ExternalLink, Loader2, MessageSquare, Search, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState } from "../components/ui";
import { showToast } from "../components/ui/Toast";
import { api } from "../services/api";
import type { ApiResponse, FavoriteItem } from "../types";

export default function FavoritesPage() {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [removing, setRemoving] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  const loadFavorites = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ApiResponse<{ items: FavoriteItem[] }>>("/favorites");
      setFavorites(res.data.items || []);
    } catch {
      showToast("error", "加载收藏失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const filteredFavorites = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return favorites;

    return favorites.filter((item) =>
      [item.question, item.answer, item.session_title]
        .filter(Boolean)
        .some((text) => text.toLowerCase().includes(q))
    );
  }, [favorites, keyword]);

  const removeFavorite = useCallback(async (messageId: string) => {
    setRemoving((prev) => ({ ...prev, [messageId]: true }));
    try {
      await api.delete(`/favorites/${encodeURIComponent(messageId)}`);
      setFavorites((prev) => prev.filter((item) => item.message_id !== messageId));
      showToast("success", "已取消收藏");
    } catch {
      showToast("error", "取消收藏失败");
    } finally {
      setRemoving((prev) => ({ ...prev, [messageId]: false }));
    }
  }, []);

  const openSession = useCallback((sessionId: string) => {
    navigate(`/chat?session=${encodeURIComponent(sessionId)}`);
  }, [navigate]);

  if (loading) {
    return (
      <div className="p-6 h-full overflow-y-auto">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">收藏</h1>
          <p className="mt-1 text-sm text-text-secondary">收藏的问答会保存到当前账号，方便快速回看</p>
        </div>
        <EmptyState
          title="暂无收藏"
          description="在 AI 问答中对有价值的回答点击星标，即可在这里查看和管理。"
          action={
            <Button onClick={() => navigate("/chat")}>
              <MessageSquare className="h-4 w-4" />
              前往 AI 问答
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 h-full overflow-y-auto">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text">收藏</h1>
          <p className="mt-1 text-sm text-text-secondary">
            共 {favorites.length} 条收藏{keyword && ` · 匹配 ${filteredFavorites.length} 条`}
          </p>
        </div>

        <div className="relative w-full lg:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索问题、回答或会话"
            className="h-10 w-full rounded-lg border border-border bg-surface-page pl-9 pr-9 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/15"
          />
          {keyword && (
            <button
              onClick={() => setKeyword("")}
              className="absolute right-2 top-1/2 rounded-md p-1 -translate-y-1/2 text-text-muted hover:bg-surface-hover hover:text-text"
              title="清空"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {filteredFavorites.length === 0 ? (
        <EmptyState title="没有匹配结果" description="换个关键词试试。" />
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredFavorites.map((item) => (
            <article key={item.id} className="glass rounded-lg p-5 shadow-sm-soft hover-lift transition-all group">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Bookmark className="h-4 w-4 shrink-0 text-accent" />
                    <span className="truncate text-xs text-text-muted">
                      {item.session_title || "会话"} · {new Date(item.saved_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {item.confidence !== undefined && item.confidence > 0 && (
                      <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                        可信度 {(item.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>

                  <h3 className="mb-2 line-clamp-2 text-sm font-semibold leading-relaxed text-text">
                    {item.question || "未关联问题"}
                  </h3>
                  <p className="line-clamp-3 text-sm leading-relaxed text-text-secondary">
                    {item.answer}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => openSession(item.session_id)}
                    className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                    title="跳转到会话"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => removeFavorite(item.message_id)}
                    disabled={removing[item.message_id]}
                    className="rounded-lg p-2 text-text-muted transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                    title="取消收藏"
                  >
                    {removing[item.message_id] ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
