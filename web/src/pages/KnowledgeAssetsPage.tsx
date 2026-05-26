import { useEffect, useMemo, useState } from "react";
import {
  BookMarked,
  CircleHelp,
  FileSearch,
  GitBranch,
  Layers3,
  Link2,
  Loader2,
  Network,
  Search,
  Tags,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/ui";
import { api } from "../services/api";
import type { ApiResponse, Document, PaginatedResponse } from "../types";

type AssetKind = "term" | "card" | "faq" | "topic";
type AssetStatus = "ai_draft" | "pending_review" | "returned" | "published" | "archived";

interface KnowledgeAsset {
  id: string;
  kind: AssetKind;
  title: string;
  summary: string;
  subtitle?: string;
  status?: AssetStatus;
  aliases?: string[];
  related_terms?: string[];
  related_topics?: string[];
  backlinks?: Array<{ id: string; title: string; kind: AssetKind; summary?: string }>;
  source_refs?: Array<{ document_id?: string; chunk_id?: string; title?: string }>;
  updated_at?: string;
}

const tabs: Array<{ key: AssetKind | "all"; label: string; icon: typeof Tags }> = [
  { key: "all", label: "全部", icon: Layers3 },
  { key: "term", label: "术语库", icon: Tags },
  { key: "card", label: "知识卡", icon: BookMarked },
  { key: "faq", label: "FAQ", icon: CircleHelp },
  { key: "topic", label: "相关主题", icon: Network },
];

const statusLabels: Record<AssetStatus, string> = {
  ai_draft: "AI 草稿",
  pending_review: "待审核",
  returned: "已退回",
  published: "已发布",
  archived: "已归档",
};

const contractCards = [
  { label: "术语库", description: "展示术语、别名、定义、来源证据和引用关系。", icon: Tags },
  { label: "知识卡", description: "展示审核后的主题摘要、关键参数、步骤、风险和处理方法。", icon: BookMarked },
  { label: "FAQ", description: "展示高频问题、优质回答、适用范围、失效条件和关联知识卡。", icon: CircleHelp },
  { label: "关系网络", description: "展示主题、设备、参数、流程、文档、FAQ 和知识卡之间的连接。", icon: Network },
];

function assetKindLabel(kind: AssetKind) {
  return tabs.find((tab) => tab.key === kind)?.label || "知识资产";
}

function statusClass(status?: AssetStatus) {
  if (status === "published") return "bg-success-soft text-success";
  if (status === "pending_review" || status === "ai_draft") return "bg-warning-soft text-warning";
  if (status === "returned") return "bg-danger-soft text-danger";
  return "bg-surface-page text-text-muted";
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function matchesDocument(doc: Document, asset: KnowledgeAsset) {
  const refs = asset.source_refs || [];
  if (refs.some((ref) => ref.document_id === doc.id)) return true;

  const keywords = [asset.title, ...(asset.related_terms || []), ...(asset.aliases || [])].map(normalize).filter(Boolean);
  const haystack = normalize([doc.title, doc.category, doc.process, doc.station, ...(doc.tags || [])].filter(Boolean).join(" "));
  return keywords.some((keyword) => keyword.length >= 2 && haystack.includes(keyword));
}

function formatDate(value?: string) {
  if (!value) return "暂无更新时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function KnowledgeAssetsPage() {
  const [activeKind, setActiveKind] = useState<AssetKind | "all">("all");
  const [keyword, setKeyword] = useState("");
  const [assets] = useState<KnowledgeAsset[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    setDocumentsLoading(true);
    api.get<ApiResponse<PaginatedResponse<Document>>>("/documents?page=1&page_size=80")
      .then((res) => {
        if (mounted) setDocuments(res.data.items || []);
      })
      .catch(() => {
        if (mounted) setDocuments([]);
      })
      .finally(() => {
        if (mounted) setDocumentsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedAsset = useMemo(() => {
    return assets.find((asset) => asset.id === selectedId) || assets[0] || null;
  }, [assets, selectedId]);

  const sourceDocs = useMemo(() => {
    if (!selectedAsset) return documents.slice(0, 8);
    return documents.filter((doc) => matchesDocument(doc, selectedAsset)).slice(0, 8);
  }, [documents, selectedAsset]);

  const counts = useMemo(() => {
    return assets.reduce<Record<AssetKind | "all", number>>(
      (acc, asset) => {
        acc.all += 1;
        acc[asset.kind] += 1;
        return acc;
      },
      { all: 0, term: 0, card: 0, faq: 0, topic: 0 }
    );
  }, [assets]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-page">
      <header className="shrink-0 border-b border-divider bg-white px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-border bg-surface-page px-2.5 py-1 text-[11px] font-semibold text-text-secondary">
              <Layers3 className="h-3.5 w-3.5 text-accent" />
              知识资产
            </div>
            <h1 className="text-2xl font-semibold text-text">知识资产浏览</h1>
            <p className="mt-1 text-sm text-text-secondary">
              浏览术语、知识卡、FAQ、主题关系、反向引用和来源文档；对话问答仍是默认主入口
            </p>
          </div>

          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索知识资产"
              className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-9 text-sm text-text shadow-sm-soft focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
            {keyword && (
              <button
                onClick={() => setKeyword("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text"
                title="清空"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveKind(key)}
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${
                activeKind === key
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border bg-white text-text-secondary hover:bg-surface-hover hover:text-text"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className="rounded bg-white/70 px-1.5 py-0.5 text-[11px]">{counts[key] || 0}</span>
            </button>
          ))}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(360px,500px)_1fr]">
        <section className="min-h-0 overflow-y-auto border-r border-divider bg-white p-4">
          {assets.length > 0 ? (
            <div className="space-y-2">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => setSelectedId(asset.id)}
                  className={`w-full rounded-lg border p-4 text-left transition-all ${
                    selectedAsset?.id === asset.id
                      ? "border-accent bg-accent-soft/70 shadow-sm-soft"
                      : "border-border bg-surface hover:border-border-hover hover:bg-surface-page"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-surface-page px-2 py-1 text-[11px] font-semibold text-text-secondary">
                          {assetKindLabel(asset.kind)}
                        </span>
                        {asset.status && (
                          <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${statusClass(asset.status)}`}>
                            {statusLabels[asset.status]}
                          </span>
                        )}
                      </div>
                      <h2 className="truncate text-sm font-semibold text-text">{asset.title}</h2>
                      {asset.subtitle && <p className="mt-0.5 truncate text-xs text-text-muted">{asset.subtitle}</p>}
                    </div>
                    <span className="shrink-0 text-[11px] text-text-muted">{formatDate(asset.updated_at)}</span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-text-secondary">{asset.summary}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <EmptyState
                title="知识资产数据尚未接入"
                description="前端入口已就绪，等待 API 暴露术语、知识卡、FAQ 和主题关系数据；当前不会在前端编造假数据。"
              />
              <div className="grid gap-2">
                {contractCards.map(({ label, description, icon: Icon }) => (
                  <div key={label} className="rounded-lg border border-border bg-surface-page p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-text">
                      <Icon className="h-4 w-4 text-accent" />
                      {label}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto p-5">
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-lg border border-border bg-white p-5 shadow-sm-soft">
              {selectedAsset ? (
                <>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent">
                          {assetKindLabel(selectedAsset.kind)}
                        </span>
                        {selectedAsset.status && (
                          <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${statusClass(selectedAsset.status)}`}>
                            {statusLabels[selectedAsset.status]}
                          </span>
                        )}
                      </div>
                      <h2 className="text-xl font-semibold text-text">{selectedAsset.title}</h2>
                      {selectedAsset.subtitle && <p className="mt-1 text-sm text-text-muted">{selectedAsset.subtitle}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface-page px-3 py-2 text-xs text-text-secondary">
                      <GitBranch className="h-4 w-4 text-accent" />
                      {selectedAsset.backlinks?.length || 0} 条反向引用
                    </div>
                  </div>

                  <p className="mt-5 text-sm leading-relaxed text-text-secondary">{selectedAsset.summary}</p>

                  <div className="mt-6 grid gap-4 lg:grid-cols-2">
                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-text-muted">
                        <Tags className="h-3.5 w-3.5" />
                        术语与别名
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {[selectedAsset.title, ...(selectedAsset.aliases || []), ...(selectedAsset.related_terms || [])].map((term) => (
                          <span key={term} className="rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text-secondary">
                            {term}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-text-muted">
                        <Network className="h-3.5 w-3.5" />
                        相关主题
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {(selectedAsset.related_topics || []).map((topic) => (
                          <button
                            key={topic}
                            onClick={() => setKeyword(topic)}
                            className="rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text-secondary hover:border-accent hover:text-accent"
                          >
                            {topic}
                          </button>
                        ))}
                        {(selectedAsset.related_topics || []).length === 0 && (
                          <span className="text-xs text-text-muted">暂无关联主题</span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface-page p-6">
                  <h2 className="text-base font-semibold text-text">等待知识资产数据</h2>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    当前页面只负责浏览和渲染，不在前端编造术语、知识卡或 FAQ。后续 API 接入后，这里会展示真实资产详情、关系和引用证据。
                  </p>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <div className="rounded-lg border border-border bg-white p-4 shadow-sm-soft">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                  <Link2 className="h-4 w-4 text-accent" />
                  反向引用
                </h3>
                {selectedAsset?.backlinks?.length ? (
                  <div className="space-y-2">
                    {selectedAsset.backlinks.slice(0, 7).map((asset) => (
                      <button
                        key={asset.id}
                        onClick={() => setSelectedId(asset.id)}
                        className="w-full rounded-md border border-border bg-surface-page px-3 py-2 text-left hover:border-accent hover:bg-accent-soft"
                      >
                        <p className="truncate text-xs font-semibold text-text">{asset.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{asset.summary || assetKindLabel(asset.kind)}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md bg-surface-page px-3 py-4 text-sm text-text-muted">暂无反向引用</p>
                )}
              </div>

              <div className="rounded-lg border border-border bg-white p-4 shadow-sm-soft">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                  <FileSearch className="h-4 w-4 text-accent" />
                  来源文档
                </h3>
                {documentsLoading ? (
                  <div className="flex items-center gap-2 py-6 text-sm text-text-muted">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在加载文档
                  </div>
                ) : sourceDocs.length === 0 ? (
                  <p className="rounded-md bg-surface-page px-3 py-4 text-sm text-text-muted">暂无匹配来源文档</p>
                ) : (
                  <div className="space-y-2">
                    {sourceDocs.map((doc) => (
                      <button
                        key={doc.id}
                        onClick={() => navigate(`/documents?doc_id=${encodeURIComponent(doc.id)}`)}
                        className="w-full rounded-md border border-border bg-surface-page px-3 py-2 text-left hover:border-accent hover:bg-accent-soft"
                      >
                        <p className="truncate text-xs font-semibold text-text">{doc.title}</p>
                        <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-text-muted">
                          <span className="min-w-0 truncate">{doc.category || doc.process || "知识库文档"}</span>
                          <span className="shrink-0">{doc.index_status === "ready" ? "已索引" : doc.index_status}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
