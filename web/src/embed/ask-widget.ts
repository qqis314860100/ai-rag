type IntegrationAskResponse = {
  data?: {
    answer?: string;
    confidence?: number;
    sources?: Array<{
      document_title?: string;
      section_path?: string;
      score?: number;
    }>;
  };
};

const styles = `
:host {
  display: block;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172033;
}
.widget {
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(21, 32, 54, 0.12);
  overflow: hidden;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid #e6ebf2;
  background: #f7f9fc;
}
.title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}
.status {
  font-size: 12px;
  color: #68758a;
}
.body {
  display: grid;
  gap: 12px;
  padding: 14px;
}
textarea {
  width: 100%;
  min-height: 78px;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid #ccd5e1;
  border-radius: 6px;
  padding: 10px;
  color: #172033;
  font: inherit;
}
button {
  justify-self: end;
  border: 0;
  border-radius: 6px;
  padding: 8px 14px;
  background: #1f6feb;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.answer {
  white-space: pre-wrap;
  line-height: 1.65;
  font-size: 14px;
}
.sources {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.source {
  padding: 8px;
  border-radius: 6px;
  background: #f3f6fa;
  font-size: 12px;
  color: #44536a;
}
.error {
  color: #b42318;
  font-size: 13px;
}
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

class AiRagAskWidget extends HTMLElement {
  private shadow: ShadowRoot;
  private textarea?: HTMLTextAreaElement;
  private answer?: HTMLElement;
  private status?: HTMLElement;
  private button?: HTMLButtonElement;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.render();
  }

  private apiBase(): string {
    return this.getAttribute("api-base") || "/api";
  }

  private token(): string {
    return this.getAttribute("api-token") || "";
  }

  private render() {
    const title = escapeHtml(this.getAttribute("title") || "产线知识库问答");
    const placeholder = escapeHtml(this.getAttribute("placeholder") || "输入工位、设备、参数或异常问题");
    this.shadow.innerHTML = `
      <style>${styles}</style>
      <section class="widget" part="widget">
        <header class="header">
          <h2 class="title">${title}</h2>
          <span class="status" data-status>待提问</span>
        </header>
        <div class="body">
          <textarea data-question placeholder="${placeholder}"></textarea>
          <button type="button" data-submit>提问</button>
          <div class="answer" data-answer></div>
          <ul class="sources" data-sources></ul>
        </div>
      </section>
    `;
    this.textarea = this.shadow.querySelector("[data-question]") as HTMLTextAreaElement;
    this.answer = this.shadow.querySelector("[data-answer]") as HTMLElement;
    this.status = this.shadow.querySelector("[data-status]") as HTMLElement;
    this.button = this.shadow.querySelector("[data-submit]") as HTMLButtonElement;
    this.button.addEventListener("click", () => void this.ask());
  }

  private setBusy(busy: boolean) {
    if (this.button) this.button.disabled = busy;
    if (this.status) this.status.textContent = busy ? "查询中" : "待提问";
  }

  private async ask() {
    const question = this.textarea?.value.trim() || "";
    if (!question || !this.answer) return;
    if (!this.token()) {
      this.answer.innerHTML = `<p class="error">缺少 api-token，无法访问集成问答接口。</p>`;
      return;
    }

    this.setBusy(true);
    this.answer.textContent = "";
    this.renderSources([]);
    try {
      const response = await fetch(`${this.apiBase()}/integration/v1/ask`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token()}`,
        },
        body: JSON.stringify({ question, top_k: Number(this.getAttribute("top-k") || 5) }),
      });
      const payload = await response.json().catch(() => ({})) as IntegrationAskResponse & { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message || `请求失败：${response.status}`);
      }
      this.answer.textContent = payload.data?.answer || "暂无回答。";
      this.renderSources(payload.data?.sources || []);
      if (this.status) this.status.textContent = payload.data?.confidence !== undefined ? `置信度 ${payload.data.confidence}` : "已回答";
    } catch (error) {
      this.answer.innerHTML = `<p class="error">${error instanceof Error ? error.message : "请求失败"}</p>`;
      if (this.status) this.status.textContent = "失败";
    } finally {
      if (this.button) this.button.disabled = false;
    }
  }

  private renderSources(sources: NonNullable<IntegrationAskResponse["data"]>["sources"]) {
    const list = this.shadow.querySelector("[data-sources]") as HTMLElement | null;
    if (!list) return;
    list.innerHTML = (sources || []).slice(0, 4).map((source) => `
      <li class="source">
        ${escapeHtml(source.document_title || "未知文档")}${source.section_path ? ` / ${escapeHtml(source.section_path)}` : ""}
      </li>
    `).join("");
  }
}

if (!customElements.get("ai-rag-ask-widget")) {
  customElements.define("ai-rag-ask-widget", AiRagAskWidget);
}

export { AiRagAskWidget };
