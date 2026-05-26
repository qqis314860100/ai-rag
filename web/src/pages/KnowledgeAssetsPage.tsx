import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookMarked,
  CheckCircle2,
  CircleHelp,
  FileSearch,
  GitBranch,
  History,
  Layers3,
  Link2,
  Loader2,
  Network,
  RotateCcw,
  Save,
  Search,
  Send,
  Tags,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/ui";
import { api } from "../services/api";
import type {
  ApiResponse,
  Document,
  KnowledgeCard,
  KnowledgeFaq,
  KnowledgeCardSourceRef,
  KnowledgeCardStatus,
  KnowledgeCardVersion,
  PaginatedResponse,
} from "../types";

type AssetKind = "term" | "card" | "faq" | "topic";
type AssetStatus = KnowledgeCardStatus;

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
  source_refs?: KnowledgeCardSourceRef[];
  updated_at?: string;
  card?: KnowledgeCard;
  faq?: KnowledgeFaq;
}

interface KnowledgeCardListResponse {
  items: KnowledgeCard[];
  total: number;
  page: number;
  pageSize: number;
}

interface KnowledgeFaqListResponse {
  items: KnowledgeFaq[];
  total: number;
  page: number;
  pageSize: number;
}

interface CardFormState {
  topic: string;
  summary: string;
  relatedTerms: string;
  changeNote: string;
}

const tabs: Array<{ key: AssetKind | "all"; label: string; icon: typeof Tags }> = [
  { key: "all", label: "全部", icon: Layers3 },
  { key: "term", label: "术语库", icon: Tags },
  { key: "card", label: "知识卡", icon: BookMarked },
  { key: "faq", label: "FAQ", icon: CircleHelp },
  { key: "topic", label: "相关主题", icon: Network },
];

const statusFilters: Array<{ key: AssetStatus | "all"; label: string }> = [
  { key: "all", label: "全部状态" },
  { key: "ai_draft", label: "AI 草稿" },
  { key: "pending_review", label: "待审核" },
  { key: "returned", label: "已退回" },
  { key: "published", label: "已发布" },
  { key: "archived", label: "已归档" },
];

const statusLabels: Record<AssetStatus, string> = {
  ai_draft: "AI 草稿",
  pending_review: "待审核",
  returned: "已退回",
  published: "已发布",
  archived: "已归档",
};

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

function cardToAsset(card: KnowledgeCard): KnowledgeAsset {
  return {
    id: card.id,
    kind: "card",
    title: card.topic,
    summary: card.summary || "暂无摘要",
    subtitle: `v${card.current_version} · ${card.source_refs.length} 条证据`,
    status: card.status,
    related_terms: card.related_terms,
    related_topics: card.related_terms,
    source_refs: card.source_refs,
    updated_at: card.updated_at,
    card,
  };
}

function faqToAsset(faq: KnowledgeFaq): KnowledgeAsset {
  return {
    id: faq.id,
    kind: "faq",
    title: faq.question,
    summary: faq.answer || "暂无答案",
    subtitle: `${faq.frequency_count} 次沉淀 · ${faq.source_refs.length} 条证据`,
    status: faq.status,
    related_terms: faq.tags,
    related_topics: faq.related_card_ids,
    source_refs: faq.source_refs,
    updated_at: faq.updated_at,
    faq,
  };
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

function sourceTitle(source: KnowledgeCardSourceRef, index: number) {
  return source.title || source.section_path || source.document_id || source.chunk_id || `证据 ${index + 1}`;
}

function formFromCard(card: KnowledgeCard | null): CardFormState {
  return {
    topic: card?.topic || "",
    summary: card?.summary || "",
    relatedTerms: (card?.related_terms || []).join("，"),
    changeNote: "",
  };
}

function snapshotValue(version: KnowledgeCardVersion | null, key: string) {
  const value = version?.snapshot?.[key];
  return typeof value === "string" ? value : "";
}

export default function KnowledgeAssetsPage() {
  const [activeKind, setActiveKind] = useState<AssetKind | "all">("all");
  const [activeStatus, setActiveStatus] = useState<AssetStatus | "all">("all");
  const [keyword, setKeyword] = useState("");
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [faqs, setFaqs] = useState<KnowledgeFaq[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [form, setForm] = useState<CardFormState>(formFromCard(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    setCardsLoading(true);
    api.get<ApiResponse<KnowledgeCardListResponse>>("/knowledge/cards?page=1&page_size=80")
      .then((res) => {
        if (!mounted) return;
        const nextCards = res.data.items || [];
        setCards(nextCards);
        setSelectedId((current) => current || nextCards[0]?.id || null);
      })
      .catch((err) => {
        if (!mounted) return;
        setCards([]);
        setError(err instanceof Error ? err.message : "知识卡加载失败");
      })
      .finally(() => {
        if (mounted) setCardsLoading(false);
      });

    api.get<ApiResponse<KnowledgeFaqListResponse>>("/knowledge/faqs?page=1&page_size=80")
      .then((res) => {
        if (!mounted) return;
        setFaqs(res.data.items || []);
      })
      .catch(() => {
        if (mounted) setFaqs([]);
      });

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

  const assets = useMemo(() => [...cards.map(cardToAsset), ...faqs.map(faqToAsset)], [cards, faqs]);

  const filteredAssets = useMemo(() => {
    const term = normalize(keyword);
    return assets.filter((asset) => {
      if (activeKind !== "all" && asset.kind !== activeKind) return false;
      if (activeStatus !== "all" && asset.status !== activeStatus) return false;
      if (!term) return true;
      const haystack = normalize([
        asset.title,
        asset.summary,
        ...(asset.related_terms || []),
        ...(asset.source_refs || []).map((source) => `${source.title || ""} ${source.snippet || ""}`),
      ].join(" "));
      return haystack.includes(term);
    });
  }, [activeKind, activeStatus, assets, keyword]);

  const selectedAsset = useMemo(() => {
    return assets.find((asset) => asset.id === selectedId) || filteredAssets[0] || assets[0] || null;
  }, [assets, filteredAssets, selectedId]);

  const selectedCard = selectedAsset?.card || null;
  const selectedFaq = selectedAsset?.faq || null;

  useEffect(() => {
    setForm(formFromCard(selectedCard));
    setSelectedVersionId(null);
    setError(null);
  }, [selectedCard?.id, selectedFaq?.id]);

  const selectedVersion = useMemo(() => {
    if (!selectedCard) return null;
    return selectedCard.version_history.find((version) => version.id === selectedVersionId) || selectedCard.version_history[0] || null;
  }, [selectedCard, selectedVersionId]);

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

  const canSubmit = selectedCard?.status === "ai_draft" || selectedCard?.status === "returned";
  const canPublish = selectedCard?.status === "pending_review" && selectedCard.source_refs.length > 0;
  const canReturn = selectedCard?.status === "pending_review";
  const canArchive = selectedCard && selectedCard.status !== "archived";

  async function applyCardAction(action: "revise" | "submit" | "publish" | "return" | "archive") {
    if (!selectedCard) return;
    setSaving(true);
    setError(null);
    const payload = {
      topic: form.topic.trim(),
      summary: form.summary.trim(),
      related_terms: form.relatedTerms.split(/[，,]/).map((term) => term.trim()).filter(Boolean),
      change_note: form.changeNote.trim() || undefined,
    };
    const path = action === "revise"
      ? `/knowledge/cards/${encodeURIComponent(selectedCard.id)}`
      : `/knowledge/cards/${encodeURIComponent(selectedCard.id)}/${action === "submit" ? "submit" : action}`;
    const request = action === "revise"
      ? api.patch<ApiResponse<KnowledgeCard>>(path, payload)
      : api.post<ApiResponse<KnowledgeCard>>(path, payload);

    try {
      const res = await request;
      setCards((current) => current.map((card) => card.id === res.data.id ? res.data : card));
      setForm(formFromCard(res.data));
      setSelectedId(res.data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "知识卡操作失败");
    } finally {
      setSaving(false);
    }
  }

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
              浏览知识卡、审核状态、版本历史和来源证据；对话问答仍是默认主入口
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

        <div className="mt-3 flex gap-2 overflow-x-auto">
          {statusFilters.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveStatus(key)}
              className={`h-8 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                activeStatus === key
                  ? "border-text bg-text text-white"
                  : "border-border bg-white text-text-secondary hover:bg-surface-hover"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(360px,500px)_1fr]">
        <section className="min-h-0 overflow-y-auto border-r border-divider bg-white p-4">
          {cardsLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-page px-3 py-4 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在加载知识卡
            </div>
          ) : filteredAssets.length > 0 ? (
            <div className="space-y-2">
              {filteredAssets.map((asset) => (
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
            <EmptyState
              title="暂无匹配知识卡"
              description="可从高置信回答生成 AI 草稿，再在这里修订、提交审核并发布。"
            />
          )}
        </section>

        <section className="min-h-0 overflow-y-auto p-5">
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-white p-5 shadow-sm-soft">
                {selectedCard ? (
                  <>
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent">
                            知识卡
                          </span>
                          <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${statusClass(selectedCard.status)}`}>
                            {statusLabels[selectedCard.status]}
                          </span>
                          <span className="rounded-md bg-surface-page px-2 py-1 text-[11px] font-semibold text-text-muted">
                            v{selectedCard.current_version}
                          </span>
                        </div>
                        <h2 className="text-xl font-semibold text-text">{selectedCard.topic}</h2>
                        <p className="mt-1 text-sm text-text-muted">
                          {selectedCard.reviewer_name ? `最近审核人：${selectedCard.reviewer_name}` : "尚未进入人工审核"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface-page px-3 py-2 text-xs text-text-secondary">
                        <GitBranch className="h-4 w-4 text-accent" />
                        {selectedCard.source_refs.length} 条引用证据
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-text-muted">主题</span>
                        <input
                          value={form.topic}
                          onChange={(e) => setForm((current) => ({ ...current, topic: e.target.value }))}
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/15"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-text-muted">相关术语</span>
                        <input
                          value={form.relatedTerms}
                          onChange={(e) => setForm((current) => ({ ...current, relatedTerms: e.target.value }))}
                          placeholder="用逗号分隔"
                          className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/15"
                        />
                      </label>
                    </div>

                    <label className="mt-4 block">
                      <span className="mb-1 block text-xs font-semibold text-text-muted">摘要</span>
                      <textarea
                        value={form.summary}
                        onChange={(e) => setForm((current) => ({ ...current, summary: e.target.value }))}
                        rows={5}
                        className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-text focus:outline-none focus:ring-2 focus:ring-accent/15"
                      />
                    </label>

                    <label className="mt-4 block">
                      <span className="mb-1 block text-xs font-semibold text-text-muted">审核备注</span>
                      <input
                        value={form.changeNote}
                        onChange={(e) => setForm((current) => ({ ...current, changeNote: e.target.value }))}
                        placeholder="说明修订、发布或退回原因"
                        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/15"
                      />
                    </label>

                    {error && (
                      <p className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => applyCardAction("revise")}
                        disabled={saving || selectedCard.status === "archived"}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-text-secondary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        保存修订
                      </button>
                      <button
                        onClick={() => applyCardAction("submit")}
                        disabled={saving || !canSubmit}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-text-secondary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        提交审核
                      </button>
                      <button
                        onClick={() => applyCardAction("publish")}
                        disabled={saving || !canPublish}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-3 text-sm font-semibold text-success disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        发布
                      </button>
                      <button
                        onClick={() => applyCardAction("return")}
                        disabled={saving || !canReturn}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-danger/20 bg-white px-3 text-sm font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RotateCcw className="h-4 w-4" />
                        退回
                      </button>
                      <button
                        onClick={() => applyCardAction("archive")}
                        disabled={saving || !canArchive}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-text-secondary hover:border-text-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Archive className="h-4 w-4" />
                        归档
                      </button>
                    </div>
                  </>
                ) : selectedFaq ? (
                  <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-accent-soft px-2 py-1 text-[11px] font-semibold text-accent">
                      FAQ
                    </span>
                    <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${statusClass(selectedFaq.status)}`}>
                      {statusLabels[selectedFaq.status]}
                    </span>
                    <span className="rounded-md bg-surface-page px-2 py-1 text-[11px] font-semibold text-text-muted">
                      {selectedFaq.frequency_count} 次沉淀
                    </span>
                  </div>
                  <h2 className="text-xl font-semibold text-text">{selectedFaq.question}</h2>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{selectedFaq.answer}</p>

                  <div className="mt-5 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-lg border border-border bg-surface-page p-3">
                      <p className="text-xs font-semibold text-text-muted">适用范围</p>
                      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{selectedFaq.applicable_scope || "待人工补充"}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-surface-page p-3">
                      <p className="text-xs font-semibold text-text-muted">失效条件</p>
                      {selectedFaq.invalid_conditions.length ? (
                        <ul className="mt-2 space-y-1 text-sm leading-relaxed text-text-secondary">
                          {selectedFaq.invalid_conditions.map((condition) => (
                            <li key={condition}>{condition}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-text-muted">暂无明确失效条件</p>
                      )}
                    </div>
                  </div>

                  {selectedFaq.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedFaq.tags.map((tag) => (
                        <span key={tag} className="rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-text-secondary">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-surface-page p-6">
                    <h2 className="text-base font-semibold text-text">等待知识资产数据</h2>
                    <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                      当前页面只渲染 API 返回的真实知识资产；不会在前端编造 FAQ 或知识卡。
                    </p>
                  </div>
                )}
              </div>

              {selectedCard && (
                <div className="rounded-lg border border-border bg-white p-5 shadow-sm-soft">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                    <History className="h-4 w-4 text-accent" />
                    版本对比
                  </h3>
                  <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                    <div className="space-y-2">
                      {selectedCard.version_history.map((version) => (
                        <button
                          key={version.id}
                          onClick={() => setSelectedVersionId(version.id)}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${
                            selectedVersion?.id === version.id
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-border bg-surface-page text-text-secondary hover:border-accent/50"
                          }`}
                        >
                          <div className="font-semibold">v{version.version}</div>
                          <div className="mt-1 truncate text-[11px]">{version.change_note || "无备注"}</div>
                        </button>
                      ))}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-border bg-surface-page p-3">
                        <p className="text-xs font-semibold text-text-muted">当前版本</p>
                        <h4 className="mt-2 text-sm font-semibold text-text">{selectedCard.topic}</h4>
                        <p className="mt-2 line-clamp-6 text-xs leading-relaxed text-text-secondary">{selectedCard.summary || "暂无摘要"}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-surface-page p-3">
                        <p className="text-xs font-semibold text-text-muted">选中历史版本</p>
                        <h4 className="mt-2 text-sm font-semibold text-text">{snapshotValue(selectedVersion, "topic") || "暂无主题"}</h4>
                        <p className="mt-2 line-clamp-6 text-xs leading-relaxed text-text-secondary">{snapshotValue(selectedVersion, "summary") || "暂无摘要"}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <div className="rounded-lg border border-border bg-white p-4 shadow-sm-soft">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                  <Link2 className="h-4 w-4 text-accent" />
                  引用证据
                </h3>
                {selectedAsset?.source_refs?.length ? (
                  <div className="space-y-2">
                    {selectedAsset.source_refs.slice(0, 8).map((source, index) => (
                      <div key={`${source.source_id || source.chunk_id || index}`} className="rounded-md border border-border bg-surface-page px-3 py-2">
                        <p className="truncate text-xs font-semibold text-text">{sourceTitle(source, index)}</p>
                        {source.snippet && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-text-muted">{source.snippet}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md bg-warning-soft px-3 py-4 text-sm text-warning">发布前必须保留引用证据</p>
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
