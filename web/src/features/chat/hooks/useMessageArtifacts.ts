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

const ARTIFACT_POLL_INTERVAL_MS = 1200;
const ARTIFACT_POLL_LIMIT = 40;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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
    if (existingArtifact?.status === "failed") {
      showToast("error", existingArtifact.reason || "图解生成失败");
      return;
    }

    const key = getDiagramKey(messageId, diagramType);
    if (existingArtifact?.status === "pending") {
      setDiagramStates((prev) => ({
        ...prev,
        [key]: { loading: true, data: existingArtifact },
      }));
      try {
        let artifact = existingArtifact;
        for (let index = 0; index < ARTIFACT_POLL_LIMIT && artifact.status === "pending"; index += 1) {
          await wait(ARTIFACT_POLL_INTERVAL_MS);
          const pollRes = await api.get<ApiResponse<ChatArtifact>>(`/chat/artifacts/${encodeURIComponent(artifact.id)}`);
          artifact = pollRes.data;
          setGeneratedArtifacts((prev) => ({
            ...prev,
            [messageId]: mergeArtifacts(prev[messageId], [artifact]),
          }));
        }

        setDiagramStates((prev) => ({
          ...prev,
          [key]: { loading: false, data: artifact },
        }));
        if (artifact.status === "ready") {
          setActiveArtifact(artifact);
        } else {
          showToast(artifact.status === "failed" ? "error" : "success", artifact.reason || "图解仍在生成中，可稍后再查看");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "图解状态刷新失败";
        setDiagramStates((prev) => ({
          ...prev,
          [key]: { loading: false, data: existingArtifact, error: message },
        }));
        showToast("error", message);
      }
      return;
    }

    const existing = diagramStates[key];
    if (existing?.data?.status === "ready") {
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
      let artifact = res.data;
      setGeneratedArtifacts((prev) => ({
        ...prev,
        [messageId]: mergeArtifacts(prev[messageId], [artifact]),
      }));

      if (artifact.status === "pending") {
        showToast("success", "图解已进入后台生成，完成后自动打开");
        for (let index = 0; index < ARTIFACT_POLL_LIMIT && artifact.status === "pending"; index += 1) {
          await wait(ARTIFACT_POLL_INTERVAL_MS);
          const pollRes = await api.get<ApiResponse<ChatArtifact>>(`/chat/artifacts/${encodeURIComponent(artifact.id)}`);
          artifact = pollRes.data;
          setGeneratedArtifacts((prev) => ({
            ...prev,
            [messageId]: mergeArtifacts(prev[messageId], [artifact]),
          }));
        }
      }

      if (artifact.status === "ready") {
        setDiagramStates((prev) => ({
          ...prev,
          [key]: { loading: false, data: artifact },
        }));
        setActiveArtifact(artifact);
        return;
      }

      const message = artifact.status === "failed" ? artifact.reason || "图解生成失败" : "图解仍在生成中，可稍后再查看";
      setDiagramStates((prev) => ({
        ...prev,
        [key]: { loading: false, data: artifact, error: message },
      }));
      showToast(artifact.status === "failed" ? "error" : "success", message);
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
