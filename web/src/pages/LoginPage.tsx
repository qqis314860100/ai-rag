import { useState, type FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";
import { BatteryFull, LogIn } from "lucide-react";

export default function LoginPage() {
  const { login, loading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await login(username, password);
    } catch {
      setError("用户名或密码错误");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-page p-6">
      <div className="glass rounded-2xl shadow-lg-soft p-8 w-full max-w-sm animate-scale-in">
        <div className="flex flex-col items-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white shadow-sm mb-3">
            <BatteryFull className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-text tracking-tight">电池产线知识库</h1>
          <p className="text-sm text-text-muted mt-1">企业内部知识管理平台</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5" htmlFor="username">用户名</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-page px-4 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              placeholder="输入用户名"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5" htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-page px-4 py-2.5 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
              placeholder="输入密码"
            />
          </div>

          {error && (
            <p className="text-xs text-danger bg-danger-soft rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full rounded-xl bg-primary text-white py-2.5 text-sm font-medium hover:bg-primary-hover disabled:opacity-40 transition-all duration-fast active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <LogIn className="h-4 w-4" />
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <p className="text-xs text-text-muted text-center mt-6">
          预置账号: admin/admin123 · editor/editor123 · viewer/viewer123
        </p>
      </div>
    </div>
  );
}
