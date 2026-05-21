import { api } from "./api";

export function track(event_type: string, resource_type?: string, resource_id?: string, metadata?: Record<string, unknown>) {
  api.post("/stats/browse", { event_type, resource_type, resource_id, metadata }).catch(() => {});
}
