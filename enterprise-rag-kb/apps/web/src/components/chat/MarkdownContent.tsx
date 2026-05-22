// Lightweight markdown renderer — handles the common formatting
// patterns from LLM answers without adding a heavy dependency.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdownLine(line: string): string {
  // Heading
  const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (hMatch) {
    const level = hMatch[1].length;
    const sizes = ["text-lg", "text-base", "text-sm", "text-xs", "text-xs", "text-xs"];
    return `<h${level} class="font-semibold ${sizes[level - 1]} mt-3 mb-1">${renderInline(hMatch[2])}</h${level}>`;
  }

  // Unordered list
  const ulMatch = line.match(/^[\-\*]\s+(.+)$/);
  if (ulMatch) {
    return `<li class="ml-4 list-disc">${renderInline(ulMatch[1])}</li>`;
  }

  // Ordered list
  const olMatch = line.match(/^\d+[\.\)]\s+(.+)$/);
  if (olMatch) {
    return `<li class="ml-4 list-decimal">${renderInline(olMatch[1])}</li>`;
  }

  // Horizontal rule
  if (/^[-*_]{3,}$/.test(line.trim())) {
    return '<hr class="my-2 border-border" />';
  }

  // Blockquote
  if (line.startsWith("> ")) {
    return `<blockquote class="border-l-2 border-accent pl-3 my-1 text-text-secondary">${renderInline(line.slice(2))}</blockquote>`;
  }

  return renderInline(line);
}

function renderInline(text: string): string {
  let result = escapeHtml(text);

  // Bold (**text**)
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>');

  // Italic (*text*)
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Inline code (`code`)
  result = result.replace(/`([^`]+)`/g, '<code class="rounded bg-primary-soft px-1 py-0.5 text-xs font-mono text-error">$1</code>');

  // Links [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-accent underline hover:text-accent/80" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  return result;
}

function renderCodeBlock(code: string, language?: string): string {
  const escaped = escapeHtml(code);
  return (
    `<div class="my-2 rounded-md border bg-primary-soft/50 overflow-hidden">` +
    (language
      ? `<div class="border-b px-3 py-1 text-xs text-text-muted font-mono">${escapeHtml(language)}</div>`
      : "") +
    `<pre class="p-3 overflow-x-auto text-xs font-mono text-text"><code>${escaped}</code></pre>` +
    `</div>`
  );
}

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = "";

  while (i < lines.length) {
    const line = lines[i];

    // Code block fence
    if (line.trim().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
        codeLines = [];
      } else {
        result.push(renderCodeBlock(codeLines.join("\n"), codeLang));
        inCodeBlock = false;
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      i++;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === "") {
      // Don't output empty <p> tags; close any open paragraph context
      i++;
      continue;
    }

    result.push(`<p class="mb-1">${renderMarkdownLine(line)}</p>`);
    i++;
  }

  // Unclosed code block
  if (inCodeBlock) {
    result.push(renderCodeBlock(codeLines.join("\n"), codeLang));
  }

  return result.join("\n");
}

interface MarkdownContentProps {
  content: string;
  sources?: Array<{ document_title: string; chunk_id: string }>;
  onSourceClick?: (index: number) => void;
}

export function MarkdownContent({ content, sources, onSourceClick }: MarkdownContentProps) {
  let html = renderMarkdown(content);

  // Replace [来源 N] with academic-style citation links: [N. 文档名称]
  if (sources && sources.length > 0) {
    html = html.replace(
      /\[来源\s*(\d+)\]/g,
      (_match: string, numStr: string) => {
        const idx = parseInt(numStr, 10) - 1;
        const src = sources[idx];
        const title = src?.document_title || `来源 ${numStr}`;
        return `<a href="#" class="source-ref-link inline text-xs text-text-muted hover:text-accent transition-colors" data-source-idx="${idx}" title="${title}">[${numStr}. ${title}]</a>`;
      }
    );
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSourceClick) return;
    const target = e.target as HTMLElement;
    const link = target.closest(".source-ref-link") as HTMLElement | null;
    if (link?.dataset.sourceIdx != null) {
      e.preventDefault();
      onSourceClick(parseInt(link.dataset.sourceIdx, 10));
    }
  };

  return (
    <div
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}
