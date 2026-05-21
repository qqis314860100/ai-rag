import { Battery, Settings, LogOut, User } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

export default function TopNav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-divider bg-surface px-6 shrink-0">
      <Link to="/" className="flex items-center gap-2 text-primary hover:text-primary-hover transition-colors">
        <Battery className="h-5 w-5 text-accent" />
        <span className="font-semibold text-sm tracking-tight">电池产线知识库</span>
      </Link>

      <div className="flex items-center gap-1">
        {user && (
          <span className="text-xs text-text-muted mr-2 flex items-center gap-1">
            <User className="h-3 w-3" />
            {user.name}
          </span>
        )}
        <Link to="/settings" className="rounded-lg p-2 text-text-secondary hover:bg-surface-hover hover:text-text transition-colors" aria-label="设置">
          <Settings className="h-4 w-4" />
        </Link>
        <button
          onClick={handleLogout}
          className="rounded-lg p-2 text-text-muted hover:bg-danger-soft hover:text-danger transition-colors"
          aria-label="退出登录"
          title="退出登录"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
