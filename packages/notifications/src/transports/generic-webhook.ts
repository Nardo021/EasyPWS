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
    void payload;
    void url;
    throw new Error("GenericWebhookTransport.send not implemented");
  }
}
