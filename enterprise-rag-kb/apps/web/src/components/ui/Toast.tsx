import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, X } from "lucide-react";

export interface ToastData {
  id: string;
  type: "success" | "error" | "warning";
  message: string;
}

let toastListeners: Array<(t: ToastData) => void> = [];
let toastId = 0;

export function showToast(type: ToastData["type"], message: string) {
  const id = String(++toastId);
  toastListeners.forEach((fn) => fn({ id, type, message }));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  useEffect(() => {
    const listener = (t: ToastData) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((p) => p.id !== t.id)), 3500);
    };
    toastListeners.push(listener);
    return () => { toastListeners = toastListeners.filter((l) => l !== listener); };
  }, []);

  const icons = { success: CheckCircle, error: XCircle, warning: AlertTriangle };
  const colors = {
    success: "border-success bg-success-soft text-success",
    error: "border-danger bg-danger-soft text-danger",
    warning: "border-warning bg-warning-soft text-warning",
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const Icon = icons[t.type];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto animate-slide-down flex items-center gap-2.5 rounded-xl border px-4 py-3 shadow-lg-soft text-sm font-medium ${colors[t.type]}`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((p) => p.id !== t.id))}
              className="ml-2 rounded-md p-0.5 hover:bg-black/10 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
