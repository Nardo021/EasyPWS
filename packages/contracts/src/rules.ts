export type WatchRuleType =
  | "TARGET_PRICE"
  | "ANY_PRICE_DROP"
  | "HALF_PRICE"
  | "DISCOUNT_PERCENTAGE"
  | "HISTORICAL_LOW"
  | "BACK_IN_STOCK"
  | "OUT_OF_STOCK"
  | "PROMOTION_STARTED"
  | "PROMOTION_ENDED";

export type RuleOperator =
  | "LESS_THAN"
  | "LESS_THAN_OR_EQUAL"
  | "GREATER_THAN"
  | "GREATER_THAN_OR_EQUAL"
  | "EQUAL"
  | "CHANGED";

export interface WatchRule {
  id: string;
  watchlistItemId: string;
  type: WatchRuleType;
  operator: RuleOperator;
  value?: number;
  cooldownHours: number;
  enabled: boolean;
  lastTriggeredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuleEvaluationContext {
  listingId: string;
  watchlistItemId: string;
  previousPrice?: number;
  currentPrice: number;
  regularPrice?: number;
  discountPercentage?: number;
  historicalLow?: number;
  previouslyInStock?: boolean;
  currentlyInStock: boolean;
  promotionType: string;
  previousPromotionType?: string;
}

export interface RuleMatch {
  ruleId: string;
  type: WatchRuleType;
  dedupeKey: string;
  message: string;
}
