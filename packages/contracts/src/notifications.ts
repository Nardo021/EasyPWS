export type NotificationChannelType =
  | "ha_webhook"
  | "ha_persistent"
  | "mobile_push"
  | "email"
  | "discord"
  | "generic_webhook";

export type NotificationEventKind =
  | "price_drop"
  | "target_price_reached"
  | "half_price"
  | "discount_percentage"
  | "historical_low"
  | "back_in_stock"
  | "out_of_stock"
  | "promotion_started"
  | "promotion_ended";

export interface NotificationChannel {
  id: string;
  userId: string;
  type: NotificationChannelType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

export interface NotificationEventPayload {
  event: NotificationEventKind;
  product: string;
  retailer: string;
  oldPrice?: number;
  newPrice: number;
  discountPercentage?: number;
  historicalLow?: number;
  productUrl: string;
  listingId: string;
  observedAt: string;
}

export type NotificationDeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "suppressed";

export interface NotificationEvent {
  id: string;
  userId: string;
  channelId?: string;
  watchRuleId?: string;
  listingId: string;
  kind: NotificationEventKind;
  payload: NotificationEventPayload;
  dedupeKey: string;
  status: NotificationDeliveryStatus;
  createdAt: string;
  deliveredAt?: string;
  error?: string;
}
