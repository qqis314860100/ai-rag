import { useState, useEffect } from "react";
import { FileText, MessageSquare, CheckCircle, TrendingUp, Activity, ThumbsUp, Search, Users, Eye } from "lucide-react";
import { api } from "../services/api";

interface DashData { documents: { total: number; indexed: number; processing: number; failed: number }; sessions: { total: number; today: number }; messages: { total: number }; feedback: { up: number; down: number; open: number }; categories: Array<{ category: string; count: number }>; recentSessions: Array<{ id: string; title: string; user_name: string; updated_at: string }>; popularQueries: Array<{ query: string; time: string }>; }
function MiniBar({ pct, color = "var(--color-accent)" }: { pct: number; color?: string }) { return <div className="flex-1 h-6 rounded-md bg-border overflow-hidden"><div className="h-full rounded-md transition-all duration-700 flex items-center justify-end pr-2" style={{ width: `${Math.max(pct*100, 5)}%`, minWidth: "24px", background: color }}><span className="text-xs font-semibold text-white">{Math.round(pct*100)}%</span></div></div>; }
function MiniSpark({ data }: { data: number[] }) { const max = Math.max(...data, 1); const min = Math.min(...data, 0); const range = max - min || 1; const h = 28; const w = data.length > 1 ? 100 : 1; const pts = data.map((v,i) => `${(i/(data.length-1))*w},${h - ((v-min)/range)*h}`).join(" "); return <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx={(data.length-1)*(w/(data.length-1))} cy={h - ((data[data.length-1]-min)/range)*h} r="3" fill="var(--color-accent)"/></svg>; }

export default function DashboardPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get<{ data: DashData }>("/stats/dashboard").then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="p-6 space-y-6"><div className="skeleton h-8 w-48 rounded-lg" /><div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">{[1,2,3,4,5,6].map(i=><div key={i} className="skeleton h-24 rounded-xl" />)}</div><div className="grid grid-cols-1 lg:grid-cols-3 gap-5">{[1,2,3].map(i=><div key={i} className="skeleton h-48 rounded-xl" />)}</div></div>;
  if (!data) return <div className="flex items-center justify-center h-full text-text-muted text-sm">加载失败</div>;
  const { documents, sessions, messages, feedback, categories, recentSessions, popularQueries } = data;
  const maxCat = Math.max(1, ...categories.map(e => e[1]||0));

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-text tracking-tight">概览</h1><p className="mt-1 text-sm text-text-secondary">{documents.total} 文档 · {sessions.total} 会话 · {messages.total} 消息</p></div></div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger">
        {[ { icon: FileText, label: "文档", v: documents.total, sub: `${documents.indexed} 已索引` }, { icon: TrendingUp, label: "今日会话", v: sessions.today, sub: `共 ${sessions.total}`, trend: sessions.total > 0 ? [Math.max(0,sessions.today-3), Math.max(0,sessions.today-2), Math.max(0,sessions.today-1), sessions.today] : undefined }, { icon: MessageSquare, label: "消息", v: messages.total, sub: "条", trend: [Math.max(0,messages.total-8), Math.max(0,messages.total-5), Math.max(0,messages.total-2), messages.total] }, { icon: ThumbsUp, label: "点赞", v: feedback.up, sub: `${feedback.down} 踩` }, { icon: Activity, label: "索引率", v: `${documents.total > 0 ? Math.round(documents.indexed/documents.total*100) : 0}%`, sub: `${documents.processing} 处理中` }, { icon: Users, label: "活跃会话", v: sessions.today, sub: "今日" }, ].map(({ icon: Icon, label, v, sub, trend }, i) => (
          <div key={label} className="animate-fade-in-up glass rounded-xl p-4 shadow-sm-soft hover-lift cursor-default" style={{ animationDelay: `${i*40}ms` }}>
            <div className="flex items-center justify-between mb-1.5"><Icon className="h-4 w-4 text-accent" /><span className="text-xs text-text-muted">{label}</span></div>
            <p className="text-2xl font-bold text-text">{v||"-"}</p>
            <p className="text-[11px] text-text-muted mt-0.5">{sub}</p>
            {trend && <div className="mt-2"><MiniSpark data={trend} /></div>}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-accent" />文档分类</h2>
          {categories.length === 0 ? <p className="text-sm text-text-muted py-4 text-center">暂无</p> : <div className="space-y-2"> {categories.map(({ category, count }) => <div key={category} className="flex items-center gap-2"><span className="text-xs text-text-secondary w-16 truncate">{category||"未分类"}</span><MiniBar pct={count/maxCat} /><span className="text-xs font-medium text-text w-8 text-right">{count}</span></div>)} </div>}
        </div>
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2"><Search className="h-4 w-4 text-accent" />热门查询</h2>
          {popularQueries.length === 0 ? <p className="text-sm text-text-muted py-4 text-center">暂无</p> : <div className="space-y-1"> {popularQueries.slice(0, 8).map((q, i) => <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors"><span className="text-sm text-text-secondary truncate">{q.query}</span><span className="text-xs text-text-muted ml-2">{q.time?.substring(11,16)||""}</span></div>)} </div>}
        </div>
        <div className="glass rounded-xl p-5 shadow-sm-soft">
          <h2 className="text-sm font-semibold text-text mb-3 flex items-center gap-2"><Eye className="h-4 w-4 text-accent" />最近会话</h2>
          {recentSessions.length === 0 ? <p className="text-sm text-text-muted py-4 text-center">暂无</p> : <div className="space-y-1"> {recentSessions.slice(0, 8).map(s => <a key={s.id} href="/chat" className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors text-sm group"><span className="text-text-secondary truncate group-hover:text-text">{s.title||"新会话"}</span><span className="text-xs text-text-muted ml-2 shrink-0">{(s.updated_at||"").substring(5,10)}</span></a>)} </div>}
        </div>
      </div>
    </div>
  );
}
