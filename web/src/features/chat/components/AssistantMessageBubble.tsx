import { MessageSquare, StopCircle } from "lucide-react";
import type { ChatArtifact, ChatMessage, DiagramType, Source } from "../types";
import { MarkdownContent } from "./MarkdownContent";
import AnswerTrustPanel from "./AnswerTrustPanel";
import AssistantActionDock from "./AssistantActionDock";
import { AnswerQualityHint, QueryUnderstandingHint, StreamingPlainText } from "./AnswerHints";
import type {
  AnswerQualityNotice,
  AnswerTrustSummary,
  DiagramState,
  QueryUnderstandingNotice,
} from "./chatThreadUtils";

interface AssistantMessageBubbleProps {
  message: ChatMessage;
  messageId: string;
  streamingContent: string;
  selectedSources: Source[] | null;
  artifacts: ChatArtifact[];
  assetStatus: { card?: string; faq?: string };
  canPersistActions: boolean;
  canCreateAssetDraft: boolean;
  openActionMenu: boolean;
  diagramStates: Record<string, DiagramState>;
  answerQualityNotice: AnswerQualityNotice | null;
  answerTrustSummary: AnswerTrustSummary | null;
  queryUnderstandingNotice: QueryUnderstandingNotice | null;
  onCancelStream: () => void;
  onSelectSources: (sources: Source[] | null) => void;
  onSourceAnchor?: (sources: Source[], index: number) => void;
  onToggleActionMenu: () => void;
  onFollowUp: (query: string) => void;
  onCreateKnowledgeAssetDraft: (messageId: string, type: "card" | "faq") => Promise<void>;
  onGenerateDiagram: (message: ChatMessage, type: DiagramType, artifact?: ChatArtifact) => void;
  onOpenArtifact: (artifact: ChatArtifact) => void;
}

export default function AssistantMessageBubble({
  message,
  messageId,
  streamingContent,
  selectedSources,
  artifacts,
  assetStatus,
  canPersistActions,
  canCreateAssetDraft,
  openActionMenu,
  diagramStates,
  answerQualityNotice,
  answerTrustSummary,
  queryUnderstandingNotice,
  onCancelStream,
  onSelectSources,
  onSourceAnchor,
  onToggleActionMenu,
  onFollowUp,
  onCreateKnowledgeAssetDraft,
  onGenerateDiagram,
  onOpenArtifact,
}: AssistantMessageBubbleProps) {
  return (
    <div className="relative rounded-2xl border border-border/60 bg-surface-page px-5 py-4 shadow-sm-soft">
      {message.streaming && (
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-accent">
            <MessageSquare className="h-3.5 w-3.5" />
            正在生成答案...
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          </div>
          <button type="button" onClick={onCancelStream} className="rounded p-1 text-text-muted transition-colors hover:text-danger" title="停止生成">
            <StopCircle size={14} />
          </button>
        </div>
      )}

      {answerQualityNotice && <AnswerQualityHint notice={answerQualityNotice} />}
      {queryUnderstandingNotice && <QueryUnderstandingHint notice={queryUnderstandingNotice} />}

      <div className="text-[15px] leading-relaxed text-text">
        {message.streaming ? (
          <StreamingPlainText content={streamingContent} />
        ) : (
          <MarkdownContent
            content={message.content}
            sources={message.sources}
            onSourceClick={(index) => {
              if (message.sources?.[index]) onSourceAnchor?.(message.sources, index);
            }}
          />
        )}
        {message.streaming && (
          <span className="ml-0.5 inline-block h-5 w-[3px] rounded-[1px] bg-accent align-middle" style={{ animation: "cursorBlink 0.6s step-end infinite" }} />
        )}
      </div>

      {answerTrustSummary && (
        <AnswerTrustPanel
          summary={answerTrustSummary}
          sources={message.sources}
          isOpen={selectedSources === message.sources}
          onToggleSources={() => onSelectSources(selectedSources === message.sources ? null : message.sources || null)}
          onSourceAnchor={onSourceAnchor}
        />
      )}

      {!message.streaming && canPersistActions && (
        <AssistantActionDock
          message={message}
          messageId={messageId}
          artifacts={artifacts}
          assetStatus={assetStatus}
          canCreateAssetDraft={canCreateAssetDraft}
          open={openActionMenu}
          diagramStates={diagramStates}
          onToggle={onToggleActionMenu}
          onFollowUp={onFollowUp}
          onCreateKnowledgeAssetDraft={onCreateKnowledgeAssetDraft}
          onGenerateDiagram={onGenerateDiagram}
          onOpenArtifact={onOpenArtifact}
        />
      )}
    </div>
  );
}
