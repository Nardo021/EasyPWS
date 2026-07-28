export type CollectionJobType =
  | "price_check"
  | "product_refresh"
  | "image_process"
  | "notification_delivery"
  | "manual_refresh";

export type CollectionJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "dead_letter";

export type ListingCheckTier =
  | "on_promotion"
  | "normal"
  | "stale"
  | "adapter_backoff"
  | "manual";

/** Suggested check intervals from architecture §8 (hours). */
export const CHECK_INTERVAL_HOURS: Record<ListingCheckTier, { min: number; max: number }> = {
  on_promotion: { min: 2, max: 4 },
  normal: { min: 6, max: 12 },
  stale: { min: 24, max: 24 },
  adapter_backoff: { min: 1, max: 24 },
  manual: { min: 0, max: 0 },
};

export interface CollectionJob {
  id: string;
  type: CollectionJobType;
  listingId?: string;
  status: CollectionJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
