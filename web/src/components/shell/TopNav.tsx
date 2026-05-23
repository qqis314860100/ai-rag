import { Battery, Settings, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export default function TopNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const initials = (user?.name || "?").slice(0, 2).toUpperCase();

  return (
    <header className="flex h-[57px] items-center justify-between border-b border-divider bg-white px-5 shrink-0 flex-nowrap">
      <Link to="/chat" className="flex items-center gap-2.5 text-primary hover:text-primary-hover transition-colors">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
          <Battery className="h-3.5 w-3.5" />
        </div>
        <span className="font-semibold text-sm tracking-tight">电池产线知识库</span>
      </Link>

      <div className="flex items-center gap-2.5">
        {user && (
          <>
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-accent text-xs font-semibold shrink-0">
              {initials}
            </div>
            <span className="text-sm text-text-secondary">{user.name}</span>
            <span className="w-px h-5 bg-divider mx-1" />
          </>
        )}
        <Link to="/settings" className="rounded-lg p-2 text-text-secondary hover:bg-surface-hover hover:text-text transition-colors shrink-0" aria-label="设置">
          <Settings className="h-4 w-4" />
        </Link>
        <button onClick={() => { logout(); navigate("/login"); }} className="rounded-lg p-2 text-text-muted hover:bg-danger-soft hover:text-danger transition-colors shrink-0" aria-label="退出登录">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
