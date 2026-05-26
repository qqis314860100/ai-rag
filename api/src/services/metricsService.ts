type RequestMetric = {
  timestamp: number;
  route: string;
  method: string;
  status: number;
  durationMs: number;
  errorCode?: string;
};

type ChatMetric = {
  timestamp: number;
  sourceCount: number;
  llmCalled: boolean;
};

const WINDOW_MS = 5 * 60 * 1000;
const MAX_SAMPLES = 5000;

const requestSamples: RequestMetric[] = [];
const chatSamples: ChatMetric[] = [];

function trimWindow<T extends { timestamp: number }>(items: T[], now = Date.now()): void {
  const cutoff = now - WINDOW_MS;
  while (items.length > 0 && (items[0].timestamp < cutoff || items.length > MAX_SAMPLES)) {
    items.shift();
  }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function recordRequestMetric(input: Omit<RequestMetric, "timestamp">): void {
  const now = Date.now();
  requestSamples.push({ ...input, timestamp: now });
  trimWindow(requestSamples, now);
}

export function recordChatMetric(input: Omit<ChatMetric, "timestamp">): void {
  const now = Date.now();
  chatSamples.push({ ...input, timestamp: now });
  trimWindow(chatSamples, now);
}

export function getRollingMetrics() {
  const now = Date.now();
  trimWindow(requestSamples, now);
  trimWindow(chatSamples, now);

  const durations = requestSamples.map((item) => item.durationMs);
  const errors = requestSamples.filter((item) => item.status >= 500 || item.errorCode).length;
  const artifactRequests = requestSamples.filter((item) => /\/chat\/(?:messages\/[^/]+\/)?artifacts/.test(item.route));
  const artifactSuccess = artifactRequests.filter((item) => item.status < 400).length;
  const llmCalls = chatSamples.filter((item) => item.llmCalled).length;
  const retrievalHits = chatSamples.filter((item) => item.sourceCount > 0).length;

  return {
    window_seconds: WINDOW_MS / 1000,
    request_count: requestSamples.length,
    qps: round(requestSamples.length / (WINDOW_MS / 1000)),
    latency_ms: {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
    },
    error_rate: requestSamples.length > 0 ? round(errors / requestSamples.length) : 0,
    llm_call_count: llmCalls,
    retrieval_hit_rate: chatSamples.length > 0 ? round(retrievalHits / chatSamples.length) : 0,
    artifact_success_rate: artifactRequests.length > 0 ? round(artifactSuccess / artifactRequests.length) : 0,
  };
}
