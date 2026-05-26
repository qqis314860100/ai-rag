import { useState } from "react";
import { MessageSquare, Trash2, X } from "lucide-react";
import type { ChatSession } from "../types";
import { showToast } from "../../../components/ui/Toast";

interface Props {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SessionList({ sessions, activeId, onSelect, onDelete }: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeSessions = sessions.filter((s) => s.id === activeId);
  const otherSessions = sessions.filter((s) => s.id !== activeId);

  return (
    <div className="flex flex-col h-full p-2 space-y-4">
      {activeSessions.length > 0 && (
        <div>
          <div className="px-3 py-1 text-[11px] font-medium text-text-muted uppercase tracking-wider">当前</div>
          <div className="mt-0.5 space-y-0.5">
            {activeSessions.map((s) => (
              <SessionItem key={s.id} session={s} isActive={true} onSelect={onSelect} setConfirmDeleteId={setConfirmDeleteId} />
            ))}
          </div>
        </div>
      )}

      {otherSessions.length > 0 && (
        <div>
          <div className="px-3 py-1 text-[11px] font-medium text-text-muted uppercase tracking-wider">历史</div>
          <div className="mt-0.5 space-y-0.5">
            {otherSessions.slice(0, 20).map((s) => (
              <SessionItem key={s.id} session={s} isActive={false} onSelect={onSelect} setConfirmDeleteId={setConfirmDeleteId} />
            ))}
          </div>
        </div>
      )}

      {sessions.length === 0 && (
        <div className="flex flex-col items-center py-10 text-center">
          <MessageSquare className="h-8 w-8 text-text-muted/30 mb-2" />
          <p className="text-xs text-text-muted">暂无会话记录</p>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {confirmDeleteId && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-50 animate-fade-in" onClick={() => setConfirmDeleteId(null)}>
          <div className="glass rounded-xl p-5 shadow-lg-soft mx-4 max-w-xs w-full animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-text">确认删除</p>
              <button onClick={() => setConfirmDeleteId(null)} className="p-1 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-text-secondary mb-4">删除后不可恢复，确定要删除这个会话吗？</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDeleteId(null)} className="px-4 py-2 rounded-xl text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors">取消</button>
              <button onClick={() => { onDelete(confirmDeleteId); setConfirmDeleteId(null); showToast("success", "会话已删除"); }} className="px-4 py-2 rounded-xl text-sm font-medium bg-danger text-white hover:opacity-90 transition-opacity">确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionItem({ session, isActive, onSelect, setConfirmDeleteId }: {
  session: ChatSession;
  isActive: boolean;
  onSelect: (id: string) => void;
  setConfirmDeleteId: (id: string | null) => void;
}) {
  return (
    <div
      onClick={() => onSelect(session.id)}
      className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all duration-fast text-sm ${
        isActive
          ? "bg-primary-soft text-primary font-medium"
          : "text-text-secondary hover:bg-surface-hover hover:text-text"
      }`}
    >
      <MessageSquare size={14} className={`shrink-0 ${isActive ? "text-primary" : "text-text-muted"}`} />
      <span className="flex-1 truncate">{session.title || "新会话"}</span>
      <button
        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(session.id); }}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:text-danger transition-all"
        title="删除会话"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
