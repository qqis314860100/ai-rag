// Lightweight markdown renderer — handles common LLM formatting
// patterns including tables, code blocks, styled quotes, and safety callouts.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderInline(text: string): string {
  let result = escapeHtml(text);

  // Bold (**text**)
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-text">$1</strong>');

  // Italic (*text*)
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Inline code (`code`)
  result = result.replace(/`([^`]+)`/g, '<code class="rounded-md bg-primary-soft px-1.5 py-0.5 text-[13px] font-mono text-primary">$1</code>');

  // Links [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="text-accent underline decoration-accent/30 hover:decoration-accent transition-colors" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Highlight engineering parameter values: ≥200MΩ, 500VDC, 3s, ≤0.5mm etc.
  // Use monospace font + subtle badge background for production readability
  result = result.replace(
    /([≥≤]?\d+(?:\.\d+)?\s*(?:MΩ|kΩ|Ω|kV|VDC|V|mV|A|mA|MPa|kPa|N|mm|cm|μm|℃|°C|s|ms|min|h)\b)/g,
    '<strong class="param-value font-semibold text-[#b3462a] bg-red-50/60 px-1.5 py-px rounded font-mono text-[13px] tracking-tight">$1</strong>'
  );

  return result;
}

// Safety-related keywords → color mapping for callout detection
const safetyKeywords: [RegExp, string, string][] = [
  [/禁止|严禁|不得|切勿|致命|高压危险|触电/g, "border-danger bg-red-50/60 text-danger", "🚫"],
  [/危险|警告|注意安全|必须穿戴|防护|绝缘破损/g, "border-warning bg-amber-50/60 text-[#b45309]", "⚠️"],
  [/注意|小心|谨慎|建议|应当/g, "border-accent bg-accent-soft/60 text-accent", "💡"],
];

function detectSafetyCallout(line: string): { content: string; borderClass: string; icon: string } | null {
  for (const [regex, borderClass, icon] of safetyKeywords) {
    if (regex.test(line)) {
      return { content: line, borderClass, icon };
    }
  }
  return null;
}

function renderMarkdownLine(line: string): string {
  // Heading
  const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (hMatch) {
    const level = hMatch[1].length;
    const sizes = ["text-lg", "text-base", "text-sm", "text-xs", "text-xs", "text-xs"];
    const margins = ["mt-6 mb-3", "mt-5 mb-2", "mt-4 mb-1.5", "mt-3 mb-1"];
    const m = margins[Math.min(level - 1, margins.length - 1)];
    return `<h${level} class="font-semibold ${sizes[level - 1]} ${m} text-text">${renderInline(hMatch[2])}</h${level}>`;
  }

  // Unordered list
  const ulMatch = line.match(/^[-*]\s+(.+)$/);
  if (ulMatch) {
    return `<li class="ml-4 list-disc marker:text-accent">${renderInline(ulMatch[1])}</li>`;
  }

  // Ordered list
  const olMatch = line.match(/^\d+[.)]\s+(.+)$/);
  if (olMatch) {
    return `<li class="ml-4 list-decimal marker:text-accent marker:font-medium">${renderInline(olMatch[1])}</li>`;
  }

  // Horizontal rule
  if (/^[-*_]{3,}$/.test(line.trim())) {
    return '<hr class="my-5 border-border" />';
  }

  // Blockquote — with safety callout detection
  if (line.startsWith("> ")) {
    const quoteContent = line.slice(2);
    const renderedContent = renderInline(quoteContent);

    // Check for safety callout
    const safety = detectSafetyCallout(quoteContent);
    if (safety) {
      return `<blockquote class="border-l-[3px] ${safety.borderClass} rounded-r-lg pl-4 pr-3 py-2.5 my-2 text-[14px] leading-relaxed">
        <span class="inline-flex items-center gap-1.5 font-semibold">${safety.icon} ${renderedContent}</span>
      </blockquote>`;
    }

    // Check for emoji callout
    const calloutMatch = renderedContent.match(/^([\u{1F300}-\u{1FAFF}]+)\s*(.*)/u);
    if (calloutMatch) {
      return `<blockquote class="border-l-[3px] border-accent bg-accent-soft/60 rounded-r-lg pl-4 pr-3 py-2.5 my-2 text-text-secondary text-[14px] leading-relaxed">
        <span class="inline-flex items-center gap-1.5 font-medium text-text">${calloutMatch[1]} ${calloutMatch[2]}</span>
      </blockquote>`;
    }

    return `<blockquote class="border-l-[3px] border-border hover:border-accent/40 bg-surface-page rounded-r-lg pl-4 pr-3 py-2.5 my-2 text-text-secondary text-[14px] leading-relaxed transition-colors">${renderedContent}</blockquote>`;
  }

  return `<span>${renderInline(line)}</span>`;
}

function renderTable(lines: string[]): string {
  if (lines.length < 2) return "";

  const parseRow = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const headerCells = parseRow(lines[0]);
  const isSeparator = (l: string) => /^\|[\s\-:|]+\|$/.test(l);
  const sepLineIdx = lines.findIndex((l, i) => i > 0 && isSeparator(l));

  let headers = headerCells;
  let bodyLines = lines.slice(1);

  if (sepLineIdx > 0) {
    headers = parseRow(lines[sepLineIdx - 1]);
    bodyLines = [...lines.slice(0, sepLineIdx - 1), ...lines.slice(sepLineIdx + 1)];
    bodyLines = bodyLines.filter((l) => isSeparator(l) === false);
  }

  const thHtml = headers
    .map((h) => `<th class="px-3 py-2.5 text-left text-xs font-semibold text-text-secondary bg-surface-hover border-b border-border first:rounded-tl-lg last:rounded-tr-lg whitespace-nowrap">${renderInline(h)}</th>`)
    .join("");

  const trHtml = bodyLines
    .map((row) => {
      const cells = parseRow(row);
      while (cells.length < headers.length) cells.push("");
      const tdHtml = cells
        .map((c, i) => `<td class="px-3 py-2 text-sm text-text-secondary border-b border-divider whitespace-nowrap ${i === 0 ? "font-medium text-text" : ""}">${renderInline(c)}</td>`)
        .join("");
      return `<tr class="hover:bg-accent/5 transition-colors">${tdHtml}</tr>`;
    })
    .join("");

  const tableId = `table-${Math.random().toString(36).slice(2, 8)}`;

  return `<div class="my-4 rounded-xl border border-border shadow-sm-soft overflow-hidden">
    <div class="flex items-center justify-end px-3 py-1.5 bg-surface-page border-b border-divider">
      <span class="text-[10px] text-text-muted/50">表格</span>
      <button
        class="ml-2 text-[10px] text-text-muted hover:text-accent transition-colors font-medium"
        onclick="const t=document.getElementById('${tableId}'); const r=[]; t.querySelectorAll('tr').forEach(tr=>{const c=[];tr.querySelectorAll('th,td').forEach(td=>c.push(td.textContent?.trim()||''));r.push(c.join('\\t'))}); navigator.clipboard.writeText(r.join('\\n')); this.textContent='已复制'; setTimeout(()=>{this.textContent='复制CSV'},1500)"
      >复制CSV</button>
    </div>
    <div class="overflow-x-auto table-scroll">
      <table id="${tableId}" class="w-full text-left">
        <thead><tr>${thHtml}</tr></thead>
        <tbody>${trHtml}</tbody>
      </table>
    </div>
  </div>`;
}

let codeBlockIdCounter = 0;

function renderCodeBlock(code: string, language?: string): string {
  const id = `code-${++codeBlockIdCounter}`;
  return (
    `<div class="my-4 rounded-xl border border-border overflow-hidden shadow-sm-soft code-block-wrapper">` +
    `<div class="flex items-center justify-between px-4 py-2 bg-surface-page border-b border-divider">` +
    (language
      ? `<span class="text-xs text-text-muted font-mono">${escapeHtml(language)}</span>`
      : `<span class="text-xs text-text-muted/50">code</span>`) +
    `<button
      class="text-[10px] text-text-muted hover:text-accent transition-colors font-medium"
      onclick="var el=document.getElementById('${id}'); navigator.clipboard.writeText(el.textContent||''); this.textContent='已复制'; setTimeout(function(){this.textContent='复制'}.bind(this),1500)"
    >复制</button>` +
    `</div>` +
    `<pre id="${id}" class="p-4 overflow-x-auto text-[13px] font-mono text-text leading-relaxed bg-[#fafaf8]"><code>${escapeHtml(code)}</code></pre>` +
    `</div>`
  );
}

export function renderMarkdown(md: string): string {
  const rawLines = md.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // Code block fence — consume until closing fence
    if (line.trim().startsWith("```")) {
      const codeLang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length) {
        if (rawLines[i].trim().startsWith("```")) { i++; break; }
        codeLines.push(rawLines[i]);
        i++;
      }
      result.push(renderCodeBlock(codeLines.join("\n"), codeLang));
      continue;
    }

    // Table detection — consecutive lines starting/ending with |
    if (/^\|.+\|$/.test(line.trim())) {
      const tableLines: string[] = [];
      while (i < rawLines.length) {
        const l = rawLines[i].trim();
        if (!/^\|.+\|$/.test(l) && !/^\|[\s\-:|]+\|$/.test(l)) break;
        tableLines.push(l);
        i++;
      }
      if (tableLines.length >= 2) {
        result.push(renderTable(tableLines));
        continue;
      }
      i -= tableLines.length;
    }

    const trimmed = line.trim();
    if (trimmed === "") {
      i++;
      continue;
    }

    result.push(`<p class="mb-2 text-[15px] leading-relaxed">${renderMarkdownLine(line)}</p>`);
    i++;
  }

  return result.join("\n");
}

interface MarkdownContentProps {
  content: string;
  sources?: Array<{ document_title: string; chunk_id: string }>;
  onSourceClick?: (index: number) => void;
}

export function MarkdownContent({ content, sources, onSourceClick }: MarkdownContentProps) {
  // Reset code block counter for each render to avoid duplicate IDs
  codeBlockIdCounter = 0;

  let html = renderMarkdown(content);

  // Replace [来源 N] with styled citation badges
  if (sources && sources.length > 0) {
    html = html.replace(
      /\[来源\s*(\d+)\]/g,
      (_match: string, numStr: string) => {
        const idx = parseInt(numStr, 10) - 1;
        const src = sources[idx];
        const title = src?.document_title || `来源 ${numStr}`;
        const shortTitle = title.length > 20 ? title.slice(0, 18) + "…" : title;
        return `<a href="#" class="source-ref-link inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-soft text-[11px] text-accent hover:bg-accent hover:text-white shadow-sm-soft hover:shadow-md-soft transition-all duration-fast font-medium cursor-pointer no-underline" data-source-idx="${idx}" title="${title}">[${numStr}] ${shortTitle}</a>`;
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
