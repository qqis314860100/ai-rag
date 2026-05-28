import { useCallback, useEffect, useState } from "react";
import { showToast } from "../../../components/ui/Toast";
import { api } from "../../../services/api";
import type { ChatNote, ChatNoteAggregate, ChatNoteAggregateItem } from "../types";

export function useSessionNotes(activeSessionId: string | null) {
  const [sessionNotes, setSessionNotes] = useState<ChatNote[]>([]);
  const [noteAggregateItems, setNoteAggregateItems] = useState<ChatNoteAggregateItem[]>([]);
  const [sessionNotesLoading, setSessionNotesLoading] = useState(false);

  useEffect(() => {
    let active = true;

    if (!activeSessionId) {
      setSessionNotes([]);
      setNoteAggregateItems([]);
      setSessionNotesLoading(false);
      return () => {
        active = false;
      };
    }

    setSessionNotesLoading(true);
    api.get<{ data: ChatNoteAggregate }>(`/chat/notes/aggregate?session_id=${encodeURIComponent(activeSessionId)}`)
      .then((res) => {
        if (!active) return;
        setSessionNotes(res.data.session_notes || []);
        setNoteAggregateItems(res.data.items || []);
      })
      .catch(() => {
        if (!active) return;
        setSessionNotes([]);
        setNoteAggregateItems([]);
      })
      .finally(() => {
        if (!active) return;
        setSessionNotesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeSessionId]);

  const createNote = useCallback(async (content: string) => {
    if (!activeSessionId || !content.trim()) return false;

    try {
      const res = await api.post<{ data: ChatNote }>("/chat/notes", {
        scope: "session",
        session_id: activeSessionId,
        content: content.trim(),
      });
      setSessionNotes((prev) => [res.data, ...prev]);
      showToast("success", "笔记已保存");
      return true;
    } catch {
      showToast("error", "添加笔记失败");
      return false;
    }
  }, [activeSessionId]);

  const updateNote = useCallback(async (noteId: string, content: string) => {
    if (!content.trim()) return false;

    try {
      const res = await api.patch<{ data: ChatNote }>(`/chat/notes/${encodeURIComponent(noteId)}`, {
        content: content.trim(),
      });
      setSessionNotes((prev) => prev.map((note) => (note.id === noteId ? res.data : note)));
      showToast("success", "笔记已更新");
      return true;
    } catch {
      showToast("error", "更新笔记失败");
      return false;
    }
  }, []);

  const deleteNote = useCallback(async (noteId: string) => {
    try {
      await api.delete(`/chat/notes/${encodeURIComponent(noteId)}`);
      setSessionNotes((prev) => prev.filter((note) => note.id !== noteId));
      showToast("success", "笔记已删除");
      return true;
    } catch {
      showToast("error", "删除笔记失败");
      return false;
    }
  }, []);

  return {
    sessionNotes,
    noteAggregateItems,
    sessionNotesLoading,
    createNote,
    updateNote,
    deleteNote,
  };
}
