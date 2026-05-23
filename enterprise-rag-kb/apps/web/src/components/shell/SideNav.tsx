import { useState } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, MessageSquare, FileText, Search, Settings, BatteryFull, ChevronRight } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "仪表盘" },
  { to: "/chat", icon: MessageSquare, label: "智能问答" },
  { to: "/documents", icon: FileText, label: "文档管理" },
  { to: "/debugger", icon: Search, label: "检索调试" },
  { to: "/settings", icon: Settings, label: "系统设置" },
];

export default function SideNav() {
  const [expanded, setExpanded] = useState(false);

  return (
    <nav
      className="relative flex flex-col border-r border-divider bg-white shrink-0 transition-all duration-slow ease-out z-20"
      style={{ width: expanded ? 224 : 56 }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Brand */}
      <div className="flex items-center h-14 px-3 shrink-0" style={{ justifyContent: expanded ? "flex-start" : "center" }}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-sm">
          <BatteryFull className="h-4 w-4" />
        </div>
        {expanded && <span className="ml-2.5 text-sm font-bold text-text tracking-tight whitespace-nowrap">BatteryKB</span>}
      </div>

      <div className="flex-1 px-2 py-2 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `flex items-center rounded-lg transition-all duration-fast ${
                expanded ? "gap-3 px-3" : "justify-center"
              } py-2.5 text-sm font-medium ${
                isActive
                  ? "bg-white text-text shadow-sm-soft"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text"
              }`
            }
            title={!expanded ? label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {expanded && <span className="whitespace-nowrap truncate">{label}</span>}
          </NavLink>
        ))}
      </div>

      {/* Expand hint */}
      <div className="px-2 py-2 border-t border-divider">
        <div className={`flex items-center rounded-lg py-2 text-xs text-text-muted transition-all ${expanded ? "px-3" : "justify-center"}`}>
          <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded && <span className="ml-2">收起</span>}
        </div>
      </div>
    </nav>
  );
}
