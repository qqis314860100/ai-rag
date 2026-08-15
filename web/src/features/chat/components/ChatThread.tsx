import { lazy, Suspense, useMemo, useState, type CSSProperties } from "react";
import { ChevronDown, StopCircle } from "lucide-react";
import type { ChatArtifact, ChatMessage, DiagramType, Source } from "../types";
import { showToast } from "../../../components/ui/Toast";
import { ChatEmptyWelcome } from "./ChatEmptyWelcome";
import { StreamStages } from "./StreamStages";
import UserMessageBubble from "./UserMessageBubble";
import AssistantMessageBubble from "./AssistantMessageBubble";
import AssistantFooterActions from "./AssistantFooterActions";
import {
  FeedbackReasonPopup,
  FollowUpList,
  StreamingPendingCard,
  ThreadInlineStatus,
} from "./ChatThreadBlocks";
import {
  canUsePersistedAssistantActions,
  canUsePersistedUserActions,
  formatTime,
  getAnswerQualityNotice,
  getAnswerTrustSummary,
  getPersistedMessageId,
  getQueryUnderstandingNotice,
  isAnswerReadyForRefinement,
  mergeArtifacts,
} from "./chatThreadUtils";
import { useChatThreadScroll } from "../hooks/useChatThreadScroll";
import { useMessageArtifacts } from "../hooks/useMessageArtifacts";
import { useMessageFavorites } from "../hooks/useMessageFavorites";
import { useMessageFeedback } from "../hooks/useMessageFeedback";

const ArtifactModal = lazy(() => import("./ArtifactModal"));

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

function messageContainmentStyle(isUser: boolean): CSSProperties {
  return {
    contentVisibility: "auto",
    containIntrinsicSize: isUser ? "64px" : "220px",
  } as CSSProperties;
}

function assistantMessageIds(messages: ChatMessage[]) {
  return messages
    .filter((message) => message.role === "assistant" && !message.streaming)
    .map(getPersistedMessageId)
    .filter(canUsePersistedAssistantActions);
}

export default function ChatThread({
  messages,
  loading,
  streamingContent,
  streamError,
  streamStopped,
  scrollToBottomSignal,
  selectedSources,
  onSelectSources,
  onFollowUp,
  onCancelStream,
  onInitialQuestion,
  onRetry,
  onEditUser,
  onDeleteMessage,
  onSourceAnchor,
  assetDraftStatusByMessage = {},
  onCreateKnowledgeAssetDraft,
}: ChatThreadProps) {
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const { bottomRef, showScrollBtn, scrollToBottom } = useChatThreadScroll({ loading, streamingContent, scrollToBottomSignal });
  const persistedAssistantMessageKey = useMemo(() => assistantMessageIds(messages).join(","), [messages]);
  const { feedbackCounts, voting, feedbackReason, setFeedbackReason, handleFeedback, submitFeedbackReason } =
    useMessageFeedback(persistedAssistantMessageKey, loading);
  const { favoriteStatus, favoriting, handleFavorite } = useMessageFavorites(persistedAssistantMessageKey);
  const { diagramStates, generatedArtifacts, activeArtifact, setActiveArtifact, generateDiagram } = useMessageArtifacts();

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    showToast("success", "已复制到剪贴板");
  };

  const startEdit = (message: ChatMessage) => {
    if (!canUsePersistedUserActions(getPersistedMessageId(message))) return;
    setEditingMsgId(message.id);
    setEditValue(message.content);
  };

  const deleteUserMessage = (message: ChatMessage) => {
    if (!canUsePersistedUserActions(getPersistedMessageId(message))) return;
    if (!window.confirm("确认删除这一轮问答及其后续分支吗？此操作会连带删除对应回答。")) return;
    onDeleteMessage(message.id);
  };

  const generateAndClose = (message: ChatMessage, type: DiagramType, artifact?: ChatArtifact) => {
    setOpenActionMenuId(null);
    void generateDiagram(message, type, artifact);
  };

  const createAssetAndClose = async (messageId: string, type: "card" | "faq") => {
    setOpenActionMenuId(null);
    await onCreateKnowledgeAssetDraft?.(messageId, type);
  };

  if (messages.length === 0 && !loading) {
    return <ChatEmptyWelcome onQuestion={onInitialQuestion} />;
  }

  return (
    <div className="space-y-10 py-6">
      {messages.map((message) => {
        const isUser = message.role === "user";
        const persistedMessageId = getPersistedMessageId(message);
        const canPersistAssistantActions = !isUser && canUsePersistedAssistantActions(persistedMessageId);
        const canPersistUserActions = isUser && canUsePersistedUserActions(persistedMessageId);
        const feedback = feedbackCounts[persistedMessageId] || { up: 0, down: 0 };
        const artifacts = !isUser ? mergeArtifacts(message.artifacts, generatedArtifacts[persistedMessageId]) : [];
        const answerQualityNotice = !isUser && !message.streaming ? getAnswerQualityNotice(message) : null;
        const answerTrustSummary = !isUser && !message.streaming ? getAnswerTrustSummary(message) : null;
        const queryUnderstandingNotice = !isUser && !message.streaming ? getQueryUnderstandingNotice(message) : null;

        return (
          <div
            key={message.id}
            id={`chat-message-${message.id}`}
            className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}
            style={messageContainmentStyle(isUser)}
          >
            <div className="max-w-[80%]">
              {isUser ? (
                <UserMessageBubble
                  message={message}
                  editing={editingMsgId === message.id}
                  editValue={editValue}
                  actionsDisabled={loading || !canPersistUserActions}
                  canPersistActions={canPersistUserActions}
                  loading={loading}
                  onCopy={handleCopy}
                  onStartEdit={startEdit}
                  onEditValueChange={setEditValue}
                  onCancelEdit={() => setEditingMsgId(null)}
                  onConfirmEdit={() => {
                    onEditUser(message.id, editValue);
                    setEditingMsgId(null);
                  }}
                  onDelete={deleteUserMessage}
                />
              ) : message.streaming && !streamingContent ? (
                <StreamingPendingCard onCancelStream={onCancelStream} />
              ) : (
                <AssistantMessageBubble
                  message={message}
                  messageId={persistedMessageId}
                  streamingContent={streamingContent}
                  selectedSources={selectedSources}
                  artifacts={artifacts}
                  assetStatus={assetDraftStatusByMessage[persistedMessageId] || {}}
                  canPersistActions={canPersistAssistantActions}
                  canCreateAssetDraft={isAnswerReadyForRefinement(message)}
                  openActionMenu={openActionMenuId === persistedMessageId}
                  diagramStates={diagramStates}
                  answerQualityNotice={answerQualityNotice}
                  answerTrustSummary={answerTrustSummary}
                  queryUnderstandingNotice={queryUnderstandingNotice}
                  onCancelStream={onCancelStream}
                  onSelectSources={onSelectSources}
                  onSourceAnchor={onSourceAnchor}
                  onToggleActionMenu={() => setOpenActionMenuId(openActionMenuId === persistedMessageId ? null : persistedMessageId)}
                  onFollowUp={(query) => {
                    setOpenActionMenuId(null);
                    onFollowUp(query);
                  }}
                  onCreateKnowledgeAssetDraft={createAssetAndClose}
                  onGenerateDiagram={generateAndClose}
                  onOpenArtifact={(artifact) => {
                    setOpenActionMenuId(null);
                    setActiveArtifact(artifact);
                  }}
                />
              )}
            </div>

            {!isUser && !message.streaming && <FollowUpList items={message.followups} onFollowUp={onFollowUp} />}

            {!message.streaming && (
              <div className="mt-2 flex items-center gap-2">
                <span className="select-none text-[11px] text-text-muted">{formatTime(message.created_at)}</span>
                {canPersistAssistantActions && (
                  <AssistantFooterActions
                    messageId={persistedMessageId}
                    content={message.content}
                    feedback={feedback}
                    favorite={favoriteStatus[persistedMessageId]}
                    favoriting={favoriting[persistedMessageId]}
                    voting={voting[persistedMessageId]}
                    onCopy={handleCopy}
                    onFavorite={handleFavorite}
                    onFeedback={handleFeedback}
                    onRetry={onRetry}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {loading && !messages.some((message) => message.streaming) && (
        <div className="flex flex-col items-start">
          <StreamStages />
          <button type="button" onClick={onCancelStream} className="mt-2 rounded p-1 text-text-muted transition-colors hover:text-danger" title="停止">
            <StopCircle size={14} />
          </button>
        </div>
      )}

      {!loading && <ThreadInlineStatus streamError={streamError} streamStopped={streamStopped} onRetry={() => onRetry()} />}

      {showScrollBtn && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="sticky bottom-4 z-10 mx-auto flex animate-fade-in-up items-center gap-1.5 rounded-full border border-border bg-white px-3 py-2 text-xs text-text-secondary shadow-md-soft transition-all hover:border-accent/50 hover:text-accent"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          滚动到底部
        </button>
      )}

      <FeedbackReasonPopup
        feedbackReason={feedbackReason}
        onSubmit={submitFeedbackReason}
        onCancel={() => setFeedbackReason(null)}
      />

      {activeArtifact && (
        <Suspense fallback={null}>
          <ArtifactModal artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />
        </Suspense>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
