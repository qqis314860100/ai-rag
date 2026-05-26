import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import { ArrowUp, Paperclip, Image, Mic, Keyboard, StopCircle } from "lucide-react";
import { showToast } from "../../../components/ui/Toast";

interface ChatInputProps {
  onSend: (message: string) => void;
  onCancel?: () => void;
  loading: boolean;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  draftValue?: string;
  onDraftChange?: (value: string) => void;
}

const placeholders = [
  "输入你的问题... (Enter 发送)",
  "试试问：绝缘电阻测试标准是什么？",
  "试试问：OCV 测试包含哪些流程？",
  "试试问：焊接飞溅如何排查？",
  "试试问：EOL 测试规范要求是什么？",
];

export default function ChatInput({ onSend, onCancel, loading, disabled, inputRef, draftValue, onDraftChange }: ChatInputProps) {
  const [message, setMessage] = useState(draftValue || "");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef || internalRef;
  const skipNextDraftResizeRef = useRef(false);

  // Rotate placeholder every 3.5s
  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderIdx((prev) => (prev + 1) % placeholders.length);
    }, 3500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const nextValue = draftValue || "";
    setMessage(nextValue);

    const ta = textareaRef.current;
    if (!ta) return;
    if (skipNextDraftResizeRef.current) {
      skipNextDraftResizeRef.current = false;
      return;
    }

    requestAnimationFrame(() => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    });
  }, [draftValue, textareaRef]);

  // Auto-resize textarea height
  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [textareaRef]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    onDraftChange?.(e.target.value);
    resizeTextarea();
  }, [onDraftChange, resizeTextarea]);

  // Intercept paste — detect images for future multimodal support
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          showToast("warning", "图片上传功能即将上线，当前仅支持文字分析");
          return;
        }
      }
    }
  }, []);

  const handleSend = useCallback(() => {
    if (loading) {
      onCancel?.();
      return;
    }
    const trimmed = message.trim();
    if (!trimmed || loading || disabled) return;
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = `${ta.getBoundingClientRect().height}px`;
      skipNextDraftResizeRef.current = true;
    }
    onSend(trimmed);
    setMessage("");
    onDraftChange?.("");
    textareaRef.current?.focus();
  }, [message, loading, disabled, onSend, onCancel, onDraftChange, textareaRef]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-full space-y-2">
      {/* Input row */}
      <div className="flex items-end gap-2">
        {/* Action buttons — decorative, future file/photo/voice upload */}
        <div className="flex items-center gap-0.5 pb-0.5">
          <button
            disabled
            className="p-2 rounded-lg text-text-muted/50 cursor-not-allowed transition-colors"
            title="上传文件 (即将上线)"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button
            disabled
            className="p-2 rounded-lg text-text-muted/50 cursor-not-allowed transition-colors"
            title="上传图片 (即将上线)"
          >
            <Image className="h-4 w-4" />
          </button>
          <button
            disabled
            className="p-2 rounded-lg text-text-muted/50 cursor-not-allowed transition-colors"
            title="语音输入 (即将上线)"
          >
            <Mic className="h-4 w-4" />
          </button>
        </div>

        {/* Text input */}
        <div className="flex-1 rounded-2xl border border-border bg-surface-page focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/10 focus-within:bg-white transition-all duration-normal">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder={placeholders[placeholderIdx]}
            rows={1}
            readOnly={loading}
            disabled={disabled}
            aria-disabled={loading || disabled}
            className="w-full min-h-[48px] max-h-[160px] resize-none bg-transparent px-4 py-3.5 text-[15px] text-text placeholder:text-text-muted/50 focus:outline-none leading-relaxed"
            style={{ transition: "height 180ms var(--ease-out), opacity 150ms ease-out" }}
          />
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={loading ? false : (!message.trim() || disabled)}
          className={`shrink-0 h-[48px] w-[48px] rounded-full text-white flex items-center justify-center disabled:opacity-25 transition-all active:scale-95 shadow-sm-soft ${
            loading ? "bg-danger hover:bg-danger/90" : "bg-primary hover:bg-primary-hover"
          }`}
          title={loading ? "中断生成" : "发送"}
          aria-label={loading ? "中断生成" : "发送消息"}
          data-state={loading ? "interrupt" : "send"}
        >
          {loading ? (
            <StopCircle className="h-5 w-5" />
          ) : (
            <ArrowUp className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Hint row */}
      <div className="flex items-center justify-center gap-3 text-[11px] text-text-muted/60">
        <span className="inline-flex items-center gap-1">
          <Keyboard className="h-3 w-3" />
          Enter 发送
        </span>
        <span className="text-text-muted/30">|</span>
        <span>Shift + Enter 换行</span>
      </div>
    </div>
  );
}
