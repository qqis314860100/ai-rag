import { memo, useCallback, useEffect, useId, useMemo, useRef } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// ─── 行内文本增强：参数值高亮 + [来源 N] badge ───
// 这两个不属于标准 markdown，需要在 text 节点上后处理。

const PARAM_RE =
  /([≥≤]?\d+(?:\.\d+)?\s*(?:MΩ|kΩ|Ω|kV|VDC|V|mV|A|mA|MPa|kPa|N|mm|cm|μm|℃|°C|s|ms|min|h)\b)/g;
const SOURCE_RE = /\[来源\s*(\d+)\]/g;
const SAFETY_KEYWORDS: Array<[RegExp, string, string]> = [
  [/禁止|严禁|不得|切勿|致命|高压危险|触电/, "border-danger bg-red-50/60 text-danger", "🚫"],
  [/危险|警告|注意安全|必须穿戴|防护|绝缘破损/, "border-warning bg-amber-50/60 text-[#b45309]", "⚠️"],
  [/注意|小心|谨慎|建议|应当/, "border-accent bg-accent-soft/60 text-accent", "💡"],
];
const EMOJI_HEAD_RE = /^([\u{1F300}-\u{1FAFF}]+)\s*/u;

interface EnhanceCtx {
  sources?: Array<{ document_title: string; chunk_id: string }>;
  onSourceClick?: (index: number) => void;
}

function enhanceString(text: string, ctx: EnhanceCtx, keyPrefix: string): ReactNode[] {
  // 先按 [来源 N] 切，再在每段内按 PARAM_RE 切，保证两个匹配互不嵌套。
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  SOURCE_RE.lastIndex = 0;
  let segCounter = 0;

  const pushPlain = (chunk: string) => {
    if (!chunk) return;
    let inner: ReactNode[] = [chunk];
    PARAM_RE.lastIndex = 0;
    const tmp: ReactNode[] = [];
    let pos = 0;
    let pm: RegExpExecArray | null;
    while ((pm = PARAM_RE.exec(chunk)) !== null) {
      if (pm.index > pos) tmp.push(chunk.slice(pos, pm.index));
      tmp.push(
        <strong
          key={`${keyPrefix}-p-${segCounter}-${pm.index}`}
          className="font-semibold text-[#b3462a] bg-red-50/60 px-1.5 py-px rounded font-mono text-[13px] tracking-tight"
        >
          {pm[1]}
        </strong>
      );
      pos = pm.index + pm[0].length;
    }
    if (pos < chunk.length) tmp.push(chunk.slice(pos));
    if (tmp.length > 0) inner = tmp;
    out.push(...inner);
  };

  while ((m = SOURCE_RE.exec(text)) !== null) {
    if (m.index > lastIdx) {
      pushPlain(text.slice(lastIdx, m.index));
    }
    const idx = parseInt(m[1], 10) - 1;
    const src = ctx.sources?.[idx];
    const title = src?.document_title || `来源 ${m[1]}`;
    const short = title.length > 20 ? `${title.slice(0, 18)}…` : title;
    out.push(
      <button
        type="button"
        key={`${keyPrefix}-src-${segCounter++}-${m.index}`}
        onClick={(event) => {
          event.preventDefault();
          ctx.onSourceClick?.(idx);
        }}
        className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 rounded-full bg-accent-soft text-[11px] text-accent hover:bg-accent hover:text-white shadow-sm-soft hover:shadow-md-soft transition-all duration-fast font-medium cursor-pointer align-baseline"
        title={title}
      >
        [{m[1]}] {short}
      </button>
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) pushPlain(text.slice(lastIdx));
  return out.length > 0 ? out : [text];
}

function enhanceChildren(children: ReactNode, ctx: EnhanceCtx, keyPrefix: string): ReactNode {
  if (children == null || children === false) return children;
  if (typeof children === "string") return enhanceString(children, ctx, keyPrefix);
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === "string" ? (
        <span key={`${keyPrefix}-${i}`}>{enhanceString(child, ctx, `${keyPrefix}-${i}`)}</span>
      ) : (
        child
      )
    );
  }
  return children;
}

function nodeToPlainText(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToPlainText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeToPlainText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

// ─── sanitize schema 放宽 className，让我们的样式 hook 不被吃掉 ───
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), "className"],
    span: [...(defaultSchema.attributes?.span || []), "className"],
    div: [...(defaultSchema.attributes?.div || []), "className"],
    pre: [...(defaultSchema.attributes?.pre || []), "className"],
  },
};

// ─── 代码块：带语言 label + 复制 ───
function CodeBlockCard({ language, code }: { language?: string; code: string }) {
  const preRef = useRef<HTMLPreElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleCopy = useCallback(() => {
    const text = preRef.current?.textContent || "";
    void navigator.clipboard.writeText(text).then(() => {
      const btn = btnRef.current;
      if (!btn) return;
      btn.textContent = "已复制";
      window.setTimeout(() => {
        if (btn) btn.textContent = "复制";
      }, 1500);
    });
  }, []);

  return (
    <div className="my-4 rounded-xl border border-border overflow-hidden shadow-sm-soft code-block-wrapper">
      <div className="flex items-center justify-between px-4 py-2 bg-surface-page border-b border-divider">
        <span className={language ? "text-xs text-text-muted font-mono" : "text-xs text-text-muted/50"}>
          {language || "code"}
        </span>
        <button
          ref={btnRef}
          type="button"
          onClick={handleCopy}
          className="text-[10px] text-text-muted hover:text-accent transition-colors font-medium"
        >
          复制
        </button>
      </div>
      <pre
        ref={preRef}
        className="p-4 overflow-x-auto text-[13px] font-mono text-text leading-relaxed bg-[#fafaf8]"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ─── 表格：带复制 CSV 按钮 ───
function TableCard({ children }: { children?: ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleCopy = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    const rows: string[] = [];
    table.querySelectorAll("tr").forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll("th,td").forEach((td) => {
        cells.push((td.textContent || "").trim());
      });
      rows.push(cells.join("\t"));
    });
    void navigator.clipboard.writeText(rows.join("\n")).then(() => {
      const btn = btnRef.current;
      if (!btn) return;
      btn.textContent = "已复制";
      window.setTimeout(() => {
        if (btn) btn.textContent = "复制CSV";
      }, 1500);
    });
  }, []);

  return (
    <div className="my-4 rounded-xl border border-border shadow-sm-soft overflow-hidden">
      <div className="flex items-center justify-end px-3 py-1.5 bg-surface-page border-b border-divider">
        <span className="text-[10px] text-text-muted/50">表格</span>
        <button
          ref={btnRef}
          type="button"
          onClick={handleCopy}
          className="ml-2 text-[10px] text-text-muted hover:text-accent transition-colors font-medium"
        >
          复制CSV
        </button>
      </div>
      <div className="overflow-x-auto table-scroll">
        <table ref={tableRef} className="w-full text-left">
          {children}
        </table>
      </div>
    </div>
  );
}

interface MarkdownContentProps {
  content: string;
  sources?: Array<{ document_title: string; chunk_id: string }>;
  onSourceClick?: (index: number) => void;
}

function MarkdownContentInner({ content, sources, onSourceClick }: MarkdownContentProps) {
  const id = useId();
  // 用 ref 透传最新 callback，避免父组件每次 render 引起整个 memo 失效
  const ctxRef = useRef<EnhanceCtx>({ sources, onSourceClick });
  useEffect(() => {
    ctxRef.current = { sources, onSourceClick };
  }, [sources, onSourceClick]);

  const enhance = useCallback(
    (children: ReactNode, keyPrefix: string) =>
      enhanceChildren(children, ctxRef.current, `${id}-${keyPrefix}`),
    [id]
  );

  const components = useMemo(
    () => ({
      h1: ({ children }: ComponentPropsWithoutRef<"h1">) => (
        <h1 className="font-semibold text-lg mt-6 mb-3 text-text">{enhance(children, "h1")}</h1>
      ),
      h2: ({ children }: ComponentPropsWithoutRef<"h2">) => (
        <h2 className="font-semibold text-base mt-5 mb-2 text-text">{enhance(children, "h2")}</h2>
      ),
      h3: ({ children }: ComponentPropsWithoutRef<"h3">) => (
        <h3 className="font-semibold text-sm mt-4 mb-1.5 text-text">{enhance(children, "h3")}</h3>
      ),
      h4: ({ children }: ComponentPropsWithoutRef<"h4">) => (
        <h4 className="font-semibold text-xs mt-3 mb-1 text-text">{enhance(children, "h4")}</h4>
      ),
      p: ({ children }: ComponentPropsWithoutRef<"p">) => (
        <p className="mb-2 text-[15px] leading-relaxed break-words">{enhance(children, "p")}</p>
      ),
      ul: ({ children }: ComponentPropsWithoutRef<"ul">) => (
        <ul className="mb-2 ml-1 list-disc marker:text-accent space-y-1">{children}</ul>
      ),
      ol: ({ children }: ComponentPropsWithoutRef<"ol">) => (
        <ol className="mb-2 ml-1 list-decimal marker:text-accent marker:font-medium space-y-1">{children}</ol>
      ),
      li: ({ children }: ComponentPropsWithoutRef<"li">) => (
        <li className="ml-4 text-[15px] leading-relaxed break-words">{enhance(children, "li")}</li>
      ),
      hr: () => <hr className="my-5 border-border" />,
      a: ({ href, children }: ComponentPropsWithoutRef<"a">) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline decoration-accent/30 hover:decoration-accent transition-colors"
        >
          {children}
        </a>
      ),
      strong: ({ children }: ComponentPropsWithoutRef<"strong">) => (
        <strong className="font-semibold text-text">{children}</strong>
      ),
      em: ({ children }: ComponentPropsWithoutRef<"em">) => <em>{children}</em>,
      blockquote: ({ children }: ComponentPropsWithoutRef<"blockquote">) => {
        const plain = nodeToPlainText(children).trim();
        const safety = SAFETY_KEYWORDS.find(([re]) => re.test(plain));
        if (safety) {
          const [, borderClass, icon] = safety;
          return (
            <blockquote
              className={`border-l-[3px] ${borderClass} rounded-r-lg pl-4 pr-3 py-2.5 my-2 text-[14px] leading-relaxed`}
            >
              <span className="inline-flex items-start gap-1.5 font-semibold">
                <span>{icon}</span>
                <span>{enhance(children, "bq-safe")}</span>
              </span>
            </blockquote>
          );
        }
        const emojiMatch = plain.match(EMOJI_HEAD_RE);
        if (emojiMatch) {
          return (
            <blockquote className="border-l-[3px] border-accent bg-accent-soft/60 rounded-r-lg pl-4 pr-3 py-2.5 my-2 text-text-secondary text-[14px] leading-relaxed">
              <span className="inline-flex items-start gap-1.5 font-medium text-text">
                {enhance(children, "bq-emoji")}
              </span>
            </blockquote>
          );
        }
        return (
          <blockquote className="border-l-[3px] border-border hover:border-accent/40 bg-surface-page rounded-r-lg pl-4 pr-3 py-2.5 my-2 text-text-secondary text-[14px] leading-relaxed transition-colors">
            {enhance(children, "bq")}
          </blockquote>
        );
      },
      pre: (props: ComponentPropsWithoutRef<"pre">) => {
        // 仅处理 react-markdown 默认包出来的 <pre><code>，剥掉 pre 用 CodeBlockCard 替代
        const child = Array.isArray(props.children) ? props.children[0] : props.children;
        if (child && typeof child === "object" && "props" in child) {
          const codeProps = (child as { props: { className?: string; children?: ReactNode } }).props;
          const className = codeProps.className || "";
          const match = /language-(\w+)/.exec(className);
          const code = nodeToPlainText(codeProps.children).replace(/\n$/, "");
          return <CodeBlockCard language={match?.[1]} code={code} />;
        }
        return <pre {...props} />;
      },
      code: ({ className, children }: ComponentPropsWithoutRef<"code">) => {
        // 走到这里都是 inline code（block 由 pre 拦截）
        const text = typeof children === "string" ? children : nodeToPlainText(children);
        return (
          <code className={`rounded-md bg-primary-soft px-1.5 py-0.5 text-[13px] font-mono text-primary ${className || ""}`}>
            {text}
          </code>
        );
      },
      table: ({ children }: ComponentPropsWithoutRef<"table">) => <TableCard>{children}</TableCard>,
      thead: ({ children }: ComponentPropsWithoutRef<"thead">) => <thead>{children}</thead>,
      tbody: ({ children }: ComponentPropsWithoutRef<"tbody">) => <tbody>{children}</tbody>,
      tr: ({ children }: ComponentPropsWithoutRef<"tr">) => (
        <tr className="hover:bg-accent/5 transition-colors">{children}</tr>
      ),
      th: ({ children }: ComponentPropsWithoutRef<"th">) => (
        <th className="px-3 py-2.5 text-left text-xs font-semibold text-text-secondary bg-surface-hover border-b border-border whitespace-nowrap">
          {enhance(children, "th")}
        </th>
      ),
      td: ({ children }: ComponentPropsWithoutRef<"td">) => (
        <td className="px-3 py-2 text-sm text-text-secondary border-b border-divider whitespace-nowrap">
          {enhance(children, "td")}
        </td>
      ),
    }),
    [enhance]
  );

  return (
    <div className="markdown-content break-words">
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA]]}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
}

// memo：只在 content / sources 变化时重渲染；onSourceClick 走 ref，
// 避免父组件每次 render 都通过 inline closure 让整段 markdown 重算。
export const MarkdownContent = memo(MarkdownContentInner, (prev, next) => {
  return prev.content === next.content && prev.sources === next.sources;
});
