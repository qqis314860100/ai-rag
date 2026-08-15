import { Menu, PanelRightOpen } from "lucide-react";

interface ChatHeaderProps {
  activeTitle: string;
  streamLoading: boolean;
  historyCollapsed: boolean;
  rightPanelOpen: boolean;
  onToggleHistory: () => void;
  onToggleRightPanel: () => void;
}

export default function ChatHeader({
  activeTitle,
  streamLoading,
  historyCollapsed,
  rightPanelOpen,
  onToggleHistory,
  onToggleRightPanel,
}: ChatHeaderProps) {
  return (
    <header className="shrink-0 flex items-center gap-3 h-[57px] px-4 border-b border-divider bg-white">
      <button
        onClick={onToggleHistory}
        className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
        title={historyCollapsed ? "展开会话历史" : "切换会话历史"}
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex-1 min-w-0 text-center">
        {activeTitle && (
          <span className="text-sm font-medium text-text truncate block">{activeTitle}</span>
        )}
      </div>

      <span
        className={`w-14 shrink-0 text-right text-xs text-accent transition-opacity duration-fast ${
          streamLoading ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden={!streamLoading}
      >
        生成中...
      </span>

      <button
        onClick={onToggleRightPanel}
        className={`p-1.5 rounded-lg transition-colors shrink-0 ${
          rightPanelOpen
            ? "text-accent bg-accent-soft"
            : "text-text-muted hover:text-text hover:bg-surface-hover"
        }`}
        title={rightPanelOpen ? "关闭会话导航" : "打开会话导航"}
      >
        <PanelRightOpen className="h-5 w-5" />
      </button>
    </header>
  );
}
