import type { PromotionType } from "./listings.js";

export type PriceObservationSource =
  | "adapter_api"
  | "adapter_html"
  | "adapter_browser"
  | "manual"
  | "import";

/** Append-only price observation — never overwrite prior rows. */
export interface PriceObservation {
  id: string;
  listingId: string;
  price: number;
  regularPrice?: number;
  unitPrice?: number;
  promotionType: PromotionType;
  inStock: boolean;
  observedAt: string;
  source: PriceObservationSource;
  rawHash?: string;
}

export interface PromotionObservation {
  id: string;
  listingId: string;
  promotionType: PromotionType;
  label?: string;
  discountPercentage?: number;
  startedAt?: string;
  endedAt?: string;
  observedAt: string;
  source: PriceObservationSource;
}

export interface PriceChartPoint {
  observedAt: string;
  price: number;
  regularPrice?: number;
  promotionType: PromotionType;
}
