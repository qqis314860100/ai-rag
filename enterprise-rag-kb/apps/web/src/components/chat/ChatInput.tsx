import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { Send, Zap } from "lucide-react";
import { Button, Textarea } from "../ui";

interface ChatInputProps {
  onSend: (message: string, topK?: number) => void;
  loading: boolean;
  disabled?: boolean;
  topK?: number;
  onTopKChange?: (k: number) => void;
}

const TOP_K_OPTIONS = [3, 5, 8, 10];

export default function ChatInput({ onSend, loading, disabled, topK: extTopK, onTopKChange }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [localTopK, setLocalTopK] = useState(5);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const topK = extTopK ?? localTopK;
  const setTopK = onTopKChange ?? setLocalTopK;

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || loading || disabled) return;
    onSend(trimmed, topK);
    setMessage("");
    textareaRef.current?.focus();
  }, [message, loading, disabled, topK, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-end gap-3">
      <div className="flex-1 rounded-lg glass shadow-sm-soft ring-1 ring-transparent focus-within:ring-accent/20 transition-all duration-normal px-1 py-1">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题... (Enter 发送)"
          rows={2}
          disabled={disabled || loading}
          className="min-h-[48px] resize-none border-0 bg-transparent focus:ring-0 focus:outline-none placeholder:text-text-muted/60"
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-text-muted" />
            {TOP_K_OPTIONS.map((k) => (
              <button
                key={k}
                onClick={() => setTopK(k)}
                className={`min-w-[36px] min-h-[36px] rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-fast ${
                  topK === k
                    ? "bg-accent text-white shadow-sm"
                    : "text-text-muted hover:bg-surface-hover hover:text-text"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          {message.length > 0 && (
            <span className="text-xs text-text-muted">{message.length} 字</span>
          )}
        </div>
      </div>
      <Button
        onClick={handleSend}
        disabled={!message.trim() || loading || disabled}
        loading={loading}
        className="h-[48px] w-[48px] shrink-0 rounded-xl p-0"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
