import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";

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
    <div className="flex items-end gap-3 max-w-3xl mx-auto w-full">
      <div className="flex-1 rounded-xl border border-border bg-surface focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/10 transition-all duration-normal">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题... (Enter 发送)"
          rows={1}
          disabled={disabled || loading}
          className="w-full min-h-[44px] max-h-[160px] resize-none bg-transparent px-4 py-3 text-[15px] text-text placeholder:text-text-muted/50 focus:outline-none leading-relaxed"
        />
      </div>
      <button
        onClick={handleSend}
        disabled={!message.trim() || loading || disabled}
        className="shrink-0 h-[44px] w-[44px] rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary-hover disabled:opacity-25 transition-all active:scale-95"
      >
        {loading ? (
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <ArrowUp className="h-5 w-5" />
        )}
      </button>
    </div>
  );
}
