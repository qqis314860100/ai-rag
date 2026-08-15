import { Fragment, useState, useEffect, useCallback } from "react";
import { BarChart3, ChevronDown, Database, FileQuestion, HelpCircle, Layers3, RefreshCw, Search, Upload } from "lucide-react";
import { api } from "../../services/api";
import type { Document, PaginatedResponse, ApiResponse } from "../../types";
import { Button, Input, Badge, Spinner, EmptyState, getBadgeLabel } from "../ui";
import UploadModal from "./UploadModal";

interface DocumentInsightQuestion {
  answer_message_id: string;
  session_id: string;
  question: string;
  answer_preview: string;
  source_hit_count: number;
  top_score: number;
  created_at: string;
}

interface DocumentInsightAsset {
  asset_type: "knowledge_card" | "faq" | "term";
  id: string;
  title: string;
  status: string;
  version: number;
  source_count: number;
  updated_at: string;
}

interface DocumentInsightGap {
  id: string;
  title: string;
  gap_type: string;
  status: string;
  severity: string;
  frequency_count: number;
  representative_question: string;
  updated_at: string;
}

interface DocumentInsights {
  asked_questions: DocumentInsightQuestion[];
  knowledge_assets: DocumentInsightAsset[];
  unresolved_gaps: DocumentInsightGap[];
  retrieval_contribution: {
    source_hit_count: number;
    answer_count: number;
    section_count: number;
    avg_score: number;
    top_score: number;
    last_hit_at: string | null;
  };
}

function percent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "暂无";
  return `${Math.round(value * 100)}%`;
}

function assetTypeLabel(type: DocumentInsightAsset["asset_type"]) {
  if (type === "knowledge_card") return "知识卡";
  if (type === "faq") return "FAQ";
  return "术语";
}

function shortDate(value?: string | null) {
  if (!value) return "暂无";
  return new Date(value).toLocaleDateString("zh-CN");
}

export default function DocumentTable() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [insights, setInsights] = useState<Record<string, DocumentInsights>>({});
  const [insightLoading, setInsightLoading] = useState<string | null>(null);
  const pageSize = 15;

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (keyword) params.set("keyword", keyword);
      const res = await api.get<ApiResponse<PaginatedResponse<Document>>>(
        `/documents?${params.toString()}`
      );
      setDocuments(res.data.items);
      setTotal(res.data.pagination.total);
      setTotalPages(res.data.pagination.total_pages);
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    } finally {
      setLoading(false);
    }
  }, [page, keyword]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleReindex = async (id: string) => {
    try {
      await api.post(`/documents/${id}/reindex`);
      fetchDocuments();
    } catch (err) {
      console.error("Failed to reindex:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("确认删除该文档？此操作不可撤销。")) return;
    try {
      await api.delete(`/documents/${id}`);
      fetchDocuments();
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.post<{ data: { created: number; updated: number; total: number } }>("/documents/sync-from-rag");
      fetchDocuments();
      alert(`同步完成：新增 ${res.data.created} 个，更新 ${res.data.updated} 个，共 ${res.data.total} 个文档`);
    } catch {
      alert("同步失败，请检查 RAG 服务状态");
    } finally {
      setSyncing(false);
    }
  };

  const toggleInsights = async (id: string) => {
    const nextId = expandedId === id ? null : id;
    setExpandedId(nextId);
    if (!nextId || insights[nextId]) return;
    setInsightLoading(nextId);
    try {
      const res = await api.get<ApiResponse<DocumentInsights>>(`/documents/${encodeURIComponent(nextId)}/insights`);
      setInsights((current) => ({ ...current, [nextId]: res.data }));
    } catch (err) {
      console.error("Failed to fetch document insights:", err);
    } finally {
      setInsightLoading(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              placeholder="搜索文档标题..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleSync} disabled={syncing}>
            <Database className="h-4 w-4" />
            {syncing ? "同步中..." : "同步文档"}
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            上传文档
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          title="暂无文档"
          description="上传第一批产线知识文档后，即可开始构建知识库。"
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4" />
              上传文档
            </Button>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-primary-soft/50 text-left text-text-secondary">
                  <th className="px-4 py-3 font-medium">文档名称</th>
                  <th className="px-4 py-3 font-medium">分类</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">安全等级</th>
                  <th className="px-4 py-3 font-medium">Chunk</th>
                  <th className="px-4 py-3 font-medium">更新时间</th>
                  <th className="px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {documents.map((doc) => {
                  const insight = insights[doc.id];
                  const isExpanded = expandedId === doc.id;
                  return (
                    <Fragment key={doc.id}>
                      <tr className="hover:bg-primary-soft/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-text">{doc.title}</td>
                        <td className="px-4 py-3 text-text-secondary">{doc.category}</td>
                        <td className="px-4 py-3">
                          <Badge variant={doc.status === "active" ? "active" : doc.status}>
                            {getBadgeLabel(doc.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={doc.security_level}>
                            {getBadgeLabel(doc.security_level)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{doc.chunk_count}</td>
                        <td className="px-4 py-3 text-text-secondary">
                          {new Date(doc.updated_at).toLocaleDateString("zh-CN")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleInsights(doc.id)}
                              className="inline-flex items-center gap-1 rounded p-1.5 text-text-muted transition-colors hover:bg-primary-soft hover:text-accent"
                              title="查看文档详情"
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                              <span className="text-xs font-medium">详情</span>
                            </button>
                            <button
                              onClick={() => handleReindex(doc.id)}
                              className="rounded p-1.5 text-text-muted hover:bg-primary-soft hover:text-accent transition-colors"
                              title="重建索引"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(doc.id)}
                              className="rounded p-1.5 text-text-muted hover:bg-error-soft hover:text-error transition-colors"
                              title="删除"
                            >
                              <span className="text-xs font-medium">删除</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${doc.id}-insights`}>
                          <td colSpan={7} className="bg-surface-page px-4 py-4">
                            {insightLoading === doc.id ? (
                              <div className="flex items-center justify-center py-8"><Spinner /></div>
                            ) : insight ? (
                              <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
                                <div className="rounded-lg border border-border bg-white p-4">
                                  <div className="mb-3 flex items-center justify-between">
                                    <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
                                      <HelpCircle className="h-4 w-4 text-accent" />
                                      被问过的问题
                                    </h3>
                                    <span className="text-xs text-text-muted">{insight.asked_questions.length} 条</span>
                                  </div>
                                  <div className="space-y-2">
                                    {insight.asked_questions.length > 0 ? insight.asked_questions.slice(0, 5).map((item) => (
                                      <div key={item.answer_message_id} className="rounded-md border border-border bg-surface-page px-3 py-2">
                                        <p className="line-clamp-1 text-sm font-medium text-text">{item.question || "未关联到上一条用户问题"}</p>
                                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{item.answer_preview}</p>
                                        <p className="mt-1 text-[11px] text-text-muted">命中 {item.source_hit_count} 次 · 最高分 {percent(item.top_score)} · {shortDate(item.created_at)}</p>
                                      </div>
                                    )) : (
                                      <p className="rounded-md border border-border bg-surface-page px-3 py-4 text-center text-sm text-text-muted">暂无会话引用记录</p>
                                    )}
                                  </div>
                                </div>

                                <div className="grid gap-4">
                                  <div className="grid gap-2 md:grid-cols-3">
                                    <div className="rounded-lg border border-border bg-white p-3">
                                      <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><BarChart3 className="h-3.5 w-3.5" />回答引用</p>
                                      <p className="mt-1 text-lg font-semibold text-text">{insight.retrieval_contribution.answer_count}</p>
                                    </div>
                                    <div className="rounded-lg border border-border bg-white p-3">
                                      <p className="text-xs font-semibold text-text-muted">来源命中</p>
                                      <p className="mt-1 text-lg font-semibold text-text">{insight.retrieval_contribution.source_hit_count}</p>
                                    </div>
                                    <div className="rounded-lg border border-border bg-white p-3">
                                      <p className="text-xs font-semibold text-text-muted">最高分</p>
                                      <p className="mt-1 text-lg font-semibold text-text">{percent(insight.retrieval_contribution.top_score)}</p>
                                    </div>
                                  </div>

                                  <div className="rounded-lg border border-border bg-white p-4">
                                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                                      <Layers3 className="h-4 w-4 text-accent" />
                                      生成的知识资产
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                      {insight.knowledge_assets.length > 0 ? insight.knowledge_assets.map((asset) => (
                                        <span key={`${asset.asset_type}-${asset.id}`} className="rounded-md border border-border bg-surface-page px-2.5 py-1.5 text-xs text-text-secondary">
                                          <b className="text-text">{assetTypeLabel(asset.asset_type)}</b> · v{asset.version} · {asset.title}
                                        </span>
                                      )) : (
                                        <span className="text-sm text-text-muted">暂无由本文档沉淀的知识资产</span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="rounded-lg border border-border bg-white p-4">
                                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                                      <FileQuestion className="h-4 w-4 text-accent" />
                                      未解决知识缺口
                                    </h3>
                                    <div className="space-y-2">
                                      {insight.unresolved_gaps.length > 0 ? insight.unresolved_gaps.slice(0, 3).map((gap) => (
                                        <div key={gap.id} className="rounded-md border border-border bg-surface-page px-3 py-2">
                                          <p className="line-clamp-1 text-sm font-medium text-text">{gap.title}</p>
                                          <p className="mt-1 text-[11px] text-text-muted">{gap.status} · {gap.severity} · 出现 {gap.frequency_count} 次</p>
                                        </div>
                                      )) : (
                                        <p className="text-sm text-text-muted">暂无关联未解决缺口</p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <p className="rounded-md border border-border bg-white px-3 py-4 text-center text-sm text-text-muted">详情加载失败，请稍后重试。</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-text-secondary">
            <span>共 {total} 条文档</span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="px-2">
                {page} / {totalPages || 1}
              </span>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </>
      )}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => { setUploadOpen(false); fetchDocuments(); }}
      />
    </div>
  );
}
