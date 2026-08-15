const API_BASE = "/api";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("kb_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function redirectToLogin() {
  localStorage.removeItem("kb_token");
  localStorage.removeItem("kb_user");
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error("登录已过期，请重新登录");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? "Request failed");
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: "POST", body: formData, headers: {} }),
};

/** Upload with progress callback. Returns parsed JSON response. */
export function uploadWithProgress(
  path: string,
  formData: FormData,
  onProgress: (pct: number) => void
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}`);
    const token = localStorage.getItem("kb_token");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data?.error?.message || `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error("Invalid response"));
      }
    };

    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.send(formData);
  });
}

/** SSE stream helper */
export async function sseStream(path: string, body: unknown, signal?: AbortSignal): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error("登录已过期，请重新登录");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? "Request failed");
  }
  return res.body!.getReader();
}

export type {};
