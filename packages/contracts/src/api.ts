import type { RetailerId } from "./retailers.js";
import type { WatchRuleType, RuleOperator } from "./rules.js";
import type { PriceChartPoint } from "./prices.js";
import type { WatchlistItemStatus } from "./watchlists.js";

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ImportProductByUrlRequest {
  url: string;
  watchlistId?: string;
  targetPrice?: number;
}

export interface SearchProductsRequest {
  query: string;
  retailer?: RetailerId;
  limit?: number;
}

export interface CreateWatchRuleRequest {
  watchlistItemId: string;
  type: WatchRuleType;
  operator: RuleOperator;
  value?: number;
  cooldownHours?: number;
  enabled?: boolean;
}

export interface SetTargetPriceRequest {
  watchlistItemId: string;
  targetPrice: number;
}

export interface UpdateWatchlistItemStatusRequest {
  status: Exclude<WatchlistItemStatus, "removed">;
}

export interface ListingSummaryResponse {
  listingId: string;
  productId: string;
  productName: string;
  retailer: RetailerId;
  productUrl: string;
  currentPrice?: number;
  regularPrice?: number;
  discountPercentage?: number;
  historicalLow?: number;
  inStock: boolean;
  promotionType: string;
  monitoringStatus: WatchlistItemStatus;
  lastCheckedAt?: string;
}

export interface PriceHistoryResponse {
  listingId: string;
  points: PriceChartPoint[];
}
