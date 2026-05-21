import { WifiOff, AlertTriangle } from "lucide-react";
import { useServiceHealth } from "../../hooks/useServiceHealth";

export default function ServiceBanner() {
  const { status, checking, refresh } = useServiceHealth();

  if (checking && status.lastCheck === null) return null; // initial load, don't flash
  if (status.api && status.rag) return null; // all good

  const bothDown = !status.api && !status.rag;
  const message = bothDown
    ? "服务连接失败 — 请检查网络或联系管理员"
    : !status.api
      ? "API 网关不可用"
      : "RAG 检索服务不可用";

  return (
    <div className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium ${bothDown ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>
      {bothDown ? <WifiOff className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      <span>{message}</span>
      <button
        onClick={refresh}
        className="ml-2 underline hover:no-underline"
      >
        {checking ? "检查中..." : "重试"}
      </button>
    </div>
  );
}
