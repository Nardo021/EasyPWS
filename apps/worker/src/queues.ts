export const QUEUE_NAMES = {
  priceCheck: "price_check",
  productRefresh: "product_refresh",
  notificationDelivery: "notification_delivery",
  imageProcess: "image_process",
  manualRefresh: "manual_refresh",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
