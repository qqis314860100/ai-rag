import { useState } from "react";
import { ThumbsUp, ThumbsDown, Copy, Trash2, Check, X, StopCircle, FileSearch, ChevronRight, RefreshCw, AlertCircle, FileCheck, MessageSquare, ChevronDown, Star, Pencil, Brain, Workflow, Loader2, BookMarked, CircleHelp } from "lucide-react";
import type { ChatMessage, DiagramType, Source } from "../types";
import { MarkdownContent } from "./MarkdownContent";
import ArtifactCard from "./ArtifactCard";
import ArtifactModal from "./ArtifactModal";
import { showToast } from "../../../components/ui/Toast";
import { ActionButton } from "../../../components/ui";
import { ChatEmptyWelcome } from "./ChatEmptyWelcome";
import { StreamStages } from "./StreamStages";
import {
  assetStatusLabel,
  canUsePersistedAssistantActions,
  canUsePersistedUserActions,
  formatTime,
  getAnswerQualityNotice,
  getDiagramActionLabel,
  getDiagramButtonLabel,
  getDiagramKey,
  getPersistedMessageId,
  getQueryUnderstandingNotice,
  isAnswerReadyForRefinement,
  isConfirmedAnswer,
  mergeArtifacts,
  type AnswerQualityNotice,
  type QueryUnderstandingNotice,
} from "./chatThreadUtils";
import { useChatThreadScroll } from "../hooks/useChatThreadScroll";
import { useMessageArtifacts } from "../hooks/useMessageArtifacts";
import { useMessageFavorites } from "../hooks/useMessageFavorites";
import { useMessageFeedback } from "../hooks/useMessageFeedback";

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

const queryNoticeToneClass: Record<QueryUnderstandingNotice["tone"], string> = {
  confirmed: "border-success/20 bg-success-soft/65 text-success",
  inferred: "border-accent/20 bg-accent-soft/55 text-accent",
  confirmation: "border-warning/25 bg-warning-soft text-warning",
};

const answerQualityToneClass: Record<AnswerQualityNotice["tone"], string> = {
  answerable: "border-success/20 bg-success-soft/60 text-success",
  grey_answer: "border-accent/20 bg-accent-soft/60 text-accent",
  partial_answer: "border-warning/25 bg-warning-soft text-warning",
  refused: "border-danger/20 bg-danger-soft text-danger",
};

function QueryUnderstandingHint({ notice }: { notice: QueryUnderstandingNotice }) {
  const Icon = notice.tone === "confirmed" ? FileCheck : notice.tone === "confirmation" ? AlertCircle : CircleHelp;

  return (
    <div className={`mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${queryNoticeToneClass[notice.tone]}`}>
      <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold">
        <Icon className="h-3.5 w-3.5" />
        {notice.label}
      </span>
      <span className="min-w-0 flex-1 text-text-secondary">{notice.text}</span>
      {notice.terms.map((term) => (
        <span key={term} className="max-w-full truncate rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
          {term}
        </span>
      ))}
    </div>
  );
}

function AnswerQualityHint({ notice }: { notice: AnswerQualityNotice }) {
  const Icon = notice.tone === "answerable" ? FileCheck : notice.tone === "refused" ? X : notice.tone === "partial_answer" ? AlertCircle : CircleHelp;

  return (
    <div className={`mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${answerQualityToneClass[notice.tone]}`}>
      <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold">
        <Icon className="h-3.5 w-3.5" />
        {notice.label}
      </span>
      <span className="min-w-0 flex-1 text-text-secondary">{notice.text}</span>
      {notice.confidence !== undefined && notice.confidence > 0 && (
        <span className="shrink-0 rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
          {Math.round(notice.confidence * 100)}%
        </span>
      )}
      {notice.reasons.map((reason) => (
        <span key={reason} className="max-w-full truncate rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
          {reason}
        </span>
      ))}
    </div>
  );
}

export default function ChatThread({ messages, loading, streamingContent, streamError, streamStopped, scrollToBottomSignal, selectedSources, onSelectSources, onFollowUp, onCancelStream, onInitialQuestion, onRetry, onEditUser, onDeleteMessage, onSourceAnchor, assetDraftStatusByMessage = {}, onCreateKnowledgeAssetDraft }: ChatThreadProps) {
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const { bottomRef, showScrollBtn, scrollToBottom } = useChatThreadScroll({ loading, streamingContent, scrollToBottomSignal });

  const persistedAssistantMessageIds = messages
    .filter((m) => m.role === "assistant" && !m.streaming && canUsePersistedAssistantActions(getPersistedMessageId(m)))
    .map((m) => getPersistedMessageId(m));
  const persistedAssistantMessageKey = persistedAssistantMessageIds.join(",");
  const { feedbackCounts, voting, feedbackReason, setFeedbackReason, handleFeedback, submitFeedbackReason } =
    useMessageFeedback(persistedAssistantMessageKey, loading);
  const { favoriteStatus, favoriting, handleFavorite } = useMessageFavorites(persistedAssistantMessageKey);
  const { diagramStates, generatedArtifacts, activeArtifact, setActiveArtifact, generateDiagram } = useMessageArtifacts();

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

  if (messages.length === 0 && !loading) {
    return <ChatEmptyWelcome onQuestion={onInitialQuestion} />;
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
        const confirmedAnswer = !isUser && isConfirmedAnswer(msg);
        const fb = feedbackCounts[persistedMessageId] || { up: 0, down: 0 };
        const messageArtifacts = !isUser ? mergeArtifacts(msg.artifacts, generatedArtifacts[persistedMessageId]) : [];
        const assetStatus = assetDraftStatusByMessage[persistedMessageId] || {};
        const answerQualityNotice = !isUser && !msg.streaming ? getAnswerQualityNotice(msg) : null;
        const queryUnderstandingNotice = !isUser && !msg.streaming ? getQueryUnderstandingNotice(msg) : null;

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
                  <div className="relative w-[min(80vw,28rem)] rounded-[22px] border border-accent/70 bg-[#F3F1EE] px-4 pb-12 pt-3 shadow-sm-soft">
                    <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)}
                      rows={4}
                      onKeyDown={(e) => { if (e.key === "Escape") setEditingMsgId(null); }}
                      className="block max-h-[40vh] min-h-[6.5rem] w-full resize-none overflow-y-auto bg-transparent p-0 text-[15px] leading-relaxed text-text outline-none placeholder:text-text-muted"
                      autoFocus />
                    <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
                      <button onClick={() => setEditingMsgId(null)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/70 hover:text-text" title="取消">
                        <X className="h-4 w-4" />
                      </button>
                      <button onClick={() => { onEditUser(msg.id, editValue); setEditingMsgId(null); }} disabled={!editValue.trim()}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#3F3B37] text-white shadow-sm-soft transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:opacity-40" title="确认">
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
                <div className="relative min-w-[18rem] rounded-2xl border border-border/60 bg-surface-page px-5 py-4 shadow-sm-soft">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-accent">
                      <MessageSquare className="h-3.5 w-3.5" />
                      正在准备回答...
                      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                    </div>
                    <button onClick={onCancelStream} className="p-1 rounded text-text-muted hover:text-danger transition-colors" title="停止生成">
                      <StopCircle size={14} />
                    </button>
                  </div>
                  <StreamStages />
                </div>
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
                  {answerQualityNotice && <AnswerQualityHint notice={answerQualityNotice} />}
                  {queryUnderstandingNotice && <QueryUnderstandingHint notice={queryUnderstandingNotice} />}
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
                    <div className="mt-4 flex flex-wrap items-center justify-end gap-1.5 border-t border-divider/70 pt-3">
                      <span className="mr-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
                        <FileCheck className="h-3.5 w-3.5 text-accent" />
                        整理回答
                      </span>
                      <ActionButton
                        onClick={() => onFollowUp("请把上一条回答整理成 3 条关键结论，并保留必要的引用依据。")}
                        icon={<FileCheck className="h-3.5 w-3.5" />}
                        title="让 AI 基于本条回答继续总结"
                      >
                        总结
                      </ActionButton>
                      {(["card", "faq"] as const).map((assetType) => {
                        const Icon = assetType === "card" ? BookMarked : CircleHelp;
                        const status = assetType === "card" ? assetStatus.card : assetStatus.faq;
                        return (
                          <ActionButton
                            key={assetType}
                            onClick={() => onCreateKnowledgeAssetDraft?.(persistedMessageId, assetType)}
                            disabled={!onCreateKnowledgeAssetDraft || Boolean(status)}
                            icon={<Icon className="h-3.5 w-3.5" />}
                            title={status ? `${assetType === "card" ? "知识卡" : "FAQ"}：${assetStatusLabel(status)}` : `沉淀为${assetType === "card" ? "知识卡" : "FAQ"}草稿`}
                          >
                            {assetType === "card" ? "知识卡" : "FAQ"}
                            {status && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">{assetStatusLabel(status)}</span>}
                          </ActionButton>
                        );
                      })}
                      {(["mindmap", "flowchart"] as DiagramType[]).map((type) => {
                        const state = diagramStates[getDiagramKey(persistedMessageId, type)];
                        const existingArtifact = messageArtifacts.find((artifact) => artifact.type === type || artifact.metadata?.type === type || artifact.metadata?.diagram_type === type);
                        const Icon = type === "mindmap" ? Brain : Workflow;
                        return (
                          <ActionButton
                            key={type}
                            onClick={() => void generateDiagram(msg, type, state?.data || existingArtifact)}
                            disabled={state?.loading}
                            icon={state?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                            title={getDiagramButtonLabel(type, Boolean(state?.data || existingArtifact))}
                          >
                            {getDiagramActionLabel(type, Boolean(state?.data || existingArtifact))}
                          </ActionButton>
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
                        {confirmedAnswer ? "查看证据" : "查看相关资料"}
                        <span className="font-semibold text-accent ml-1">{msg.sources.length}</span> 条
                      </span>
                      {confirmedAnswer && msg.confidence !== undefined && msg.confidence > 0 && (
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
