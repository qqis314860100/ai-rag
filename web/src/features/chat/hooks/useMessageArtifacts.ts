import { useState } from "react";
import { showToast } from "../../../components/ui/Toast";
import { api } from "../../../services/api";
import type { ApiResponse, ChatArtifact, ChatMessage, DiagramType } from "../types";
import {
  canUsePersistedAssistantActions,
  getDiagramKey,
  getPersistedMessageId,
  mergeArtifacts,
  type DiagramState,
} from "../components/chatThreadUtils";

export function useMessageArtifacts() {
  const [diagramStates, setDiagramStates] = useState<Record<string, DiagramState>>({});
  const [generatedArtifacts, setGeneratedArtifacts] = useState<Record<string, ChatArtifact[]>>({});
  const [activeArtifact, setActiveArtifact] = useState<ChatArtifact | null>(null);

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

  return {
    diagramStates,
    generatedArtifacts,
    activeArtifact,
    setActiveArtifact,
    generateDiagram,
  };
}
