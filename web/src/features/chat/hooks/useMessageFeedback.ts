import { useEffect, useRef, useState } from "react";
import { showToast } from "../../../components/ui/Toast";
import { api } from "../../../services/api";

type FeedbackCounts = Record<string, { up: number; down: number; userVote?: string }>;

export function useMessageFeedback(persistedAssistantMessageKey: string, loading: boolean) {
  const [feedbackCounts, setFeedbackCounts] = useState<FeedbackCounts>({});
  const [voting, setVoting] = useState<Record<string, boolean>>({});
  const [feedbackReason, setFeedbackReason] = useState<string | null>(null);
  const lastFeedbackFetchKey = useRef("");
  const streamJustEnded = useRef(false);

  useEffect(() => {
    if (loading) {
      streamJustEnded.current = true;
      return;
    }
    if (!persistedAssistantMessageKey) {
      lastFeedbackFetchKey.current = "";
      setFeedbackCounts({});
      return;
    }
    if (lastFeedbackFetchKey.current === persistedAssistantMessageKey) return;

    // 流式刚结束时稍等再拉反馈数，避免消息落库刷新和统计刷新同时抢占布局。
    const timer = setTimeout(() => {
      const msgIds = persistedAssistantMessageKey.split(",");
      lastFeedbackFetchKey.current = persistedAssistantMessageKey;
      api.get<{ data: FeedbackCounts }>(`/stats/feedback-counts?message_ids=${msgIds.join(",")}`)
        .then(res => setFeedbackCounts(res.data || {}))
        .catch(() => {});
    }, streamJustEnded.current ? 300 : 0);
    streamJustEnded.current = false;
    return () => clearTimeout(timer);
  }, [loading, persistedAssistantMessageKey]);

  const handleFeedback = async (messageId: string, rating: "up" | "down") => {
    if (voting[messageId]) return;
    const current = feedbackCounts[messageId] || { up: 0, down: 0 };
    const isToggle = current.userVote === rating;

    if (isToggle) {
      setVoting(v => ({ ...v, [messageId]: true }));
      try {
        setFeedbackCounts(f => ({ ...f, [messageId]: { ...current, userVote: undefined, [rating]: Math.max(0, current[rating] - 1) } }));
        showToast("success", "已取消反馈");
      } catch {
        showToast("error", "反馈提交失败");
      } finally {
        setVoting(v => ({ ...v, [messageId]: false }));
      }
      return;
    }

    if (rating === "down") {
      setFeedbackReason(messageId);
      return;
    }

    setVoting(v => ({ ...v, [messageId]: true }));
    try {
      await api.post("/feedback", { message_id: messageId, rating });
      setFeedbackCounts(f => ({
        ...f,
        [messageId]: {
          up: current.up + 1 - (current.userVote === "up" ? 1 : 0),
          down: current.down - (current.userVote === "down" ? 1 : 0),
          userVote: rating,
        },
      }));
      showToast("success", "感谢点赞！");
    } catch {
      showToast("error", "反馈提交失败");
    } finally {
      setVoting(v => ({ ...v, [messageId]: false }));
    }
  };

  const submitFeedbackReason = async (messageId: string, reason: string) => {
    setFeedbackReason(null);
    setVoting(v => ({ ...v, [messageId]: true }));
    try {
      const current = feedbackCounts[messageId] || { up: 0, down: 0 };
      await api.post("/feedback", { message_id: messageId, rating: "down", reason });
      setFeedbackCounts(f => ({
        ...f,
        [messageId]: {
          up: current.up - (current.userVote === "up" ? 1 : 0),
          down: current.down + 1 - (current.userVote === "down" ? 1 : 0),
          userVote: "down",
        },
      }));
      showToast("success", "感谢反馈，我们会持续改进");
    } catch {
      showToast("error", "反馈提交失败");
    } finally {
      setVoting(v => ({ ...v, [messageId]: false }));
    }
  };

  return {
    feedbackCounts,
    voting,
    feedbackReason,
    setFeedbackReason,
    handleFeedback,
    submitFeedbackReason,
  };
}
