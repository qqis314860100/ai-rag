import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  loading: boolean;
  disabled?: boolean;
}

export default function ChatInput({ onSend, loading, disabled }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || loading || disabled) return;
    onSend(trimmed);
    setMessage("");
    textareaRef.current?.focus();
  }, [message, loading, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-2.5">
      <div className="flex-1 rounded-xl border border-border bg-surface-page focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/10 transition-all duration-normal">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题... (Enter 发送)"
          rows={2}
          disabled={disabled || loading}
          className="w-full min-h-[44px] max-h-[120px] resize-none bg-transparent px-4 py-2.5 text-sm text-text placeholder:text-text-muted/50 focus:outline-none"
        />
      </div>
      <button
        onClick={handleSend}
        disabled={!message.trim() || loading || disabled}
        className="shrink-0 h-[44px] w-[44px] rounded-xl bg-accent text-white flex items-center justify-center hover:bg-accent-hover disabled:opacity-30 transition-all active:scale-[0.95]"
      >
        {loading ? (
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
