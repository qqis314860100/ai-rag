import { useState, useEffect } from "react";
import { Save, Server, Cpu, Database, SlidersHorizontal, Users, Check, AlertCircle } from "lucide-react";
import { api } from "../services/api";
import { showToast } from "../components/ui/Toast";

interface UserRow { id: string; name: string; email: string; role: string; status: string; created_at: string; }

const paramHelp: Record<string, string> = {
  rag_top_k: "每次检索返回的文档片段数量。值越大回答越全面但速度越慢。推荐 5。",
  rag_temperature: "LLM 生成温度 0-1。0=精准保守，1=富有创意。生产环境建议 0.2。",
  rag_max_context_chars: "注入 LLM 的上下文字符上限。超过会被截断。推荐 12000。",
  embedding_model: "将文本转为向量的模型。fallback 是轻量 Hash 模式，无需 GPU。",
};

const ROLE_OPTIONS = ["viewer", "operator", "process_engineer", "equipment_engineer", "quality_engineer", "knowledge_admin", "system_admin"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [initialSettings, setInitialSettings] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<UserRow[]>([]);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"rag" | "users">("rag");
  const [ragRuntime, setRagRuntime] = useState<Record<string, string>>({});
  const [pageLoading, setPageLoading] = useState(true);

  const loadSettings = () => {
    api.get<{ data: Array<{ key: string; value: string }> }>("/admin/settings").then(r => {
      const m: Record<string, string> = {};
      r.data?.forEach?.((s: any) => { m[s.key] = s.value; });
      setSettings(m); setInitialSettings(m);
    }).catch(() => {});
    api.get<{ data: UserRow[] }>("/users").then(r => setUsers(r.data || [])).catch(() => {}).finally(() => setPageLoading(false));
    // Get RAG runtime status (proxied through API to avoid CORS)
    fetch("/api/admin/health").then(r => r.json()).then(d => {
      const svc = d.data?.services || {};
      setRagRuntime({
        rag_status: svc.rag === "ok" ? "运行中" : "异常",
        api_status: svc.api === "ok" ? "运行中" : "异常",
        db_status: svc.database === "ok" ? "正常" : "异常",
      });
    }).catch(() => {});
  };

  useEffect(() => { loadSettings(); }, []);

  const handleSave = async (key: string, value: string) => {
    setSaving(s => ({ ...s, [key]: true }));
    try {
      await api.put("/admin/settings", { key, value });
      setSavedKeys(s => new Set(s).add(key));
      setInitialSettings(s => ({ ...s, [key]: value }));
      showToast("success", `"${key}" 已保存`);
      setTimeout(() => setSavedKeys(s => { const n = new Set(s); n.delete(key); return n; }), 3000);
    } catch {
      showToast("error", "保存失败");
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await api.put(`/users/${userId}`, { role });
      showToast("success", "角色已更新");
      api.get<{ data: UserRow[] }>("/users").then(r => setUsers(r.data || [])).catch(() => {});
    } catch { showToast("error", "更新失败"); }
  };

  const isModified = (key: string) => settings[key] !== initialSettings[key];

  if (pageLoading) return <div className="p-6 space-y-6"><div className="skeleton h-8 w-40 rounded-lg" /><div className="space-y-4">{[1,2,3,4].map(i=><div key={i} className="skeleton h-20 rounded-xl" />)}</div></div>;

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold text-text tracking-tight">系统设置</h1>
        <p className="mt-1 text-sm text-text-secondary">RAG 参数 ＋ 用户管理</p>
      </div>

      <div className="flex gap-2 border-b border-divider pb-3">
        {[
          { id: "rag", label: "RAG 参数", icon: SlidersHorizontal },
          { id: "users", label: "用户管理", icon: Users },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === t.id ? "bg-accent text-white shadow-sm" : "text-text-secondary hover:bg-surface-hover"
            }`}
          >
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {activeTab === "rag" ? (
        <div className="space-y-4">
          {/* Runtime banner */}
          {ragRuntime.rag_status && (
            <div className="flex items-start gap-2 rounded-xl bg-info-soft border border-info/20 px-4 py-3 text-sm">
              <AlertCircle className="h-4 w-4 text-info shrink-0 mt-0.5" />
              <div>
                <p className="text-text font-medium">服务状态</p>
                <p className="text-text-secondary text-xs mt-0.5">
                  RAG: <code className="bg-surface px-1 rounded">{ragRuntime.rag_status}</code>
                  {" · "}API: <code className="bg-surface px-1 rounded">{ragRuntime.api_status}</code>
                  {" · "}DB: <code className="bg-surface px-1 rounded">{ragRuntime.db_status}</code>
                </p>
                <p className="text-text-muted text-xs mt-1">以下设置保存到数据库。重启 RAG 服务后生效。</p>
              </div>
            </div>
          )}

          {[{ key: "rag_top_k", label: "检索 TopK", icon: SlidersHorizontal },
            { key: "rag_temperature", label: "模型温度", icon: Cpu },
            { key: "rag_max_context_chars", label: "上下文字符", icon: Database },
            { key: "embedding_model", label: "Embedding 模型", icon: Server },
          ].map(({ key, label, icon: Icon }) => (
            <div key={key} className={`glass rounded-xl p-5 shadow-sm-soft transition-all ${isModified(key) ? "ring-2 ring-warning/30" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-text">{label}</label>
                    <code className="text-[10px] text-text-muted bg-surface-page px-1.5 py-0.5 rounded">{key}</code>
                    {savedKeys.has(key) && (
                      <span className="inline-flex items-center gap-1 text-xs text-success"><Check className="h-3 w-3" />已保存</span>
                    )}
                    {isModified(key) && (
                      <span className="inline-flex items-center gap-1 text-xs text-warning">未保存</span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-1 leading-relaxed">{paramHelp[key]}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <input
                      value={settings[key] || ""}
                      onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                      className={`flex-1 rounded-lg border bg-surface-page px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 ${isModified(key) ? "border-warning" : "border-border"}`}
                    />
                    <button
                      onClick={() => handleSave(key, settings[key])}
                      disabled={saving[key] || !isModified(key)}
                      className="flex items-center gap-1.5 rounded-lg bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-40 transition-all active:scale-[0.97]"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {saving[key] ? "保存中" : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass rounded-xl shadow-sm-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-divider bg-surface-page/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">用户</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">邮箱</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">角色</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">状态</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">创建</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-divider hover:bg-surface-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-text">{u.name}</td>
                    <td className="px-4 py-3 text-text-secondary">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={e => handleRoleChange(u.id, e.target.value)}
                        className="rounded-lg border border-border bg-surface-page px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-accent/20"
                      >
                        {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ${u.status === 'active' ? 'bg-success-soft text-success' : 'bg-text-muted/10 text-text-muted'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${u.status === 'active' ? 'bg-success' : 'bg-text-muted'}`} />
                        {u.status === 'active' ? '活跃' : '停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">{u.created_at?.substring(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
