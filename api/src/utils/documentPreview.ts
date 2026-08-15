export type PreviewContentKind =
  | "markdown"
  | "text"
  | "pdf"
  | "html"
  | "code"
  | "docx"
  | "binary"
  | "unknown";

export type PreviewView = "text" | "markdown" | "raw" | "file" | "pdf" | "html" | "code" | "download";

export interface DocumentPreviewContract {
  file_type: string;
  mime_type: string;
  content_kind: PreviewContentKind;
  preferred_view: PreviewView;
  supported_views: PreviewView[];
  capabilities: Record<PreviewView, boolean>;
  endpoints: {
    raw: string | null;
    file: string | null;
    chunk: string | null;
    comments: string | null;
  };
  disabled_reasons: Partial<Record<PreviewView, string>>;
}

export interface DocumentPreviewInput {
  documentId?: string | null;
  chunkId?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  mimeType?: string | null;
  sourceFormat?: string | null;
  hasInlineContent?: boolean;
  rawEndpoint?: string | null;
  fileEndpoint?: string | null;
  chunkEndpoint?: string | null;
  commentsEndpoint?: string | null;
}

export interface PreviewFormatDefinition {
  file_type: string;
  aliases: string[];
  mime_type: string;
  content_kind: PreviewContentKind;
  preferred_view: PreviewView;
  supported_views: PreviewView[];
  disabled_reasons: Partial<Record<PreviewView, string>>;
}

const MIME_BY_TYPE: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  text: "text/plain",
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  json: "application/json",
  js: "text/javascript",
  jsx: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  css: "text/css",
  csv: "text/csv",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  py: "text/x-python",
  sh: "application/x-sh",
  sql: "application/sql",
  code: "text/plain",
};

const MIME_TO_TYPE: Record<string, string> = {
  "text/markdown": "md",
  "text/x-markdown": "md",
  "text/plain": "txt",
  "application/pdf": "pdf",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/json": "json",
  "text/javascript": "js",
  "application/javascript": "js",
  "text/typescript": "ts",
  "text/css": "css",
  "text/csv": "csv",
  "application/xml": "xml",
  "text/xml": "xml",
  "application/yaml": "yaml",
  "text/yaml": "yaml",
  "application/x-sh": "sh",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

const CODE_TYPES = new Set([
  "code",
  "json",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "csv",
  "xml",
  "yaml",
  "yml",
  "py",
  "sh",
  "sql",
]);

function normalizeType(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.includes("/")) return MIME_TO_TYPE[trimmed] ?? trimmed.split("/").pop() ?? "";
  return trimmed.replace(/^\./, "");
}

function typeFromFileName(fileName?: string | null): string {
  if (!fileName) return "";
  const match = /\.([^.]+)$/.exec(fileName.trim().toLowerCase());
  return match?.[1] ?? "";
}

export function inferPreviewFileType(input: DocumentPreviewInput): string {
  const sourceType = normalizeType(input.sourceFormat);
  if (sourceType === "markdown") return "md";
  if (sourceType === "plain" || sourceType === "text") return "txt";
  if (sourceType === "code" || CODE_TYPES.has(sourceType)) return sourceType;
  if (sourceType === "html" || sourceType === "pdf") return sourceType;

  return normalizeType(input.fileType) || normalizeType(input.mimeType) || typeFromFileName(input.fileName) || "unknown";
}

export function getPreviewMimeType(fileType: string, fallback?: string | null): string {
  const normalized = normalizeType(fileType);
  return MIME_BY_TYPE[normalized] || fallback || "application/octet-stream";
}

function inferContentKind(fileType: string, mimeType: string): PreviewContentKind {
  const normalized = normalizeType(fileType);
  const normalizedMime = mimeType.toLowerCase();

  if (normalized === "md" || normalized === "markdown") return "markdown";
  if (normalized === "txt" || normalized === "text") return "text";
  if (normalized === "pdf") return "pdf";
  if (normalized === "html" || normalized === "htm") return "html";
  if (normalized === "docx") return "docx";
  if (CODE_TYPES.has(normalized)) return "code";
  if (normalizedMime === "text/markdown") return "markdown";
  if (normalizedMime.startsWith("text/")) return "text";
  if (normalizedMime === "application/pdf") return "pdf";
  if (normalizedMime === "application/json" || normalizedMime.includes("xml")) return "code";
  if (normalized === "unknown") return "unknown";
  return "binary";
}

function buildCapabilities(
  kind: PreviewContentKind,
  hasDocument: boolean,
  hasChunk: boolean,
  hasInlineContent: boolean
): Record<PreviewView, boolean> {
  const textReadable = kind === "markdown" || kind === "text" || kind === "code" || hasInlineContent;
  const fileAvailable = hasDocument;

  return {
    text: textReadable,
    markdown: kind === "markdown",
    raw: textReadable && fileAvailable,
    file: fileAvailable,
    pdf: kind === "pdf" && fileAvailable,
    html: false,
    code: kind === "code" && (hasChunk || hasInlineContent || fileAvailable),
    download: fileAvailable,
  };
}

function preferredView(kind: PreviewContentKind, capabilities: Record<PreviewView, boolean>): PreviewView {
  if (kind === "markdown" && capabilities.markdown) return "markdown";
  if (kind === "code" && capabilities.code) return "code";
  if (kind === "pdf" && capabilities.pdf) return "pdf";
  if (capabilities.text) return "text";
  if (capabilities.raw) return "raw";
  if (capabilities.file) return "file";
  return "download";
}

function disabledReasons(kind: PreviewContentKind, capabilities: Record<PreviewView, boolean>): Partial<Record<PreviewView, string>> {
  const reasons: Partial<Record<PreviewView, string>> = {};
  if (!capabilities.raw && (kind === "pdf" || kind === "docx" || kind === "binary")) {
    reasons.raw = "binary_source_requires_file_endpoint";
  }
  if (kind === "html" && !capabilities.html) {
    reasons.html = "html_sanitizer_not_available";
  }
  if (kind !== "pdf" && !capabilities.pdf) {
    reasons.pdf = "source_is_not_pdf";
  }
  if (kind !== "code" && !capabilities.code) {
    reasons.code = "source_is_not_code";
  }
  return reasons;
}

export function buildDocumentPreviewContract(input: DocumentPreviewInput): DocumentPreviewContract {
  const fileType = inferPreviewFileType(input);
  const mimeType = getPreviewMimeType(fileType, input.mimeType);
  const contentKind = inferContentKind(fileType, mimeType);

  const defaultRawEndpoint = input.documentId ? `/api/documents/${encodeURIComponent(input.documentId)}/raw` : null;
  const defaultFileEndpoint = input.documentId ? `/api/documents/${encodeURIComponent(input.documentId)}/file` : null;
  const defaultChunkEndpoint = input.chunkId ? `/api/documents/chunks/${encodeURIComponent(input.chunkId)}` : null;
  const defaultCommentsEndpoint = input.documentId && input.chunkId
    ? `/api/documents/${encodeURIComponent(input.documentId)}/comments?chunk_id=${encodeURIComponent(input.chunkId)}`
    : null;

  const capabilities = buildCapabilities(
    contentKind,
    Boolean(input.documentId),
    Boolean(input.chunkId),
    Boolean(input.hasInlineContent)
  );
  const supportedViews = (Object.keys(capabilities) as PreviewView[]).filter((view) => capabilities[view]);

  return {
    file_type: fileType,
    mime_type: mimeType,
    content_kind: contentKind,
    preferred_view: preferredView(contentKind, capabilities),
    supported_views: supportedViews,
    capabilities,
    endpoints: {
      raw: capabilities.raw ? input.rawEndpoint ?? defaultRawEndpoint : null,
      file: capabilities.file ? input.fileEndpoint ?? defaultFileEndpoint : null,
      chunk: input.chunkEndpoint ?? defaultChunkEndpoint,
      comments: input.commentsEndpoint ?? defaultCommentsEndpoint,
    },
    disabled_reasons: disabledReasons(contentKind, capabilities),
  };
}

export function listPreviewFormatDefinitions(): PreviewFormatDefinition[] {
  return [
    {
      file_type: "md",
      aliases: ["markdown", "text/markdown", "text/x-markdown"],
      mime_type: "text/markdown",
      content_kind: "markdown",
      preferred_view: "markdown",
      supported_views: ["text", "markdown", "raw", "file", "download"],
      disabled_reasons: { pdf: "source_is_not_pdf", code: "source_is_not_code" },
    },
    {
      file_type: "txt",
      aliases: ["text", "text/plain"],
      mime_type: "text/plain",
      content_kind: "text",
      preferred_view: "text",
      supported_views: ["text", "raw", "file", "download"],
      disabled_reasons: { pdf: "source_is_not_pdf", code: "source_is_not_code" },
    },
    {
      file_type: "pdf",
      aliases: ["application/pdf"],
      mime_type: "application/pdf",
      content_kind: "pdf",
      preferred_view: "pdf",
      supported_views: ["file", "pdf", "download"],
      disabled_reasons: { raw: "binary_source_requires_file_endpoint", code: "source_is_not_code" },
    },
    {
      file_type: "html",
      aliases: ["htm", "text/html", "application/xhtml+xml"],
      mime_type: "text/html",
      content_kind: "html",
      preferred_view: "file",
      supported_views: ["file", "download"],
      disabled_reasons: { html: "html_sanitizer_not_available", code: "source_is_not_code" },
    },
    {
      file_type: "code",
      aliases: ["json", "js", "jsx", "ts", "tsx", "css", "xml", "yaml", "yml", "py", "sh", "sql"],
      mime_type: "text/plain",
      content_kind: "code",
      preferred_view: "code",
      supported_views: ["text", "raw", "file", "code", "download"],
      disabled_reasons: { pdf: "source_is_not_pdf" },
    },
  ];
}
