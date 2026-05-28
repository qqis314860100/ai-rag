import type { RefObject } from "react";
import { Plus, X } from "lucide-react";
import type { ChatSession } from "../types";
import { SessionList } from "./SessionList";

interface ChatHistorySidebarProps {
  open: boolean;
  collapsed: boolean;
  sidebarRef: RefObject<HTMLDivElement | null>;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onClose: () => void;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void | Promise<void>;
}

export default function ChatHistorySidebar({
  open,
  collapsed,
  sidebarRef,
  sessions,
  activeSessionId,
  onClose,
  onNewSession,
  onSelectSession,
  onDeleteSession,
}: ChatHistorySidebarProps) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={onClose} />
      )}
      <aside
        ref={sidebarRef}
        className={`shrink-0 overflow-hidden border-r border-divider bg-surface-page flex flex-col transition-[width,transform] duration-slow ease-out z-40
          max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-lg
          ${collapsed ? "lg:w-0 lg:border-r-0" : "lg:w-[260px]"}
          ${open ? "max-lg:translate-x-0 max-lg:w-[260px]" : "max-lg:-translate-x-full max-lg:w-[260px]"}`}
      >
        <div className="w-[260px] flex h-full flex-col">
          <div className="flex items-center justify-between px-4 h-[57px] shrink-0">
            <span className="text-sm font-semibold text-text">会话历史</span>
            <div className="flex items-center gap-1">
              <button onClick={onNewSession} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors" title="新建会话">
                <Plus className="h-4 w-4" />
              </button>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors lg:hidden">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SessionList
              sessions={sessions}
              activeId={activeSessionId}
              onSelect={onSelectSession}
              onDelete={onDeleteSession}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
