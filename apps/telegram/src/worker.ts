import { WorkerEntrypoint } from "cloudflare:workers";
import { deliverOwnerAlert, type DeliveryResult } from "./alerts.js";
import { handleTelegramWebhook, type TelegramEnv } from "./index.js";

/** Private RPC entrypoint. The public fetch handler stays on the default export. */
export class AlertDelivery extends WorkerEntrypoint<TelegramEnv> {
  async deliver(input: unknown): Promise<DeliveryResult> {
    return deliverOwnerAlert(this.env, input);
  }
}

export default {
  async fetch(request: Request, env: TelegramEnv): Promise<Response> {
    return handleTelegramWebhook(request, env);
  },
};
