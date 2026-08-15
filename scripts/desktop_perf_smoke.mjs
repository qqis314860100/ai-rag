#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const DEFAULT_WEB_URL = "http://localhost:5174";
const DEFAULT_API_URL = "http://localhost:3001";
const DEFAULT_QUESTION = "电芯分选的OCV开路电压测试合格范围是多少？";
const DEFAULT_TIMEOUT_MS = 45_000;

function parseArgs(argv) {
  const args = {
    webUrl: DEFAULT_WEB_URL,
    apiUrl: DEFAULT_API_URL,
    question: DEFAULT_QUESTION,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    browser: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--web") args.webUrl = argv[++index] || args.webUrl;
    else if (item === "--api") args.apiUrl = argv[++index] || args.apiUrl;
    else if (item === "--question") args.question = argv[++index] || args.question;
    else if (item === "--timeout-ms") args.timeoutMs = Number(argv[++index] || args.timeoutMs);
    else if (item === "--browser") args.browser = true;
    else if (item === "--dry-run") args.dryRun = true;
    else if (item === "--help" || item === "-h") args.help = true;
  }

  return args;
}

function printHelp() {
  console.log(`桌面性能 smoke

用法:
  pnpm run smoke:desktop-perf -- --web http://localhost:5174 --api http://localhost:3001

参数:
  --web <url>        Web 地址，默认 ${DEFAULT_WEB_URL}
  --api <url>        API 地址，默认 ${DEFAULT_API_URL}
  --question <text>  流式问答基线问题
  --timeout-ms <n>   单项等待超时，默认 ${DEFAULT_TIMEOUT_MS}
  --browser          如果本机安装了 playwright，补充真实浏览器首屏和长会话滚动基线
  --dry-run          只输出配置并执行本地合成基线，不请求服务
`);
}

function roundMs(value) {
  return Math.round(value);
}

function metric(name, value, detail = {}) {
  return {
    name,
    value_ms: typeof value === "number" ? roundMs(value) : null,
    ...detail,
  };
}

async function measureHttpFirstScreen(webUrl, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  try {
    const response = await fetch(webUrl, { signal: controller.signal });
    const firstByteMs = performance.now() - start;
    const html = await response.text();
    const completeMs = performance.now() - start;
    return [
      metric("web_first_byte", firstByteMs, { status: response.status }),
      metric("web_html_complete", completeMs, { bytes: html.length }),
    ];
  } finally {
    clearTimeout(timeout);
  }
}

async function readStreamChat(apiUrl, question, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  const response = await fetch(`${apiUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ message: question, stream: true, top_k: 5 }),
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    throw new Error(`流式聊天请求失败：${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let firstEventMs = null;
  let firstTokenMs = null;
  let fullAnswer = "";
  let messageId = "";
  let sessionId = "";
  let eventCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        eventCount += 1;
        if (firstEventMs === null) firstEventMs = performance.now() - start;
        const payload = JSON.parse(line.slice(6));
        if (payload.type === "token") {
          if (firstTokenMs === null) firstTokenMs = performance.now() - start;
          fullAnswer += payload.content || "";
        }
        if (payload.type === "saved") {
          messageId = String(payload.message_id || "");
          sessionId = String(payload.session_id || "");
        }
        if (payload.type === "error") {
          throw new Error(String(payload.message || "流式聊天返回错误"));
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  const completeMs = performance.now() - start;
  return {
    messageId,
    sessionId,
    metrics: [
      metric("chat_first_sse_event", firstEventMs, { event_count: eventCount }),
      metric("chat_first_token", firstTokenMs, { answer_chars: fullAnswer.length }),
      metric("chat_full_answer_saved", completeMs, { message_id: messageId, session_id: sessionId }),
    ],
  };
}

async function measureDiagramOpen(apiUrl, messageId, timeoutMs) {
  if (!messageId) {
    return [metric("diagram_open", null, { skipped: true, reason: "missing_message_id" })];
  }

  const start = performance.now();
  const response = await fetch(`${apiUrl}/api/chat/messages/${encodeURIComponent(messageId)}/artifacts/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "mindmap", title: "性能验收图解" }),
  });
  if (!response.ok) throw new Error(`图解生成请求失败：${response.status}`);
  const queued = await response.json();
  let artifact = queued.data;
  const queuedMs = performance.now() - start;

  while (artifact?.status === "pending" && performance.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const poll = await fetch(`${apiUrl}/api/chat/artifacts/${encodeURIComponent(artifact.id)}`);
    if (!poll.ok) throw new Error(`图解轮询失败：${poll.status}`);
    artifact = (await poll.json()).data;
  }

  if (artifact?.status !== "ready") {
    throw new Error(`图解未生成到 ready 状态：${artifact?.status || "unknown"}，artifact_id=${artifact?.id || ""}`);
  }

  return [
    metric("diagram_queue_ack", queuedMs, { artifact_id: artifact?.id || "", status: queued.data?.status || "" }),
    metric("diagram_open_ready", performance.now() - start, { artifact_id: artifact?.id || "", status: artifact?.status || "unknown" }),
  ];
}

function measureSyntheticLongThread() {
  const start = performance.now();
  const messages = Array.from({ length: 160 }, (_, index) => ({
    id: `synthetic-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `第 ${index + 1} 条消息：用于模拟桌面长会话滚动和消息摘要计算。`.repeat(index % 2 === 0 ? 2 : 12),
  }));

  // 没有浏览器依赖时，用长会话数据整形作为低成本基线，真实滚动由 --browser 补充。
  const visibleBlocks = messages.slice(-60).map((message) => ({
    id: message.id,
    preview: message.content.replace(/\s+/g, " ").slice(0, 160),
    heightBucket: message.content.length > 420 ? "long" : "short",
  }));

  return metric("long_thread_data_baseline", performance.now() - start, { rows: visibleBlocks.length });
}

async function measureBrowserIfAvailable(webUrl, timeoutMs) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return [
      metric("browser_first_screen", null, { skipped: true, reason: "playwright_not_installed" }),
      metric("browser_long_thread_scroll", null, { skipped: true, reason: "playwright_not_installed" }),
    ];
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  try {
    const start = performance.now();
    await page.goto(`${webUrl}/chat`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.getByRole("textbox").first().waitFor({ timeout: timeoutMs });
    const firstScreenMs = performance.now() - start;

    await page.evaluate(() => {
      const container = document.querySelector(".chat-scroll-area");
      if (!container) return;
      const block = document.createElement("div");
      block.setAttribute("data-perf-smoke", "long-thread");
      block.innerHTML = Array.from({ length: 120 }, (_, index) => (
        `<article style="padding:12px;border-bottom:1px solid #eee">性能基线消息 ${index + 1}<p>${"长会话滚动内容 ".repeat(20)}</p></article>`
      )).join("");
      container.appendChild(block);
    });
    const scrollStart = performance.now();
    await page.evaluate(() => {
      const container = document.querySelector(".chat-scroll-area");
      if (container) container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
    });
    await page.waitForTimeout(100);

    return [
      metric("browser_first_screen", firstScreenMs),
      metric("browser_long_thread_scroll", performance.now() - scrollStart),
    ];
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const metrics = [];
  const startedAt = new Date().toISOString();

  if (!args.dryRun) {
    metrics.push(...await measureHttpFirstScreen(args.webUrl, args.timeoutMs));
    const chat = await readStreamChat(args.apiUrl, args.question, args.timeoutMs);
    metrics.push(...chat.metrics);
    metrics.push(...await measureDiagramOpen(args.apiUrl, chat.messageId, args.timeoutMs));
  }

  metrics.push(measureSyntheticLongThread());
  if (args.browser) {
    metrics.push(...await measureBrowserIfAvailable(args.webUrl, args.timeoutMs));
  }

  console.log(JSON.stringify({
    schema_version: "desktop-perf-smoke/v1",
    started_at: startedAt,
    web_url: args.webUrl,
    api_url: args.apiUrl,
    question: args.question,
    dry_run: args.dryRun,
    browser_requested: args.browser,
    metrics,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
