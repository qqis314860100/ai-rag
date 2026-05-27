import { useRef, useEffect, useState, useCallback } from "react";
import { ThumbsUp, ThumbsDown, Copy, Trash2, Check, X, StopCircle, Sparkles, FileSearch, ChevronRight, RefreshCw, AlertCircle, Search, FileCheck, MessageSquare, FlaskConical, Wrench, Zap, ShieldCheck, ChevronDown, Star, Pencil, Brain, Workflow, Loader2, BookMarked, CircleHelp } from "lucide-react";
import type { ApiResponse, ChatArtifact, ChatMessage, DiagramType, Source } from "../types";
import { MarkdownContent } from "./MarkdownContent";
import ArtifactCard from "./ArtifactCard";
import ArtifactModal from "./ArtifactModal";
import { api } from "../../../services/api";
import { showToast } from "../../../components/ui/Toast";

interface ChatThreadProps {
  messages: ChatMessage[];
  loading: boolean;
  streamingContent: string;
  streamError: string | null;
  streamStopped: boolean;
  scrollToBottomSignal: number;
  selectedSources: Source[] | null;
  onSelectSources: (sources: Source[] | null) => void;
  onCopy?: (content: string) => void;
  onFollowUp: (query: string) => void;
  onCancelStream: () => void;
  onInitialQuestion: (query: string) => void;
  onRetry: (messageId?: string) => void;
  onEditUser: (messageId: string, content: string) => void | Promise<void>;
  onDeleteMessage: (messageId: string) => void;
  onSourceAnchor?: (sources: Source[], index: number) => void;
  assetDraftStatusByMessage?: Record<string, { card?: string; faq?: string }>;
  onCreateKnowledgeAssetDraft?: (messageId: string, type: "card" | "faq") => Promise<void>;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function canUsePersistedAssistantActions(messageId: string) {
  return !messageId.startsWith("stream-") && !messageId.startsWith("interrupted-");
}

function canUsePersistedUserActions(messageId: string) {
  return !messageId.startsWith("user-") && !messageId.startsWith("pending-");
}

function getPersistedMessageId(message: ChatMessage) {
  return message.persistedId || message.id;
}

function getDiagramKey(messageId: string, diagramType: DiagramType) {
  return `${messageId}:${diagramType}`;
}

function getDiagramButtonLabel(diagramType: DiagramType, hasData: boolean) {
  if (diagramType === "mindmap") return hasData ? "查看思维导图" : "生成思维导图";
  return hasData ? "查看流程图" : "生成流程图";
}

function getDiagramActionLabel(diagramType: DiagramType, hasData: boolean) {
  if (diagramType === "mindmap") return hasData ? "查看导图" : "思维导图";
  return hasData ? "查看流程" : "流程图";
}

function assetStatusLabel(status?: string) {
  if (status === "published") return "已发布";
  if (status === "pending_review") return "待审核";
  if (status === "returned") return "已退回";
  if (status === "archived") return "已归档";
  if (status === "ai_draft") return "AI 草稿";
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UNCERTAIN_ANSWER_PATTERN = /(?:暂时无法确认|无法确认|无法回答|没有足够(?:信息|证据)|信息不足|不能确定|请补充|问题不够具体)/;

function isAnswerReadyForRefinement(message: ChatMessage) {
  const answerSummary = isRecord(message.metadata?.answer_ir_summary) ? message.metadata.answer_ir_summary : null;
  const status = typeof answerSummary?.status === "string" ? answerSummary.status : "";
  if (status && status !== "answered") return false;
  if (typeof message.confidence === "number" && message.confidence > 0 && message.confidence < 0.6) return false;
  return !UNCERTAIN_ANSWER_PATTERN.test(message.content);
}

type DiagramState = {
  loading: boolean;
  data?: ChatArtifact;
  error?: string;
};

function mergeArtifacts(base: ChatArtifact[] | undefined, extra: ChatArtifact[] | undefined) {
  const byId = new Map<string, ChatArtifact>();
  [...(base || []), ...(extra || [])].forEach((artifact) => {
    if (artifact.status !== "deleted") byId.set(artifact.id, artifact);
  });
  return Array.from(byId.values());
}

// Empty welcome state with categorized prompt suggestions
function EmptyWelcome({ onQuestion }: { onQuestion: (q: string) => void }) {
  const categories = [
    {
      icon: FlaskConical, label: "测试标准",
      prompts: ["绝缘电阻测试的标准是什么？", "OCV 测试包含哪些流程？", "气密测试参数如何设定？"],
    },
    {
      icon: Wrench, label: "异常排查",
      prompts: ["焊接飞溅的常见原因有哪些？", "CCD 检测误判怎么分析？", "绝缘不良如何快速定位？"],
    },
    {
      icon: Zap, label: "设备操作",
      prompts: ["Busbar 激光焊接关键参数", "电芯分选的标准是什么？", "模组堆叠精度要求是多少？"],
    },
    {
      icon: ShieldCheck, label: "安全规范",
      prompts: ["EOL 测试安全注意事项", "高压测试防护要求", "化学品存储规范"],
    },
  ];

  return (
    <div className="flex flex-col items-center py-12 px-4 text-center animate-fade-in-up">
      <div className="w-16 h-16 rounded-2xl bg-accent-soft flex items-center justify-center mb-6 shadow-sm-soft">
        <Sparkles className="h-7 w-7 text-accent" />
      </div>
      <h2 className="text-lg font-semibold text-text tracking-tight">电池产线知识库</h2>
      <p className="mt-2 max-w-lg text-[15px] text-text-secondary leading-relaxed">
        基于产线技术文档，为你提供即时、可追溯的工艺问答。
        <br />
        选择一个下方问题开始，或直接输入你的疑问。
      </p>

      {/* Categorized prompts */}
      <div className="mt-8 w-full max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-4">
        {categories.map(({ icon: Icon, label, prompts }) => (
          <div key={label} className="rounded-xl border border-border bg-surface-page p-4 text-left hover:border-accent/25 hover:shadow-sm-soft transition-all duration-normal">
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-accent-soft text-accent">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-semibold text-text">{label}</span>
            </div>
            <div className="space-y-1.5">
              {prompts.map((q) => (
                <button
                  key={q}
                  onClick={() => onQuestion(q)}
                  className="w-full text-left px-3 py-1.5 rounded-lg text-[13px] text-text-secondary hover:bg-accent-soft/50 hover:text-accent transition-all duration-fast"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-[11px] text-text-muted">
        AI 生成内容仅供参考，请以正式文档为准
      </p>
    </div>
  );
}

// Animated multi-stage loading indicator
function StreamStages() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 600);
    const t2 = setTimeout(() => setStage(2), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const stages = [
    { icon: Search, label: "检索知识库...", color: "text-accent" },
    { icon: FileCheck, label: "匹配相关文档...", color: "text-accent" },
    { icon: MessageSquare, label: "生成答案中...", color: "text-accent" },
  ];

  return (
    <div className="flex flex-col gap-2">
      {stages.map((s, i) => {
        const isActive = i <= stage;
        const isCurrent = i === stage;
        const StepIcon = s.icon;
        return (
          <div
            key={i}
            className={`flex items-center gap-2.5 text-sm transition-all duration-normal ${
              isActive ? "text-text-secondary" : "text-text-muted/30"
            } ${isCurrent ? "font-medium" : ""}`}
          >
            <span className={`flex items-center justify-center w-5 h-5 rounded-full transition-all duration-normal ${
              isCurrent ? "bg-accent-soft text-accent animate-pulseGlow" :
              i < stage ? "bg-success-soft text-success" :
              "bg-surface-hover text-text-muted/30"
            }`}>
              {i < stage ? <Check className="h-3 w-3" /> : <StepIcon className="h-3 w-3" />}
            </span>
            <span>{s.label}</span>
            {isCurrent && (
              <span className="flex gap-1 ml-1">
                <span className="h-1 w-1 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
                <span className="h-1 w-1 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
                <span className="h-1 w-1 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ChatThread({ messages, loading, streamingContent, streamError, streamStopped, scrollToBottomSignal, selectedSources, onSelectSources, onFollowUp, onCancelStream, onInitialQuestion, onRetry, onEditUser, onDeleteMessage, onSourceAnchor, assetDraftStatusByMessage = {}, onCreateKnowledgeAssetDraft }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [feedbackCounts, setFeedbackCounts] = useState<Record<string, { up: number; down: number; userVote?: string }>>({});
  const [voting, setVoting] = useState<Record<string, boolean>>({});
  const [feedbackReason, setFeedbackReason] = useState<string | null>(null); // message id needing reason
  const [favoriteStatus, setFavoriteStatus] = useState<Record<string, boolean>>({});
  const [favoriting, setFavoriting] = useState<Record<string, boolean>>({});
  const [diagramStates, setDiagramStates] = useState<Record<string, DiagramState>>({});
  const [generatedArtifacts, setGeneratedArtifacts] = useState<Record<string, ChatArtifact[]>>({});
  const [activeArtifact, setActiveArtifact] = useState<ChatArtifact | null>(null);

  const prevContentLen = useRef(0);
  const scrollRaf = useRef<number>(0);
  const wasLoading = useRef(false);
  const containerRef = useRef<HTMLElement | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const nearBottom = useRef(true);
  const lastFeedbackFetchKey = useRef("");
  const lastFavoriteFetchKey = useRef("");

  const persistedAssistantMessageIds = messages
    .filter((m) => m.role === "assistant" && !m.streaming && canUsePersistedAssistantActions(getPersistedMessageId(m)))
    .map((m) => getPersistedMessageId(m));
  const persistedAssistantMessageKey = persistedAssistantMessageIds.join(",");

  // Find and observe the scroll container
  useEffect(() => {
    const el = bottomRef.current?.closest(".chat-scroll-area") as HTMLElement | null;
    if (!el) return;
    containerRef.current = el;

    const handleScroll = () => {
      const threshold = 80;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      nearBottom.current = distFromBottom <= threshold;
      setShowScrollBtn(!nearBottom.current);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const c = containerRef.current;
    if (c) {
      c.scrollTo({ top: c.scrollHeight, behavior });
      nearBottom.current = true;
      setShowScrollBtn(false);
      return;
    }

    bottomRef.current?.scrollIntoView({ block: "end", behavior });
  }, []);

  useEffect(() => {
    if (!scrollToBottomSignal) return;

    let raf = 0;
    const timer = window.setTimeout(() => scrollToBottom("auto"), 180);
    raf = requestAnimationFrame(() => {
      scrollToBottom("smooth");
    });

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [scrollToBottom, scrollToBottomSignal]);

  // Smart scroll: only auto-scroll when user is near bottom
  useEffect(() => {
    if (loading) {
      wasLoading.current = true;
      if (streamingContent.length > prevContentLen.current && !scrollRaf.current) {
        scrollRaf.current = requestAnimationFrame(() => {
          if (nearBottom.current) {
            scrollToBottom();
          }
          scrollRaf.current = 0;
        });
      }
    } else if (wasLoading.current) {
      wasLoading.current = false;
      if (nearBottom.current) {
        // 等一次 layout（finalize 写回 messages）后再追加一次滚动，
        // 用 rAF 链替代旧的 3 次 setTimeout(0/100/350ms) 兜底。
        requestAnimationFrame(() => {
          requestAnimationFrame(() => scrollToBottom("auto"));
        });
      }
    }
    prevContentLen.current = streamingContent.length;
    return () => { if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current); };
  }, [streamingContent, loading, scrollToBottom]);

  // Fetch feedback counts — skip during streaming to avoid flicker
  const streamJustEnded = useRef(false);
  useEffect(() => {
    if (loading) { streamJustEnded.current = true; return; }
    if (!persistedAssistantMessageKey) {
      lastFeedbackFetchKey.current = "";
      setFeedbackCounts({});
      return;
    }
    if (lastFeedbackFetchKey.current === persistedAssistantMessageKey) return;

    // Delay feedback fetch slightly after stream ends to avoid flicker
    const timer = setTimeout(() => {
      const msgIds = persistedAssistantMessageKey.split(",");
      lastFeedbackFetchKey.current = persistedAssistantMessageKey;
      api.get<{ data: Record<string, { up: number; down: number; userVote?: string }> }>(`/stats/feedback-counts?message_ids=${msgIds.join(",")}`)
        .then(res => setFeedbackCounts(res.data || {}))
        .catch(() => {});
    }, streamJustEnded.current ? 300 : 0);
    streamJustEnded.current = false;
    return () => clearTimeout(timer);
  }, [loading, persistedAssistantMessageKey]);

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

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    showToast("success", "已复制到剪贴板");
  };

  const handleStartEdit = (msg: ChatMessage) => {
    if (!canUsePersistedUserActions(getPersistedMessageId(msg))) return;
    setEditingMsgId(msg.id);
    setEditValue(msg.content);
  };

  const handleDeleteUserMessage = (msg: ChatMessage) => {
    if (!canUsePersistedUserActions(getPersistedMessageId(msg))) return;
    const ok = window.confirm("确认删除这一轮问答及其后续分支吗？此操作会连带删除对应回答。");
    if (!ok) return;
    onDeleteMessage(msg.id);
  };

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
      // Ask for reason before submitting
      setFeedbackReason(messageId);
      return;
    }

    // Thumbs-up — submit immediately
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

  const generateDiagram = async (message: ChatMessage, diagramType: DiagramType, existingArtifact?: ChatArtifact) => {
    const messageId = getPersistedMessageId(message);
    if (!canUsePersistedAssistantActions(messageId)) return;

    if (existingArtifact?.status === "ready") {
      setActiveArtifact(existingArtifact);
      return;
    }

    const key = getDiagramKey(messageId, diagramType);
    const existing = diagramStates[key];
    if (existing?.data) {
      setActiveArtifact(existing.data);
      return;
    }
    if (existing?.loading) return;

    setDiagramStates((prev) => ({
      ...prev,
      [key]: { loading: true },
    }));

    try {
      const res = await api.post<ApiResponse<ChatArtifact>>(
        `/chat/messages/${encodeURIComponent(messageId)}/artifacts/generate`,
        {
          type: diagramType,
          title: "AI 整理",
        }
      );
      setGeneratedArtifacts((prev) => ({
        ...prev,
        [messageId]: mergeArtifacts(prev[messageId], [res.data]),
      }));
      setDiagramStates((prev) => ({
        ...prev,
        [key]: { loading: false, data: res.data },
      }));
      setActiveArtifact(res.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成图谱失败";
      setDiagramStates((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          error: message,
        },
      }));
      showToast("error", message);
    }
  };

  if (messages.length === 0 && !loading) {
    return <EmptyWelcome onQuestion={onInitialQuestion} />;
  }

  return (
    <div className="py-6 space-y-10">
      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const persistedMessageId = getPersistedMessageId(msg);
        const canPersistAssistantActions = !isUser && canUsePersistedAssistantActions(persistedMessageId);
        const canPersistUserActions = isUser && canUsePersistedUserActions(persistedMessageId);
        const userBranchActionsDisabled = loading || !canPersistUserActions;
        const canRefineAssistantAnswer = canPersistAssistantActions && isAnswerReadyForRefinement(msg);
        const fb = feedbackCounts[persistedMessageId] || { up: 0, down: 0 };
        const messageArtifacts = !isUser ? mergeArtifacts(msg.artifacts, generatedArtifacts[persistedMessageId]) : [];
        const assetStatus = assetDraftStatusByMessage[persistedMessageId] || {};

        return (
          <div
            key={msg.id}
            id={`chat-message-${msg.id}`}
            className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}
          >
            {/* Message body */}
            <div className={`max-w-[80%]`}>
              {isUser ? (
                editingMsgId === msg.id ? (
                  /* Edit mode */
                  <div className="flex flex-col gap-2">
                    <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setEditingMsgId(null); }}
                      className="w-full min-h-[80px] px-4 py-3 text-[15px] leading-relaxed border border-border rounded-2xl bg-surface-page focus:outline-none focus:border-accent resize-none"
                      autoFocus />
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditingMsgId(null)}
                        className="p-2 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors" title="取消">
                        <X className="h-4 w-4" />
                      </button>
                      <button onClick={() => { onEditUser(msg.id, editValue); setEditingMsgId(null); }} disabled={!editValue.trim()}
                        className="p-2 rounded-lg bg-primary text-white hover:bg-primary-hover disabled:opacity-40 transition-colors" title="确认">
                        <Check className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* User bubble — hover shows copy/edit/delete on the left */
                  <div className="relative group/bubble inline-flex items-center gap-1">
                    {/* Copy + edit + delete on hover — appear to the LEFT of the bubble */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/bubble:opacity-100 transition-opacity order-first">
                      <button onClick={(e) => { e.stopPropagation(); handleCopy(msg.content); }}
                        className="p-1 rounded text-text-muted hover:text-text transition-colors" title="复制">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStartEdit(msg); }}
                        disabled={userBranchActionsDisabled}
                        className="p-1 rounded text-text-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-text-muted transition-colors"
                        title={loading ? "生成中不可编辑" : canPersistUserActions ? "编辑并重新提问" : "消息保存后可编辑"}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteUserMessage(msg); }}
                        disabled={userBranchActionsDisabled}
                        className="p-1 rounded text-text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-text-muted transition-colors"
                        title={loading ? "生成中不可删除" : canPersistUserActions ? "删除本轮问答" : "消息保存后可删除"}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div
                      className="rounded-2xl bg-[#F3F1EE] px-4 py-2.5 text-[15px] leading-relaxed text-text whitespace-pre-wrap hover:bg-[#EDEAE6] transition-colors"
                    >
                      {msg.content}
                    </div>
                  </div>
                )
              ) : msg.streaming && !streamingContent ? (
                /* Streaming — no content yet, show staged progress */
                <StreamStages />
              ) : (
                /* AI message — 统一气泡背景，流式与定稿不再换 bg/border，只靠顶部状态条和光标作为 indicator */
                <div className="relative rounded-2xl border px-5 py-4 shadow-sm-soft bg-surface-page border-border/60">
                  {/* Streaming label */}
                  {msg.streaming && (
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs text-accent font-medium">
                        <MessageSquare className="h-3.5 w-3.5" />
                        正在生成答案...
                        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                      </div>
                      <button onClick={onCancelStream} className="p-1 rounded text-text-muted hover:text-danger transition-colors" title="停止生成">
                        <StopCircle size={14} />
                      </button>
                    </div>
                  )}
                  {/* Low confidence warning */}
                  {!msg.streaming && msg.confidence !== undefined && msg.confidence > 0 && msg.confidence < 0.6 && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-warning-soft border border-warning/20 text-[13px] text-warning">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>本回答置信度较低（{(msg.confidence * 100).toFixed(0)}%），请人工核对原文</span>
                    </div>
                  )}
                  <div className="text-[15px] leading-relaxed text-text">
                    <MarkdownContent
                      content={msg.streaming ? streamingContent : msg.content}
                      sources={msg.sources}
                      onSourceClick={(idx) => { if (msg.sources?.[idx]) onSourceAnchor?.(msg.sources, idx); }}
                    />
                    {msg.streaming && (
                      <span className="inline-block w-[3px] h-5 ml-0.5 bg-accent align-middle" style={{ animation: "cursorBlink 0.6s step-end infinite", borderRadius: 1 }} />
                    )}
                  </div>
                  {!msg.streaming && canRefineAssistantAnswer && (
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-divider/70 pt-3">
                      <span className="mr-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
                        <Sparkles className="h-3.5 w-3.5 text-accent" />
                        可继续整理
                      </span>
                      <button
                        type="button"
                        onClick={() => onFollowUp("请把上一条回答整理成 3 条关键结论，并保留必要的引用依据。")}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary shadow-sm-soft transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:text-accent"
                        title="让 AI 基于本条回答继续总结"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        总结
                      </button>
                      {(["card", "faq"] as const).map((assetType) => {
                        const Icon = assetType === "card" ? BookMarked : CircleHelp;
                        const status = assetType === "card" ? assetStatus.card : assetStatus.faq;
                        return (
                          <button
                            key={assetType}
                            type="button"
                            onClick={() => onCreateKnowledgeAssetDraft?.(persistedMessageId, assetType)}
                            disabled={!onCreateKnowledgeAssetDraft || Boolean(status)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary shadow-sm-soft transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:text-accent disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                            title={status ? `${assetType === "card" ? "知识卡" : "FAQ"}：${assetStatusLabel(status)}` : `沉淀为${assetType === "card" ? "知识卡" : "FAQ"}草稿`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {assetType === "card" ? "知识卡" : "FAQ"}
                            {status && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">{assetStatusLabel(status)}</span>}
                          </button>
                        );
                      })}
                      {(["mindmap", "flowchart"] as DiagramType[]).map((type) => {
                        const state = diagramStates[getDiagramKey(persistedMessageId, type)];
                        const existingArtifact = messageArtifacts.find((artifact) => artifact.type === type || artifact.metadata?.type === type || artifact.metadata?.diagram_type === type);
                        const Icon = type === "mindmap" ? Brain : Workflow;
                        return (
                          <button
                            key={type}
                            type="button"
                            onClick={() => void generateDiagram(msg, type, state?.data || existingArtifact)}
                            disabled={state?.loading}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary shadow-sm-soft transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:text-accent disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                            title={getDiagramButtonLabel(type, Boolean(state?.data || existingArtifact))}
                          >
                            {state?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                            {getDiagramActionLabel(type, Boolean(state?.data || existingArtifact))}
                          </button>
                        );
                      })}
                      {(["mindmap", "flowchart"] as DiagramType[]).map((type) => {
                        const state = diagramStates[getDiagramKey(persistedMessageId, type)];
                        return state?.error ? (
                          <span key={`${type}-error`} className="basis-full text-right text-[11px] text-warning">
                            {state.error}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {!isUser && !msg.streaming && messageArtifacts.length > 0 && (
              <div className="mt-3 w-full max-w-[80%] space-y-2">
                {messageArtifacts.map((artifact) => (
                  <ArtifactCard key={artifact.id} artifact={artifact} onOpen={setActiveArtifact} />
                ))}
              </div>
            )}

            {/* AI: sources + follow-ups (hidden while streaming) */}
            {!isUser && !msg.streaming && (
              <>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => onSelectSources(selectedSources === msg.sources ? null : msg.sources!)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface-page hover:border-accent/40 hover:bg-accent-soft/50 transition-all duration-normal"
                    >
                      <FileSearch className="h-3.5 w-3.5 text-accent" />
                      <span className="text-xs text-text-secondary">
                        查看证据
                        <span className="font-semibold text-accent ml-1">{msg.sources.length}</span> 条
                      </span>
                      {msg.confidence !== undefined && msg.confidence > 0 && (
                        <span className={`text-[11px] font-semibold ml-1 px-1.5 py-0.5 rounded-full ${
                          msg.confidence >= 0.8 ? "bg-success/10 text-success" :
                          msg.confidence >= 0.6 ? "bg-accent/10 text-accent" :
                          "bg-warning/10 text-warning"
                        }`}>
                          可信度 {(msg.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </button>
                  </div>
                )}
                {msg.followups && msg.followups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {msg.followups.map((q, j) => (
                      <button key={j} onClick={() => onFollowUp(q)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-border text-xs text-text-secondary hover:border-accent hover:text-accent transition-colors">
                        {q}<ChevronRight className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Time + actions — hidden while streaming */}
            {!msg.streaming && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[11px] text-text-muted select-none">{formatTime(msg.created_at)}</span>
              {!isUser && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleCopy(msg.content)}
                    className="p-0.5 rounded text-text-muted hover:text-text transition-colors" title="复制">
                    <Copy className="h-3 w-3" />
                  </button>
                  {canPersistAssistantActions && (
                    <>
                      <button onClick={() => handleFavorite(persistedMessageId)} disabled={favoriting[persistedMessageId]}
                        className={`p-0.5 rounded transition-colors ${favoriteStatus[persistedMessageId] ? "text-warning" : "text-text-muted hover:text-warning"}`} title={favoriteStatus[persistedMessageId] ? "取消收藏" : "收藏"}>
                        <Star className="h-3 w-3" fill={favoriteStatus[persistedMessageId] ? "currentColor" : "none"} />
                      </button>
                      <button onClick={() => handleFeedback(persistedMessageId, "up")} disabled={voting[persistedMessageId]}
                        className={`p-0.5 rounded transition-colors ${fb.userVote === "up" ? "text-success" : "text-text-muted hover:text-success"}`} title="点赞">
                        <ThumbsUp className="h-3 w-3" fill={fb.userVote === "up" ? "currentColor" : "none"} />
                      </button>
                      {fb.up > 0 && <span className="text-[11px] text-text-muted">{fb.up}</span>}
                      <button onClick={() => handleFeedback(persistedMessageId, "down")} disabled={voting[persistedMessageId]}
                        className={`p-0.5 rounded transition-colors ${fb.userVote === "down" ? "text-danger" : "text-text-muted hover:text-danger"}`} title="点踩">
                        <ThumbsDown className="h-3 w-3" fill={fb.userVote === "down" ? "currentColor" : "none"} />
                      </button>
                      {fb.down > 0 && <span className="text-[11px] text-text-muted">{fb.down}</span>}
                    </>
                  )}
                  <button onClick={() => onRetry(msg.id)}
                    className="p-0.5 rounded text-text-muted hover:text-accent transition-colors" title="重新生成此回答">
                    <RefreshCw className="h-3 w-3" />
                  </button>
                  {msg.sources && msg.sources.length > 0 && (
                    <button
                      onClick={() => onSelectSources(selectedSources === msg.sources ? null : msg.sources!)}
                      className="p-0.5 rounded text-text-muted hover:text-accent transition-colors"
                      title="查看证据详情"
                    >
                      <FileSearch className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        );
      })}

      {/* Cancel stream button — shown when loading but streaming msg not yet received content */}
      {loading && !messages.some((m) => m.streaming) && (
        <div className="flex flex-col items-start">
          <StreamStages />
          <button onClick={onCancelStream} className="mt-2 p-1 rounded text-text-muted hover:text-danger transition-colors" title="停止">
            <StopCircle size={14} />
          </button>
        </div>
      )}

      {/* Error state */}
      {!loading && streamError && !streamStopped && (
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4" />
            {streamError}
          </div>
          <button onClick={() => onRetry()} className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
            <RefreshCw className="h-3 w-3" />重试
          </button>
        </div>
      )}

      {!loading && streamStopped && (
        <div className="flex flex-col items-start">
          <span className="text-sm text-text-muted">已中断</span>
          <button onClick={() => onRetry()} className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover">
            <RefreshCw className="h-3 w-3" />重试
          </button>
        </div>
      )}

      {/* Scroll-to-bottom floating button */}
      {showScrollBtn && (
        <button
          onClick={() => scrollToBottom("smooth")}
          className="sticky bottom-4 mx-auto flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-border shadow-md-soft text-xs text-text-secondary hover:text-accent hover:border-accent/50 transition-all animate-fade-in-up z-10"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          滚动到底部
        </button>
      )}

      {/* Feedback reason popup */}
      {feedbackReason && (
        <div className="animate-fade-in-up sticky bottom-16 mx-auto max-w-xs w-full bg-white border border-border rounded-xl shadow-lg-soft p-3 z-20">
          <p className="text-xs font-medium text-text mb-2">为什么觉得不够好？</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "内容过时", reason: "outdated" },
              { label: "匹配错误", reason: "mismatch" },
              { label: "逻辑混乱", reason: "confusing" },
              { label: "信息不全", reason: "incomplete" },
              { label: "其他", reason: "other" },
            ].map(({ label, reason }) => (
              <button
                key={reason}
                onClick={() => submitFeedbackReason(feedbackReason, reason)}
                className="px-2.5 py-1 rounded-lg border border-border text-xs text-text-secondary hover:border-accent hover:text-accent transition-all"
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setFeedbackReason(null)}
            className="mt-2 text-[10px] text-text-muted hover:text-text transition-colors"
          >
            取消
          </button>
        </div>
      )}

      {activeArtifact && (
        <ArtifactModal artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
