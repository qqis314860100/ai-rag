import { Check, Copy, Pencil, Trash2, X } from "lucide-react";
import type { ChatMessage } from "../types";

interface UserMessageBubbleProps {
  message: ChatMessage;
  editing: boolean;
  editValue: string;
  actionsDisabled: boolean;
  canPersistActions: boolean;
  loading: boolean;
  onCopy: (content: string) => void;
  onStartEdit: (message: ChatMessage) => void;
  onEditValueChange: (value: string) => void;
  onCancelEdit: () => void;
  onConfirmEdit: () => void;
  onDelete: (message: ChatMessage) => void;
}

export default function UserMessageBubble({
  message,
  editing,
  editValue,
  actionsDisabled,
  canPersistActions,
  loading,
  onCopy,
  onStartEdit,
  onEditValueChange,
  onCancelEdit,
  onConfirmEdit,
  onDelete,
}: UserMessageBubbleProps) {
  if (editing) {
    return (
      <div className="relative w-[min(80vw,28rem)] rounded-[22px] border border-accent/70 bg-[#F3F1EE] px-4 pb-12 pt-3 shadow-sm-soft">
        <textarea
          value={editValue}
          onChange={(event) => onEditValueChange(event.target.value)}
          rows={4}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancelEdit();
          }}
          className="block max-h-[40vh] min-h-[6.5rem] w-full resize-none overflow-y-auto bg-transparent p-0 text-[15px] leading-relaxed text-text outline-none placeholder:text-text-muted"
          autoFocus
        />
        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancelEdit}
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/70 hover:text-text"
            title="取消"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onConfirmEdit}
            disabled={!editValue.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3F3B37] text-white shadow-sm-soft transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-40"
            title="确认"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group/bubble inline-flex items-center gap-1">
      <div className="order-first flex items-center gap-0.5 opacity-0 transition-opacity group-hover/bubble:opacity-100">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopy(message.content);
          }}
          className="rounded p-1 text-text-muted transition-colors hover:text-text"
          title="复制"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onStartEdit(message);
          }}
          disabled={actionsDisabled}
          className="rounded p-1 text-text-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-text-muted"
          title={loading ? "生成中不可编辑" : canPersistActions ? "编辑并重新提问" : "消息保存后可编辑"}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(message);
          }}
          disabled={actionsDisabled}
          className="rounded p-1 text-text-muted transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-text-muted"
          title={loading ? "生成中不可删除" : canPersistActions ? "删除本轮问答" : "消息保存后可删除"}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="whitespace-pre-wrap rounded-2xl bg-[#F3F1EE] px-4 py-2.5 text-[15px] leading-relaxed text-text transition-colors hover:bg-[#EDEAE6]">
        {message.content}
      </div>
    </div>
  );
}
