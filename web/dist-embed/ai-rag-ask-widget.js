var AiRagAskWidget=function(t){"use strict";var f=Object.defineProperty;var g=(t,e,s)=>e in t?f(t,e,{enumerable:!0,configurable:!0,writable:!0,value:s}):t[e]=s;var n=(t,e,s)=>g(t,typeof e!="symbol"?e+"":e,s);const e=`
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
`;function s(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}class c extends HTMLElement{constructor(){super();n(this,"shadow");n(this,"textarea");n(this,"answer");n(this,"status");n(this,"button");this.shadow=this.attachShadow({mode:"open"})}connectedCallback(){this.render()}apiBase(){return this.getAttribute("api-base")||"/api"}token(){return this.getAttribute("api-token")||""}render(){const a=s(this.getAttribute("title")||"产线知识库问答"),i=s(this.getAttribute("placeholder")||"输入工位、设备、参数或异常问题");this.shadow.innerHTML=`
      <style>${e}</style>
      <section class="widget" part="widget">
        <header class="header">
          <h2 class="title">${a}</h2>
          <span class="status" data-status>待提问</span>
        </header>
        <div class="body">
          <textarea data-question placeholder="${i}"></textarea>
          <button type="button" data-submit>提问</button>
          <div class="answer" data-answer></div>
          <ul class="sources" data-sources></ul>
        </div>
      </section>
    `,this.textarea=this.shadow.querySelector("[data-question]"),this.answer=this.shadow.querySelector("[data-answer]"),this.status=this.shadow.querySelector("[data-status]"),this.button=this.shadow.querySelector("[data-submit]"),this.button.addEventListener("click",()=>void this.ask())}setBusy(a){this.button&&(this.button.disabled=a),this.status&&(this.status.textContent=a?"查询中":"待提问")}async ask(){var i,r,u,h,p;const a=((i=this.textarea)==null?void 0:i.value.trim())||"";if(!(!a||!this.answer)){if(!this.token()){this.answer.innerHTML='<p class="error">缺少 api-token，无法访问集成问答接口。</p>';return}this.setBusy(!0),this.answer.textContent="",this.renderSources([]);try{const o=await fetch(`${this.apiBase()}/integration/v1/ask`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${this.token()}`},body:JSON.stringify({question:a,top_k:Number(this.getAttribute("top-k")||5)})}),d=await o.json().catch(()=>({}));if(!o.ok)throw new Error(((r=d.error)==null?void 0:r.message)||`请求失败：${o.status}`);this.answer.textContent=((u=d.data)==null?void 0:u.answer)||"暂无回答。",this.renderSources(((h=d.data)==null?void 0:h.sources)||[]),this.status&&(this.status.textContent=((p=d.data)==null?void 0:p.confidence)!==void 0?`置信度 ${d.data.confidence}`:"已回答")}catch(o){this.answer.innerHTML=`<p class="error">${o instanceof Error?o.message:"请求失败"}</p>`,this.status&&(this.status.textContent="失败")}finally{this.button&&(this.button.disabled=!1)}}}renderSources(a){const i=this.shadow.querySelector("[data-sources]");i&&(i.innerHTML=(a||[]).slice(0,4).map(r=>`
      <li class="source">
        ${s(r.document_title||"未知文档")}${r.section_path?` / ${s(r.section_path)}`:""}
      </li>
    `).join(""))}}return customElements.get("ai-rag-ask-widget")||customElements.define("ai-rag-ask-widget",c),t.AiRagAskWidget=c,Object.defineProperty(t,Symbol.toStringTag,{value:"Module"}),t}({});
