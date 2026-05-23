import { useState, useEffect, useCallback } from "react";

interface ServiceStatus {
  api: boolean;
  rag: boolean;
  lastCheck: number | null;
}

export function useServiceHealth() {
  const [status, setStatus] = useState<ServiceStatus>({ api: true, rag: true, lastCheck: null });
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const results = { api: false, rag: false };

    try {
      const apiRes = await fetch("/api/admin/health");
      if (apiRes.ok) {
        const data = await apiRes.json();
        results.api = data?.data?.status === "ok";
        results.rag = data?.data?.services?.rag === "ok";
      }
    } catch {
      results.api = false;
      results.rag = false;
    }

    setStatus({ ...results, lastCheck: Date.now() });
    setChecking(false);
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [check]);

  return { status, checking, refresh: check };
}
