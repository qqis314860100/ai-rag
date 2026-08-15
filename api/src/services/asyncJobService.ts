import { v4 as uuidv4 } from "uuid";

export type AsyncJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface AsyncJobRecord<T = unknown> {
  id: string;
  kind: string;
  status: AsyncJobStatus;
  input: Record<string, unknown>;
  result?: T;
  error?: {
    message: string;
    code?: string;
    detail?: Record<string, unknown>;
  };
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

const jobs = new Map<string, AsyncJobRecord>();
const JOB_TTL_MS = 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function cloneJob<T = unknown>(job: AsyncJobRecord<T>): AsyncJobRecord<T> {
  return JSON.parse(JSON.stringify(job)) as AsyncJobRecord<T>;
}

function cleanupExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const updatedAt = Date.parse(job.updated_at);
    if (Number.isFinite(updatedAt) && now - updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

function errorPayload(error: unknown): AsyncJobRecord["error"] {
  if (error instanceof Error) {
    const detail = "detail" in error && typeof error.detail === "object" && error.detail !== null
      ? error.detail as Record<string, unknown>
      : undefined;
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return { message: error.message, code, detail };
  }
  return { message: String(error) };
}

export function createAsyncJob(kind: string, input: Record<string, unknown> = {}): AsyncJobRecord {
  cleanupExpiredJobs();
  const timestamp = nowIso();
  const job: AsyncJobRecord = {
    id: uuidv4(),
    kind,
    status: "queued",
    input,
    created_at: timestamp,
    updated_at: timestamp,
  };
  jobs.set(job.id, job);
  return cloneJob(job);
}

export function getAsyncJob(id: string): AsyncJobRecord | null {
  cleanupExpiredJobs();
  const job = jobs.get(id);
  return job ? cloneJob(job) : null;
}

export function formatAsyncJob(job: AsyncJobRecord) {
  return cloneJob(job);
}

export function runAsyncJob<T>(jobId: string, runner: () => Promise<T> | T): void {
  setImmediate(async () => {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = "running";
    job.updated_at = nowIso();

    try {
      job.result = await runner();
      job.status = "succeeded";
      job.completed_at = nowIso();
    } catch (error) {
      job.error = errorPayload(error);
      job.status = "failed";
      job.completed_at = nowIso();
    } finally {
      job.updated_at = nowIso();
    }
  });
}
