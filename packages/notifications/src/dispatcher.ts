import type {
  NotificationChannelType,
  NotificationEventPayload,
} from "@easypws/contracts";
import { assertNever } from "@easypws/core";

export interface NotificationTransport {
  readonly type: NotificationChannelType;
  send(payload: NotificationEventPayload, config: Record<string, unknown>): Promise<void>;
}

export interface NotificationDispatcher {
  register(transport: NotificationTransport): void;
  dispatch(
    channelType: NotificationChannelType,
    payload: NotificationEventPayload,
    config: Record<string, unknown>,
  ): Promise<void>;
}

export function createNotificationDispatcher(
  transports: NotificationTransport[] = [],
): NotificationDispatcher {
  const map = new Map<NotificationChannelType, NotificationTransport>();
  for (const t of transports) {
    map.set(t.type, t);
  }

  return {
    register(transport) {
      map.set(transport.type, transport);
    },
    async dispatch(channelType, payload, config) {
      const transport = map.get(channelType);
      if (!transport) {
        switch (channelType) {
          case "ha_webhook":
          case "ha_persistent":
          case "mobile_push":
          case "email":
          case "discord":
          case "generic_webhook":
            throw new Error(`No transport registered for ${channelType}`);
          default:
            return assertNever(channelType);
        }
      }
      await transport.send(payload, config);
    },
  };
}
