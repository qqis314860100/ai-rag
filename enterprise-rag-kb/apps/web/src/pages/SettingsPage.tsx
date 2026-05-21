import { useState, useEffect } from "react";
import { Save, Server, Cpu, Database, SlidersHorizontal } from "lucide-react";
import { api } from "../services/api";
import { showToast } from "../components/ui/Toast";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ data: Array<{ key: string; value: string }> }>("/admin/settings").then((res) => {
      const map: Record<string, string> = {};
      res.data?.forEach?.((s: { key: string; value: string }) => { map[s.key] = s.value; });
      setSettings(map);
    }).catch(() => {});
  }, []);

  const handleSave = async (key: string, value: string) => {
    setSaving(true);
    try {
      await api.patch("/admin/settings", { key, value });
      showToast("success", "设置已保存");
    } catch {
      showToast("error", "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const configs = [
    { key: "rag_top_k", label: "默认 TopK", icon: SlidersHorizontal, desc: "检索返回的最大结果数" },
    { key: "rag_temperature", label: "模型温度", icon: Cpu, desc: "LLM 生成温度 (0-1)" },
    { key: "rag_max_context_chars", label: "上下文字符数", icon: Database, desc: "RAG 注入的最大上下文字符" },
    { key: "embedding_model", label: "Embedding 模型", icon: Server, desc: "当前: fallback (384-dim hash)" },
  ];

  return (
    <div className="p-6 space-y-8 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-text tracking-tight">系统设置</h1>
        <p className="mt-1 text-sm text-text-secondary">RAG 参数配置，修改后立即生效</p>
      </div>

      <div className="space-y-3">
        {configs.map(({ key, label, icon: Icon, desc }) => (
          <div key={key} className="glass rounded-xl p-5 shadow-sm-soft">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-sm font-medium text-text">{label}</label>
                <p className="text-xs text-text-muted mt-0.5">{desc}</p>
                <div className="flex items-center gap-2 mt-3">
                  <input
                    value={settings[key] || ""}
                    onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
                    className="flex-1 rounded-lg border border-border bg-surface-page px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                  <button
                    onClick={() => handleSave(key, settings[key])}
                    disabled={saving}
                    className="flex items-center gap-1.5 rounded-lg bg-primary text-white px-4 py-2 text-sm font-medium hover:bg-primary-hover disabled:opacity-40 transition-all active:scale-[0.97]"
                  >
                    <Save className="h-3.5 w-3.5" />
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
