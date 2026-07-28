import type {
  NotificationChannelType,
  NotificationEventPayload,
} from "@easypws/contracts";
import type { NotificationTransport } from "../dispatcher.js";

/** Posts notification payloads to a Home Assistant webhook URL. */
export class HomeAssistantWebhookTransport implements NotificationTransport {
  readonly type: NotificationChannelType = "ha_webhook";

  async send(
    payload: NotificationEventPayload,
    config: Record<string, unknown>,
  ): Promise<void> {
    const url = config["url"];
    if (typeof url !== "string" || !url) {
      throw new Error("HA webhook transport requires config.url");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`HA webhook failed: ${response.status}`);
    }
  }
}
