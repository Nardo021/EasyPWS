import type {
  NotificationChannelType,
  NotificationEventPayload,
} from "@easypws/contracts";
import type { NotificationTransport } from "../dispatcher.js";

export class GenericWebhookTransport implements NotificationTransport {
  readonly type: NotificationChannelType = "generic_webhook";

  async send(
    payload: NotificationEventPayload,
    config: Record<string, unknown>,
  ): Promise<void> {
    const url = config["url"];
    if (typeof url !== "string" || !url) {
      throw new Error("Generic webhook transport requires config.url");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(typeof config["secret"] === "string"
          ? { "X-EasyPWS-Signature": String(config["secret"]) }
          : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Generic webhook failed: ${response.status}`);
    }
  }
}
