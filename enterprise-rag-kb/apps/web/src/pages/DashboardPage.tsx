import { useState, useEffect } from "react";
import { FileText, MessageSquare, CheckCircle, TrendingUp, Activity, Layers, Clock, Zap, ThumbsUp, Search } from "lucide-react";
import { MetricCard } from "../components/ui";
import { api } from "../services/api";

interface DashData {
  documents: { total: number; indexed: number; processing: number; failed: number };
  sessions: { total: number; today: number };
  messages: { total: number };
  feedback: { up: number; down: number; open: number };
  categories: Array<{ category: string; count: number }>;
  recentSessions: Array<{ id: string; title: string; user_name: string; updated_at: string }>;
  popularQueries: Array<{ query: string; time: string }>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: DashData }>("/stats/dashboard")
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="skeleton h-8 w-32 rounded-lg" /></div>;
  if (!data) return <div className="flex items-center justify-center h-full text-text-muted text-sm">加载失败</div>;

  const { documents, sessions, messages, feedback, categories, recentSessions, popularQueries } = data;
  const maxCat = Math.max(1, ...categories.map(e => e[1] || 0));

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-text tracking-tight">概览</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {documents.total} 文档 · {sessions.total} 会话 · {messages.total} 消息 · {feedback.up + feedback.down} 反馈
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 stagger">
        {[
          { icon: FileText, label: "文档", value: documents.total, sub: `${documents.indexed} 已索引` },
          { icon: Layers, label: "处理中", value: documents.processing, sub: `${documents.failed} 失败` },
          { icon: MessageSquare, label: "今日会话", value: sessions.today, sub: `${sessions.total} 总计` },
          { icon: TrendingUp, label: "消息数", value: messages.total, sub: "条对话" },
          { icon: ThumbsUp, label: "点赞", value: feedback.up, sub: `${feedback.down} 踩` },
          { icon: Activity, label: "待处理", value: feedback.open, sub: "反馈" },
        ].map(({ icon: Icon, label, value, sub }, i) => (
          <div key={label} className="animate-fade-in-up" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="glass rounded-xl p-4 shadow-sm-soft hover-lift cursor-default">
              <Icon className="h-4 w-4 text-accent mb-2" />
              <p className="text-2xl font-bold text-text">{value || "-"}</p>
              <p className="text-xs text-text-muted mt-0.5">{label}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Distribution */}
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-accent" />文档分类</h2>
          {categories.length === 0 ? <p className="text-sm text-text-muted py-4 text-center">暂无</p> : (
            <div className="space-y-2">
              {categories.map(({ category, count }) => (
                <div key={category} className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary w-16 truncate">{category || "未分类"}</span>
                  <div className="flex-1 h-6 rounded-md bg-border overflow-hidden">
                    <div className="h-full rounded-md bg-accent transition-all duration-700 flex items-center justify-end pr-2" style={{ width: `${(count/maxCat)*100}%`, minWidth: count > 0 ? "28px" : "0" }}>
                      <span className="text-xs font-semibold text-white">{count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Popular Queries */}
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2"><Search className="h-4 w-4 text-accent" />热门查询</h2>
          {popularQueries.length === 0 ? <p className="text-sm text-text-muted py-4 text-center">暂无</p> : (
            <div className="space-y-1">
              {popularQueries.slice(0, 8).map((q, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors">
                  <span className="text-sm text-text-secondary truncate">{q.query}</span>
                  <span className="text-xs text-text-muted shrink-0 ml-2">{q.time?.substring(11, 16) || ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* System */}
        <div className="glass rounded-xl p-5 shadow-sm-soft space-y-3">
          <h2 className="text-sm font-semibold text-text flex items-center gap-2"><Zap className="h-4 w-4 text-accent" />系统状态</h2>
          {[
            { icon: Clock, l: "文档总数", v: documents.total },
            { icon: CheckCircle, l: "已索引", v: documents.indexed },
            { icon: Layers, l: "会话数", v: sessions.total },
            { icon: MessageSquare, l: "消息数", v: messages.total },
          ].map(({ icon: Icon, l, v }) => (
            <div key={l} className="flex items-center gap-2.5"><Icon className="h-3.5 w-3.5 text-text-muted shrink-0" /><span className="text-xs text-text-muted">{l}</span><span className="ml-auto text-xs font-medium text-text">{v || "-"}</span></div>
          ))}
        </div>

        {/* Recent Sessions */}
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2"><MessageSquare className="h-4 w-4 text-accent" />最近会话</h2>
          {recentSessions.length === 0 ? <p className="text-sm text-text-muted py-4 text-center">暂无</p> : (
            <div className="space-y-1">
              {recentSessions.slice(0, 6).map(s => (
                <a key={s.id} href="/chat" className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors text-sm group">
                  <div className="flex-1 min-w-0"><span className="text-text-secondary truncate group-hover:text-text">{s.title || "新会话"}</span><span className="text-xs text-text-muted ml-2">by {s.user_name || "-"}</span></div>
                  <span className="text-xs text-text-muted shrink-0 ml-2">{new Date(s.updated_at).toLocaleDateString("zh-CN")}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
