import { useState } from "react";
import { MessageSquare, Trash2, Plus, History, X } from "lucide-react";
import type { ChatSession } from "../../types";
import { showToast } from "../ui/Toast";

interface Props {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function SessionList({ sessions, activeId, onSelect, onNew, onDelete }: Props) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-divider">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-text-muted" />
          <span className="text-sm font-semibold text-text">会话历史</span>
        </div>
        <button
          onClick={onNew}
          className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-accent transition-all duration-fast"
          title="新建会话"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {sessions.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center animate-fade-in">
            <MessageSquare className="h-8 w-8 text-text-muted/40 mb-2" />
            <p className="text-xs text-text-muted">暂无会话记录</p>
          </div>
        )}
        {sessions.map((s, i) => {
          const isActive = activeId === s.id;
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              style={{ animationDelay: `${Math.min(i * 30, 200)}ms` }}
              className={`animate-fade-in-left group flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-fast relative ${
                isActive
                  ? "bg-accent-light text-accent font-medium"
                  : "hover:bg-surface-hover text-text-secondary"
              }`}
            >
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full bg-accent" />}
              <MessageSquare size={14} className={`shrink-0 ${isActive ? "text-accent" : "text-text-muted"}`} />
              <span className="flex-1 truncate text-sm">{s.title || "新会话"}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                className="min-w-[28px] min-h-[28px] p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-danger-soft text-text-muted hover:text-danger transition-all flex items-center justify-center"
                title="删除会话"
                aria-label={`删除会话: ${s.title}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Delete Confirm Dialog */}
      {confirmDeleteId && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-50 animate-fade-in" onClick={() => setConfirmDeleteId(null)}>
          <div className="glass rounded-lg p-5 shadow-lg-soft mx-4 max-w-xs w-full animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-text">确认删除</p>
              <button onClick={() => setConfirmDeleteId(null)} className="p-1 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors" aria-label="取消">
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
