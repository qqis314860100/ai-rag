import { useState, useEffect } from "react";
import { BarChart3, TrendingUp, MessageSquare, FileText, Activity, Users, ThumbsUp, ThumbsDown } from "lucide-react";
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

function StatCard({ icon: Icon, label, value, sub, color = "var(--color-accent)" }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="glass rounded-xl p-5 shadow-sm-soft">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `${color}18` }}>
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
        <span className="text-sm font-medium text-text-secondary">{label}</span>
      </div>
      <p className="text-3xl font-bold text-text">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  );
}

function ProgressBar({ label, value, max, color = "var(--color-accent)" }: {
  label: string; value: number; max: number; color?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-text-secondary w-20 truncate">{label}</span>
      <div className="flex-1 h-7 rounded-md bg-border overflow-hidden">
        <div className="h-full rounded-md flex items-center justify-end pr-2 transition-all duration-700" style={{ width: `${Math.max(pct, 2)}%`, background: color }}>
          <span className="text-xs font-semibold text-white">{value}</span>
        </div>
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: DashData }>("/stats/dashboard")
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="skeleton h-8 w-48 rounded-lg" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="skeleton h-32 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1,2].map(i => <div key={i} className="skeleton h-64 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">数据加载失败</div>
    );
  }

  const { documents, sessions, messages, feedback, categories, popularQueries, recentSessions } = data;
  const maxCat = Math.max(1, ...categories.map(e => e.count || 0));
  const indexRate = documents.total > 0 ? Math.round((documents.indexed / documents.total) * 100) : 0;

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div>
        <h1 className="text-2xl font-semibold text-text">数据统计</h1>
        <p className="mt-1 text-sm text-text-secondary">知识库运行数据概览与趋势分析</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
        <div className="animate-fade-in-up" style={{ animationDelay: "0ms" }}>
          <StatCard icon={FileText} label="文档总数" value={documents.total} sub={`${documents.indexed} 已索引 · ${documents.processing} 处理中`} color="var(--color-accent)" />
        </div>
        <div className="animate-fade-in-up" style={{ animationDelay: "40ms" }}>
          <StatCard icon={MessageSquare} label="消息总数" value={messages.total} sub={`${sessions.total} 会话 · ${sessions.today} 今日`} color="#6366f1" />
        </div>
        <div className="animate-fade-in-up" style={{ animationDelay: "80ms" }}>
          <StatCard icon={Activity} label="索引率" value={`${indexRate}%`} sub={indexRate >= 95 ? "健康" : indexRate >= 80 ? "需关注" : "异常"} color={indexRate >= 95 ? "#22c55e" : indexRate >= 80 ? "#f59e0b" : "#ef4444"} />
        </div>
        <div className="animate-fade-in-up" style={{ animationDelay: "120ms" }}>
          <StatCard icon={Users} label="今日活跃" value={sessions.today} sub={`反馈: ${feedback.up}赞 ${feedback.down}踩`} color="#8b5cf6" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Category Distribution */}
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-accent" /> 文档分类分布
          </h2>
          {categories.length === 0 ? (
            <p className="text-sm text-text-muted py-6 text-center">暂无数据</p>
          ) : (
            <div className="space-y-3">
              {categories.map(({ category, count }) => (
                <ProgressBar key={category} label={category || "未分类"} value={count} max={maxCat} />
              ))}
            </div>
          )}
        </div>

        {/* Popular Queries */}
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-accent" /> 热门查询 Top 8
          </h2>
          {popularQueries.length === 0 ? (
            <p className="text-sm text-text-muted py-6 text-center">暂无数据</p>
          ) : (
            <div className="space-y-1">
              {popularQueries.slice(0, 8).map((q, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors">
                  <span className="text-xs font-semibold text-text-muted w-5">{i + 1}</span>
                  <span className="text-sm text-text-secondary flex-1 truncate">{q.query}</span>
                  <span className="text-xs text-text-muted">{q.time?.substring(11, 16) || ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Feedback Ratio */}
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <ThumbsUp className="h-4 w-4 text-accent" /> 用户反馈
          </h2>
          <div className="flex items-center gap-8 py-4">
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
                <ThumbsUp className="h-7 w-7 text-green-500" />
              </div>
              <span className="text-2xl font-bold text-text">{feedback.up}</span>
              <span className="text-xs text-text-muted">好评</span>
            </div>
            <div className="flex-1 h-3 rounded-full bg-border overflow-hidden">
              <div className="h-full rounded-full bg-green-400 transition-all" style={{ width: `${feedback.up + feedback.down > 0 ? Math.round((feedback.up / (feedback.up + feedback.down)) * 100) : 50}%` }} />
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                <ThumbsDown className="h-7 w-7 text-red-400" />
              </div>
              <span className="text-2xl font-bold text-text">{feedback.down}</span>
              <span className="text-xs text-text-muted">差评</span>
            </div>
          </div>
          <p className="text-xs text-text-muted text-center mt-2">
            {feedback.up + feedback.down > 0
              ? `好评率 ${Math.round((feedback.up / (feedback.up + feedback.down)) * 100)}%`
              : "暂无反馈数据"}
          </p>
        </div>

        {/* Recent Sessions */}
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-accent" /> 最近会话
          </h2>
          {recentSessions.length === 0 ? (
            <p className="text-sm text-text-muted py-6 text-center">暂无数据</p>
          ) : (
            <div className="space-y-1">
              {recentSessions.slice(0, 8).map((s) => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors">
                  <span className="text-sm text-text-secondary truncate">{s.title || "新会话"}</span>
                  <span className="text-xs text-text-muted ml-2 shrink-0">{s.user_name || ""} · {(s.updated_at || "").substring(5, 10)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
