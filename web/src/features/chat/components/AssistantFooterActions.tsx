import { Copy, RefreshCw, Star, ThumbsDown, ThumbsUp } from "lucide-react";

interface AssistantFooterActionsProps {
  messageId: string;
  content: string;
  feedback: { up: number; down: number; userVote?: string };
  favorite?: boolean;
  favoriting?: boolean;
  voting?: boolean;
  onCopy: (content: string) => void;
  onFavorite: (messageId: string) => void;
  onFeedback: (messageId: string, vote: "up" | "down") => void;
  onRetry: (messageId: string) => void;
}

export default function AssistantFooterActions({
  messageId,
  content,
  feedback,
  favorite,
  favoriting,
  voting,
  onCopy,
  onFavorite,
  onFeedback,
  onRetry,
}: AssistantFooterActionsProps) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
      <button type="button" onClick={() => onCopy(content)} className="rounded p-0.5 text-text-muted transition-colors hover:text-text" title="复制">
        <Copy className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onFavorite(messageId)}
        disabled={favoriting}
        className={`rounded p-0.5 transition-colors ${favorite ? "text-warning" : "text-text-muted hover:text-warning"}`}
        title={favorite ? "取消收藏" : "收藏"}
      >
        <Star className="h-3 w-3" fill={favorite ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        onClick={() => onFeedback(messageId, "up")}
        disabled={voting}
        className={`rounded p-0.5 transition-colors ${feedback.userVote === "up" ? "text-success" : "text-text-muted hover:text-success"}`}
        title="点赞"
      >
        <ThumbsUp className="h-3 w-3" fill={feedback.userVote === "up" ? "currentColor" : "none"} />
      </button>
      {feedback.up > 0 && <span className="text-[11px] text-text-muted">{feedback.up}</span>}
      <button
        type="button"
        onClick={() => onFeedback(messageId, "down")}
        disabled={voting}
        className={`rounded p-0.5 transition-colors ${feedback.userVote === "down" ? "text-danger" : "text-text-muted hover:text-danger"}`}
        title="点踩"
      >
        <ThumbsDown className="h-3 w-3" fill={feedback.userVote === "down" ? "currentColor" : "none"} />
      </button>
      {feedback.down > 0 && <span className="text-[11px] text-text-muted">{feedback.down}</span>}
      <button type="button" onClick={() => onRetry(messageId)} className="rounded p-0.5 text-text-muted transition-colors hover:text-accent" title="重新生成此回答">
        <RefreshCw className="h-3 w-3" />
      </button>
    </div>
  );
}
