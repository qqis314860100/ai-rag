import { useState, useEffect, useCallback, useMemo } from "react";
import { X, FileText, MessageSquare, Send, Trash2, Pencil, FileCode, Globe, Loader2, ExternalLink, CornerDownRight } from "lucide-react";
import type { Source, DocComment, DocumentPreviewContract, PreviewView } from "../../types";
import { api } from "../../services/api";
import { useAuth } from "../../contexts/AuthContext";
import { showToast } from "../ui/Toast";
import { MarkdownContent } from "./MarkdownContent";

interface Props {
  source: Source;
  onClose: () => void;
  onAskAbout?: (source: Source) => void;
}

type PreviewMode = "text" | "markdown" | "raw" | "pdf" | "html" | "code";
type PreviewKind = DocumentPreviewContract["content_kind"];

const PREVIEW_MODES: Array<{
  mode: PreviewMode;
  label: string;
  icon: typeof FileText;
  note?: string;
}> = [
  { mode: "text", label: "文本", icon: FileText, note: "片段文本" },
  { mode: "markdown", label: "Markdown", icon: MessageSquare, note: "结构化排版" },
  { mode: "raw", label: "原文", icon: FileCode, note: "原始文本" },
  { mode: "pdf", label: "PDF", icon: FileText, note: "文件流预览" },
  { mode: "html", label: "HTML", icon: Globe, note: "沙箱清洗预览" },
  { mode: "code", label: "代码", icon: FileCode, note: "代码块视图" },
];

const CODE_TYPES = new Set(["code", "json", "js", "jsx", "ts", "tsx", "css", "csv", "xml", "yaml", "yml", "py", "sh", "sql"]);

function looksLikeMarkdown(text: string) {
  return /(^#{1,6}\s)|(```)|(^[-*]\s)|(^\d+[.)]\s)|(\|.+\|)|(\[[^\]]+\]\([^)]+\))/m.test(text);
}

function looksLikeHtml(text: string) {
  return /<\/?(html|body|main|article|section|div|p|table|thead|tbody|tr|td|th|h[1-6]|ul|ol|li|pre|code|img|a)\b/i.test(text);
}

function normalizeType(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("/")) return trimmed.split("/").pop()?.replace(/x-/, "") || "";
  return trimmed.replace(/^\./, "");
}

function pickString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function getMetadataString(source: Source, key: string) {
  const value = source.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function inferSourceType(source: Source, contract?: DocumentPreviewContract | null) {
  return normalizeType(pickString(
    contract?.file_type,
    source.preview?.file_type,
    source.file_type,
    source.source_format,
    source.format,
    source.document_type,
    getMetadataString(source, "file_type"),
    getMetadataString(source, "source_format"),
    getMetadataString(source, "format"),
    getMetadataString(source, "source_type"),
    source.source_metadata?.document?.file_type,
    source.source_metadata?.format?.name
  ));
}

function inferMimeType(source: Source, contract?: DocumentPreviewContract | null) {
  return pickString(
    contract?.mime_type,
    source.preview?.mime_type,
    source.mime_type,
    getMetadataString(source, "mime_type"),
    source.source_metadata?.document?.mime_type,
    source.source_metadata?.format?.mime_type
  )?.toLowerCase() || "";
}

function inferContentKind(source: Source, body: string, contract?: DocumentPreviewContract | null): PreviewKind {
  const explicitKind = normalizeType(pickString(
    contract?.content_kind,
    source.preview?.content_kind,
    source.content_kind,
    getMetadataString(source, "content_kind"),
    source.source_metadata?.content_kind
  ));
  if (explicitKind) return explicitKind as PreviewKind;

  const sourceType = inferSourceType(source, contract);
  const mimeType = inferMimeType(source, contract);
  const chunkType = normalizeType(source.source_metadata?.chunk?.type || getMetadataString(source, "chunk_type"));

  if (sourceType === "pdf" || mimeType === "application/pdf") return "pdf";
  if (sourceType === "html" || sourceType === "htm" || mimeType.includes("html") || looksLikeHtml(body)) return "html";
  if (sourceType === "md" || sourceType === "markdown" || mimeType.includes("markdown")) return "markdown";
  if (CODE_TYPES.has(sourceType) || CODE_TYPES.has(chunkType) || /```[\s\S]*?```/.test(body)) return "code";
  if (sourceType === "txt" || sourceType === "text" || mimeType.startsWith("text/")) return "text";
  if (looksLikeMarkdown(body)) return "markdown";
  return "text";
}

function detectInitialMode(source: Source, body: string, contract?: DocumentPreviewContract | null): PreviewMode {
  const kind = inferContentKind(source, body, contract);
  if (kind === "pdf") return "pdf";
  if (kind === "html") return "html";
  if (kind === "code") return "code";
  if (kind === "markdown") {
    return "markdown";
  }
  return "text";
}

function getDocumentFormatLabel(source: Source, contract?: DocumentPreviewContract | null) {
  const documentType = pickString(inferSourceType(source, contract), source.document_type);
  if (documentType) return documentType;
  if (source.page_number) return "page";
  return "文本";
}

function stripApiPrefix(endpoint: string) {
  return endpoint.startsWith("/api/") ? endpoint.slice(4) : endpoint;
}

function getPreviewEndpoint(source: Source, contract: DocumentPreviewContract | null, view: "raw" | "file" | "chunk") {
  if (view === "raw") {
    return source.preview?.raw_endpoint || source.preview?.endpoints?.raw || contract?.raw_endpoint || contract?.endpoints?.raw ||
      (source.document_id ? `/api/documents/${encodeURIComponent(source.document_id)}/raw?section_path=${encodeURIComponent(source.section_path || "")}` : null);
  }
  if (view === "file") {
    return source.preview?.file_endpoint || source.preview?.endpoints?.file || contract?.file_endpoint || contract?.endpoints?.file ||
      (source.document_id ? `/api/documents/${encodeURIComponent(source.document_id)}/file` : null);
  }
  return source.preview?.chunk_endpoint || source.preview?.endpoints?.chunk || contract?.chunk_endpoint || contract?.endpoints?.chunk ||
    (source.chunk_id ? `/api/documents/chunks/${encodeURIComponent(source.chunk_id)}` : null);
}

function sanitizeHtmlDocument(html: string) {
  if (typeof DOMParser === "undefined") return html;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script, iframe, object, embed, base, meta[http-equiv]").forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || value.startsWith("javascript:")) node.removeAttribute(attr.name);
    });
  });
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { margin: 0; padding: 16px; color: #1c1917; background: #fff; font: 14px/1.7 system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans SC", sans-serif; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e7e5e4; padding: 6px 8px; vertical-align: top; }
  pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { overflow: auto; background: #f5f5f0; border: 1px solid #e7e5e4; border-radius: 8px; padding: 12px; }
  img { max-width: 100%; height: auto; }
  a { color: #8a5a2b; }
</style>
</head>
<body>${parsed.body.innerHTML}</body>
</html>`;
}

function extractCodePreview(text: string, source: Source, contract?: DocumentPreviewContract | null) {
  const matches = [...text.matchAll(/```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g)];
  const sourceType = inferSourceType(source, contract);
  if (matches.length > 0) {
    return {
      language: matches[0][1] || sourceType || "text",
      code: matches.map((match) => match[2].trim()).join("\n\n"),
    };
  }
  return {
    language: sourceType && CODE_TYPES.has(sourceType) ? sourceType : "text",
    code: text,
  };
}

async function fetchEndpointText(endpoint: string) {
  const token = localStorage.getItem("kb_token");
  const response = await fetch(endpoint, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(response.statusText);
  return response.text();
}

function renderTextBody(text: string) {
  return (
    <div className="prose prose-sm max-w-none text-sm leading-relaxed text-text whitespace-pre-wrap">
      {text}
    </div>
  );
}

export default function DocPreview({ source, onClose, onAskAbout }: Props) {
  const { user } = useAuth();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewContract, setPreviewContract] = useState<DocumentPreviewContract | null>(source.preview ?? null);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<PreviewMode>(() => detectInitialMode(source, source.content || source.snippet || "", source.preview));
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [originalLoading, setOriginalLoading] = useState(false);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [htmlLoading, setHtmlLoading] = useState(false);

  const supportedContent = useMemo(() => content || source.content || source.snippet || "", [content, source.content, source.snippet]);
  const formatLabel = useMemo(() => getDocumentFormatLabel(source, previewContract), [previewContract, source]);
  const contentKind = useMemo(() => inferContentKind(source, supportedContent, previewContract), [previewContract, source, supportedContent]);
  const fileEndpoint = useMemo(() => getPreviewEndpoint(source, previewContract, "file"), [previewContract, source]);
  const rawEndpoint = useMemo(() => getPreviewEndpoint(source, previewContract, "raw"), [previewContract, source]);
  const previewModes = useMemo(() => {
    const hasFile = Boolean(fileEndpoint);
    const hasRaw = Boolean(rawEndpoint) && !["pdf", "docx", "binary"].includes(contentKind);
    const hasText = Boolean(supportedContent) || Boolean(getPreviewEndpoint(source, previewContract, "chunk"));
    const canMarkdown = contentKind === "markdown" || looksLikeMarkdown(supportedContent);
    const canHtml = contentKind === "html" || looksLikeHtml(supportedContent);
    const canCode = contentKind === "code" || /```[\s\S]*?```/.test(supportedContent);
    const contractViews = new Set<PreviewView>(previewContract?.supported_views || source.preview?.supported_views || []);

    return PREVIEW_MODES.map((mode) => ({
      ...mode,
      enabled:
        (mode.mode === "text" && (hasText || contractViews.has("text"))) ||
        (mode.mode === "markdown" && (canMarkdown || contractViews.has("markdown"))) ||
        (mode.mode === "raw" && (hasRaw || contractViews.has("raw"))) ||
        (mode.mode === "pdf" && contentKind === "pdf" && hasFile) ||
        (mode.mode === "html" && canHtml && (hasRaw || hasFile || Boolean(supportedContent))) ||
        (mode.mode === "code" && canCode),
    }));
  }, [contentKind, fileEndpoint, previewContract, rawEndpoint, source, supportedContent]);

  const loadComments = useCallback(() => {
    api
      .get<{ data: { items: DocComment[] } }>(`/documents/${source.document_id}/comments?chunk_id=${source.chunk_id}`)
      .then((res) => setComments(res.data?.items || []))
      .catch(() => {})
      .finally(() => setCommentsLoading(false));
  }, [source.document_id, source.chunk_id]);

  useEffect(() => {
    setActiveTab(detectInitialMode(source, source.content || source.snippet || "", source.preview));
    setContent(null);
    setLoading(true);
    setPreviewContract(source.preview ?? null);
    setComments([]);
    setCommentsLoading(true);
    setCommentText("");
    setReplyTo(null);
    setEditingId(null);
    setEditText("");
    setOriginalContent(null);
    setOriginalLoading(false);
    setHtmlContent(null);
    setHtmlLoading(false);

    api.post("/stats/browse", {
      event_type: "source_view",
      resource_type: "chunk",
      resource_id: source.chunk_id,
      metadata: { document_title: source.document_title, score: source.score },
    }).catch(() => {});

    const immediateContent = source.content || source.snippet || "";
    if (immediateContent) {
      setContent(immediateContent);
      setLoading(false);
    }

    api
      .get<{ data: { content: string } }>(`/documents/chunks/${source.chunk_id}`)
      .then((res) => {
        if (res.data?.content) setContent(res.data.content);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    if (source.document_id) {
      api
        .get<{ data: { content?: string; preview?: DocumentPreviewContract } }>(`/documents/${source.document_id}`)
        .then((res) => {
          if (res.data?.preview) {
            setPreviewContract(res.data.preview);
            setActiveTab((current) => {
              if (!["text", "markdown"].includes(current)) return current;
              return detectInitialMode(source, res.data?.content || immediateContent, res.data.preview);
            });
          }
          if (!immediateContent && res.data?.content) setContent(res.data.content);
        })
        .catch(() => {});
    }

    loadComments();
  }, [
    loadComments,
    source.chunk_id,
    source.content,
    source.document_id,
    source.document_title,
    source.document_type,
    source.file_type,
    source.format,
    source.mime_type,
    source.preview,
    source.score,
    source.snippet,
    source.source_format,
  ]);

  const loadOriginalFile = useCallback(() => {
    if (originalContent !== null) return;
    setOriginalLoading(true);
    const endpoint = rawEndpoint || `/api/documents/${encodeURIComponent(source.document_id)}/raw?section_path=${encodeURIComponent(source.section_path || "")}`;
    api
      .get<{ data: { content: string } }>(stripApiPrefix(endpoint))
      .then((res) => setOriginalContent(res.data?.content || ""))
      .catch(() => setOriginalContent(""))
      .finally(() => setOriginalLoading(false));
  }, [originalContent, rawEndpoint, source.document_id, source.section_path]);

  const loadHtmlPreview = useCallback(() => {
    if (htmlContent !== null || htmlLoading) return;
    if (looksLikeHtml(supportedContent)) {
      setHtmlContent(supportedContent);
      return;
    }

    const endpoint = rawEndpoint || fileEndpoint;
    if (!endpoint) {
      setHtmlContent("");
      return;
    }

    setHtmlLoading(true);
    if (endpoint.includes("/raw")) {
      api
        .get<{ data: { content: string } }>(stripApiPrefix(endpoint))
        .then((res) => setHtmlContent(res.data?.content || ""))
        .catch(() => setHtmlContent(""))
        .finally(() => setHtmlLoading(false));
      return;
    }

    fetchEndpointText(endpoint)
      .then((text) => setHtmlContent(text))
      .catch(() => setHtmlContent(""))
      .finally(() => setHtmlLoading(false));
  }, [fileEndpoint, htmlContent, htmlLoading, rawEndpoint, supportedContent]);

  useEffect(() => {
    const currentMode = previewModes.find((mode) => mode.mode === activeTab);
    if (currentMode?.enabled) return;
    const fallback = previewModes.find((mode) => mode.enabled);
    if (fallback) setActiveTab(fallback.mode);
  }, [activeTab, previewModes]);

  useEffect(() => {
    if (activeTab === "raw") loadOriginalFile();
    if (activeTab === "html") loadHtmlPreview();
  }, [activeTab, loadHtmlPreview, loadOriginalFile]);

  const handleSubmit = async (parentId?: string) => {
    const text = commentText;
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.post(`/documents/${source.document_id}/comments`, {
        content: text.trim(),
        chunk_id: source.chunk_id,
        parent_id: parentId || undefined,
      });
      setCommentText("");
      setReplyTo(null);
      loadComments();
      showToast("success", "评论已发布");
    } catch {
      showToast("error", "评论发布失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (commentId: string) => {
    if (!editText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.patch(`/documents/${source.document_id}/comments/${commentId}`, { content: editText.trim() });
      setEditingId(null);
      setEditText("");
      loadComments();
      showToast("success", "评论已更新");
    } catch {
      showToast("error", "编辑失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm("确定删除此评论？")) return;
    try {
      await api.delete(`/documents/${source.document_id}/comments/${commentId}`);
      loadComments();
      showToast("success", "评论已删除");
    } catch {
      showToast("error", "删除失败");
    }
  };

  const startEdit = (c: DocComment) => {
    setEditingId(c.id);
    setEditText(c.content);
  };

  const topLevelComments = comments.filter((c) => !c.parent_id);
  const replies = (parentId: string) => comments.filter((c) => c.parent_id === parentId);

  const renderPreviewBody = () => {
    if (activeTab === "pdf") {
      if (!fileEndpoint) {
        return (
          <div className="rounded-2xl border border-dashed border-border bg-surface-page px-4 py-10 text-center">
            <FileText className="mx-auto h-8 w-8 text-text-muted/30" />
            <p className="mt-3 text-sm text-text-muted">无法加载 PDF 文件流</p>
          </div>
        );
      }

      return (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-page">
          <div className="flex items-center justify-between border-b border-divider bg-white px-3 py-2">
            <span className="text-xs font-semibold text-text">PDF 文件预览</span>
            <a
              href={fileEndpoint}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-surface-page px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:text-accent"
            >
              <ExternalLink className="h-3 w-3" />
              新窗口
            </a>
          </div>
          <iframe
            title={`${source.document_title} PDF 预览`}
            src={fileEndpoint}
            className="h-[520px] w-full bg-white"
          />
        </div>
      );
    }

    if (activeTab === "html") {
      const html = htmlContent ?? (looksLikeHtml(supportedContent) ? supportedContent : "");
      if (htmlLoading) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>;
      }
      if (!html) {
        return (
          <div className="rounded-2xl border border-dashed border-border bg-surface-page px-4 py-10 text-center">
            <Globe className="mx-auto h-8 w-8 text-text-muted/30" />
            <p className="mt-3 text-sm text-text-muted">无法加载 HTML 原文</p>
          </div>
        );
      }
      return (
        <div className="overflow-hidden rounded-2xl border border-border bg-white">
          <div className="flex items-center justify-between border-b border-divider bg-surface-page px-3 py-2">
            <span className="text-xs font-semibold text-text">HTML 沙箱预览</span>
            {fileEndpoint && (
              <a
                href={fileEndpoint}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:text-accent"
              >
                <ExternalLink className="h-3 w-3" />
                原文件
              </a>
            )}
          </div>
          <iframe
            title={`${source.document_title} HTML 预览`}
            sandbox=""
            srcDoc={sanitizeHtmlDocument(html)}
            className="h-[520px] w-full bg-white"
          />
        </div>
      );
    }

    if (activeTab === "code") {
      if (loading && !supportedContent) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>;
      }
      const codePreview = extractCodePreview(supportedContent, source, previewContract);
      if (!codePreview.code) {
        return (
          <div className="rounded-2xl border border-dashed border-border bg-surface-page px-4 py-10 text-center">
            <FileCode className="mx-auto h-8 w-8 text-text-muted/30" />
            <p className="mt-3 text-sm text-text-muted">未找到可预览的代码块</p>
          </div>
        );
      }

      const lines = codePreview.code.split("\n");
      return (
        <div className="overflow-hidden rounded-2xl border border-[#292524] bg-[#1e1e2e] text-[#f4f4f5] shadow-sm-soft">
          <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-3 py-2">
            <span className="text-xs font-semibold text-[#f4f4f5]">{codePreview.language}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(codePreview.code)}
              className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            >
              <FileCode className="h-3 w-3" />
              复制
            </button>
          </div>
          <pre className="max-h-[520px] overflow-auto p-0 text-[12px] leading-6">
            {lines.map((line, index) => (
              <div key={`${index}-${line}`} className="grid grid-cols-[2.75rem_minmax(0,1fr)]">
                <span className="select-none border-r border-white/10 pr-2 text-right font-mono text-white/35">{index + 1}</span>
                <code className="whitespace-pre px-3 font-mono text-[#e4e4e7]">{line || " "}</code>
              </div>
            ))}
          </pre>
        </div>
      );
    }

    if (activeTab === "raw") {
      if (originalLoading || originalContent === null) {
        return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>;
      }

      if (originalContent) {
        return (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-border bg-[#fafaf8] p-4 text-[13px] leading-relaxed text-text">
            {originalContent}
          </pre>
        );
      }

      if (originalContent === "") {
        return (
          <div className="rounded-2xl border border-dashed border-border bg-surface-page px-4 py-10 text-center">
            <FileText className="mx-auto h-8 w-8 text-text-muted/30" />
            <p className="mt-3 text-sm text-text-muted">无法加载原文</p>
            <p className="mt-1 text-xs text-text-muted">文档文件可能已被移动或删除</p>
          </div>
        );
      }
    }

    if (loading && !supportedContent) {
      return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-text-muted" /></div>;
    }

    if (!supportedContent) {
      return (
        <div className="rounded-2xl border border-dashed border-border bg-surface-page px-4 py-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-text-muted/30" />
          <p className="mt-3 text-sm text-text-muted">无法加载内容</p>
          <p className="mt-1 text-xs text-text-muted">{(source.content || source.snippet || "").substring(0, 100)}...</p>
        </div>
      );
    }

    if (activeTab === "markdown") {
      return (
        <div className="rounded-2xl border border-border bg-white p-4">
          <MarkdownContent content={supportedContent} />
        </div>
      );
    }

    return renderTextBody(supportedContent);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface animate-fade-in-right">
      <div className="flex shrink-0 items-center justify-between border-b border-divider px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-accent" />
          <h3 className="truncate text-sm font-semibold text-text">{source.document_title}</h3>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className={`shrink-0 border-b border-divider bg-surface-page/50 px-4 py-2 ${source.category === "安全规范" ? "border-l-[3px] border-l-danger" : ""}`}>
        <p className="text-xs text-text-muted">{source.section_path}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-accent">相关度 {(source.score * 100).toFixed(0)}%</span>
          <span className="text-[10px] text-text-muted font-mono">{formatLabel}</span>
          {source.version && <span className="text-[10px] text-text-muted font-mono">V{source.version}</span>}
          <span className="text-[10px] text-text-muted font-mono">{source.chunk_id?.substring(0, 16)}</span>
          <div className="ml-auto flex items-center gap-2">
            {onAskAbout && (
              <button
                onClick={() => onAskAbout(source)}
                className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-[10px] font-medium text-accent transition-all hover:bg-accent hover:text-white"
              >
                <MessageSquare className="h-3 w-3" />基于此段落追问
              </button>
            )}
            <a href={`/documents?doc_id=${source.document_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-accent hover:underline">
              <ExternalLink className="h-3 w-3" />
              打开原文
            </a>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-divider bg-surface-page/30 px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {previewModes.map((mode) => {
              const Icon = mode.icon;
              const selected = activeTab === mode.mode;
              return (
                <button
                  key={mode.mode}
                  type="button"
                  disabled={!mode.enabled}
                  onClick={() => {
                    if (!mode.enabled) return;
                    setActiveTab(mode.mode);
                    if (mode.mode === "raw") loadOriginalFile();
                    if (mode.mode === "html") loadHtmlPreview();
                  }}
                  title={mode.enabled ? `切换到${mode.label}` : mode.note}
                  className={`rounded-xl border px-2.5 py-2 text-left transition-colors ${
                    mode.enabled
                      ? selected
                        ? "border-accent bg-white text-text shadow-sm-soft"
                        : "border-border bg-white/90 text-text-muted hover:border-accent/40 hover:text-text"
                      : "cursor-not-allowed border-dashed border-border/70 bg-surface-page text-text-muted/70 opacity-70"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${selected && mode.enabled ? "text-accent" : "text-current"}`} />
                    <span className="text-xs font-medium">{mode.label}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-tight text-text-muted">
                    {mode.enabled ? (mode.note || "当前可用") : "当前来源不支持"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-b border-divider bg-white px-4 py-4">
          {renderPreviewBody()}
        </div>

        <div className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-text-muted" />
            <h4 className="text-sm font-semibold text-text">评论 ({topLevelComments.length})</h4>
          </div>

          {commentsLoading ? (
            <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-text-muted" /></div>
          ) : (
            <div className="space-y-3">
              {topLevelComments.map((c) => (
                <div key={c.id}>
                  <div className="group rounded-lg bg-surface-page p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-text">{c.user_name}</span>
                        <span className="text-[10px] text-text-muted">{new Date(c.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {user && c.user_id === user.id && (
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button onClick={() => startEdit(c)} className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"><Pencil className="h-3 w-3" /></button>
                          <button onClick={() => handleDelete(c.id)} className="rounded p-1 text-text-muted hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3 w-3" /></button>
                        </div>
                      )}
                    </div>
                    {editingId === c.id ? (
                      <div className="mt-1 flex gap-2">
                        <input
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEdit(c.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                          autoFocus
                        />
                        <button onClick={() => handleEdit(c.id)} disabled={submitting} className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50">保存</button>
                      </div>
                    ) : (
                      <p className="text-sm leading-relaxed text-text-secondary">{c.content}</p>
                    )}
                    <button
                      onClick={() => {
                        setReplyTo(replyTo === c.id ? null : c.id);
                        setCommentText("");
                      }}
                      className="mt-1 text-[10px] text-text-muted transition-colors hover:text-accent"
                    >
                      回复
                    </button>
                  </div>

                  {replies(c.id).map((r) => (
                    <div key={r.id} className="group ml-4 mt-2 border-l-2 border-border pl-3">
                      <div className="rounded-lg bg-surface-page/70 p-2.5">
                        <div className="mb-1 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CornerDownRight className="h-3 w-3 text-text-muted" />
                            <span className="text-xs font-semibold text-text">{r.user_name}</span>
                            <span className="text-[10px] text-text-muted">{new Date(r.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                          </div>
                          {user && r.user_id === user.id && (
                            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <button onClick={() => startEdit(r)} className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"><Pencil className="h-3 w-3" /></button>
                              <button onClick={() => handleDelete(r.id)} className="rounded p-1 text-text-muted hover:bg-danger-soft hover:text-danger"><Trash2 className="h-3 w-3" /></button>
                            </div>
                          )}
                        </div>
                        {editingId === r.id ? (
                          <div className="mt-1 flex gap-2">
                            <input
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleEdit(r.id);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              className="flex-1 rounded border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                              autoFocus
                            />
                            <button onClick={() => handleEdit(r.id)} disabled={submitting} className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50">保存</button>
                          </div>
                        ) : (
                          <p className="text-sm leading-relaxed text-text-secondary">{r.content}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {topLevelComments.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                  暂无评论
                </div>
              )}
            </div>
          )}

          <div className="mt-4 rounded-lg border border-border bg-surface-page p-3">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={replyTo ? "写回复..." : "写评论..."}
              rows={3}
              className="w-full resize-none rounded border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <button
                onClick={() => {
                  setReplyTo(null);
                  setCommentText("");
                }}
                className="text-xs text-text-muted hover:text-text"
              >
                清空
              </button>
              <button
                onClick={() => handleSubmit(replyTo || undefined)}
                disabled={!commentText.trim() || submitting}
                className="inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                发送
              </button>
            </div>
          </div>

          {replyTo && <p className="mt-2 text-[10px] text-text-muted">正在回复上方评论</p>}
        </div>
      </div>
    </div>
  );
}
