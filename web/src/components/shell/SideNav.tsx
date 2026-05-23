import { useState } from "react";
import { NavLink } from "react-router-dom";
import { MessageSquare, BookOpen, FileText, Star, BarChart3, Settings, BatteryFull, PanelLeftClose } from "lucide-react";

const primaryNav = [
  { to: "/chat", icon: MessageSquare, label: "聊天" },
  { to: "/analytics", icon: BarChart3, label: "统计看板" },
  { to: "/documents", icon: BookOpen, label: "知识库管理" },
  { to: "/sop", icon: FileText, label: "工艺SOP" },
];

const secondaryNav = [
  { to: "/favorites", icon: Star, label: "收藏" },
  { to: "/settings", icon: Settings, label: "系统设置" },
];

export default function SideNav() {
  const [expanded, setExpanded] = useState(true);

  return (
    <nav
      className="relative flex flex-col border-r border-divider bg-white shrink-0 transition-all duration-slow ease-out z-20"
      style={{ width: expanded ? 220 : 56 }}
    >
      {/* Brand */}
      <div className="flex items-center h-14 px-3 shrink-0" style={{ justifyContent: expanded ? "flex-start" : "center" }}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-sm">
          <BatteryFull className="h-4 w-4" />
        </div>
        <span className={`ml-2.5 text-sm font-bold text-text tracking-tight whitespace-nowrap transition-opacity duration-normal ${
          expanded ? "opacity-100 delay-100" : "opacity-0 w-0 overflow-hidden absolute"
        }`}>
          电池产线知识库
        </span>
      </div>

      {/* Primary nav */}
      <div className="flex-1 px-2 py-2 space-y-0.5">
        {primaryNav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to + label}
            to={to}
            end
            className={({ isActive }: { isActive: boolean }) =>
              `flex items-center rounded-lg transition-all duration-fast ${
                expanded ? "gap-3 px-3" : "justify-center"
              } py-2.5 text-sm font-medium ${
                isActive
                  ? "bg-accent-soft text-accent shadow-sm-soft"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text"
              }`
            }
            title={label}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className={`whitespace-nowrap truncate transition-opacity duration-normal ${expanded ? "opacity-100 delay-100" : "opacity-0 w-0 absolute"}`}>{label}</span>
          </NavLink>
        ))}

        {/* Divider */}
        <div className="my-2 border-t border-divider" />

        {secondaryNav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to + label}
            to={to}
            end={false}
            className={`flex items-center rounded-lg transition-all duration-fast ${
              expanded ? "gap-3 px-3" : "justify-center"
            } py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text`}
            title={label}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className={`whitespace-nowrap truncate transition-opacity duration-normal ${expanded ? "opacity-100 delay-100" : "opacity-0 w-0 absolute"}`}>{label}</span>
          </NavLink>
        ))}
      </div>

      {/* Collapse toggle */}
      <div className="px-2 py-2 border-t border-divider">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center rounded-lg py-2 text-xs text-text-muted hover:text-text hover:bg-surface-hover transition-all w-full ${
            expanded ? "px-3 gap-2" : "justify-center"
          }`}
          title={expanded ? "收起侧栏" : "展开侧栏"}
        >
          <PanelLeftClose className={`h-3.5 w-3.5 shrink-0 transition-transform ${!expanded ? "rotate-180" : ""}`} />
          <span className={`transition-opacity duration-normal ${expanded ? "opacity-100 delay-100" : "opacity-0 w-0 absolute"}`}>收起</span>
        </button>
      </div>
    </nav>
  );
}
