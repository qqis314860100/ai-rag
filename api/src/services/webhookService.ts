import { createHmac } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getSetting } from "../db/settings";
import { writeAuditLog } from "./auditService";

export type WebhookEventType =
  | "knowledge_card.published"
  | "document.conflict"
  | "chat.refusal.high_frequency";

interface WebhookEnvelope {
  event_id: string;
  event_type: WebhookEventType;
  occurred_at: string;
  payload: Record<string, unknown>;
}

function settingValue(key: string): string {
  return getSetting(key)?.value?.trim() ?? "";
}

function webhookEnabled(): boolean {
  const raw = settingValue("webhook.enabled") || process.env.WEBHOOK_ENABLED || "false";
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function webhookUrl(): string {
  return settingValue("webhook.url") || process.env.WEBHOOK_URL || "";
}

function webhookSecret(): string {
  return settingValue("webhook.secret") || process.env.WEBHOOK_SECRET || "";
}

function enabledEvents(): Set<string> {
  const raw = settingValue("webhook.events") || process.env.WEBHOOK_EVENTS || "";
  if (!raw.trim()) return new Set(["knowledge_card.published", "document.conflict", "chat.refusal.high_frequency"]);
  return new Set(raw.split(",").map((item) => item.trim()).filter(Boolean));
}

function sign(timestamp: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

async function postWebhook(url: string, secret: string, envelope: WebhookEnvelope): Promise<void> {
  const body = JSON.stringify(envelope);
  const timestamp = String(Date.now());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rag-event": envelope.event_type,
        "x-rag-event-id": envelope.event_id,
        "x-rag-timestamp": timestamp,
        ...(secret ? { "x-rag-signature": `sha256=${sign(timestamp, body, secret)}` } : {}),
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function emitWebhookEvent(eventType: WebhookEventType, payload: Record<string, unknown>): void {
  const url = webhookUrl();
  if (!webhookEnabled() || !url || !enabledEvents().has(eventType)) {
    return;
  }

  const envelope: WebhookEnvelope = {
    event_id: uuidv4(),
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    payload,
  };

  void postWebhook(url, webhookSecret(), envelope)
    .then(() => {
      writeAuditLog({
        action: "webhook.dispatch",
        resourceType: "webhook",
        resourceId: eventType,
        detail: { event_id: envelope.event_id, status: "sent" },
      });
    })
    .catch((error) => {
      writeAuditLog({
        action: "webhook.dispatch_failed",
        resourceType: "webhook",
        resourceId: eventType,
        detail: {
          event_id: envelope.event_id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
}

