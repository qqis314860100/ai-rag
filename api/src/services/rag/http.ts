import { loadConfig, type Config } from "../../config";
import { AppError, ErrorCodes } from "../../utils/errors";

let config: Config;

export function getConfig(): Config {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

export function getRagServiceUrl(): string {
  return getConfig().ragServiceUrl;
}

export function ragHeaders(requestId?: string, userId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (requestId) headers["X-Request-Id"] = requestId;
  if (userId) headers["X-User-Id"] = userId;
  // API 网关与 RAG 服务间的共享密钥（配置后 RAG 所有端点要求 X-API-Key）
  if (getConfig().ragApiKey) headers["X-API-Key"] = getConfig().ragApiKey;
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function ragFetch<T>(
  path: string,
  body: unknown,
  requestId?: string,
  userId?: string
): Promise<T> {
  const url = `${getRagServiceUrl()}${path}`;

  let lastError: Error | null = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(url, {
        method: "POST",
        headers: ragHeaders(requestId, userId),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorDetail: Record<string, unknown> | undefined;
        try {
          errorDetail = JSON.parse(errorText);
        } catch {
          // RAG 非 JSON 错误体保留为空，避免把 HTML/纯文本透传成结构化 detail。
        }

        if (response.status === 503 || response.status === 502) {
          throw new AppError(
            ErrorCodes.VECTOR_STORE_UNAVAILABLE,
            "向量库不可用，请稍后重试。",
            503,
            errorDetail
          );
        }
        if (response.status === 429) {
          const detail = isRecord(errorDetail?.detail)
            ? errorDetail.detail
            : isRecord(errorDetail)
              ? errorDetail
              : undefined;
          const message = typeof detail?.message === "string" ? detail.message : "LLM 使用量已达到本地限制。";
          throw new AppError(
            ErrorCodes.LLM_BUDGET_EXCEEDED,
            message,
            429,
            detail
          );
        }

        throw new AppError(
          ErrorCodes.RAG_SERVICE_ERROR,
          `RAG 服务返回错误: ${response.status}`,
          502,
          errorDetail
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (err instanceof AppError && err.statusCode < 500) {
        throw err;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError || new AppError(ErrorCodes.RAG_SERVICE_ERROR, "RAG 服务调用失败。", 502);
}
