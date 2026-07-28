import type { RetailerId } from "./retailers.js";

export type PromotionType =
  | "none"
  | "half_price"
  | "percentage_off"
  | "multibuy"
  | "member_price"
  | "clearance"
  | "other";

/** A retailer-specific product page / SKU bound to a canonical product. */
export interface RetailerListing {
  id: string;
  productId: string;
  retailer: RetailerId;
  retailerProductId: string;
  productUrl: string;
  storeId?: string;
  currentPrice?: number;
  regularPrice?: number;
  unitPrice?: number;
  unit?: string;
  inStock: boolean;
  promotionType: PromotionType;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}
