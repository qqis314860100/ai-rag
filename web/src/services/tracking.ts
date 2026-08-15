import { api } from "./api";

function telemetryEnabled() {
  return String(import.meta.env.VITE_TELEMETRY_ENABLED ?? "").toLowerCase() === "true";
}

export function track(event_type: string, resource_type?: string, resource_id?: string, metadata?: Record<string, unknown>) {
  if (!telemetryEnabled()) return;
  api.post("/stats/browse", { event_type, resource_type, resource_id, metadata }).catch(() => {});
}
