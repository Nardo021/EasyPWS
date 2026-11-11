import type { RetailerId } from "./retailers.js";

/** Retailer catalogue family. Two hosts in one family are not independent evidence. */
export type UpstreamFamily = "coles" | "woolworths" | "aldi" | "chemist_warehouse" | "other";

export type ProviderCapability =
  | "product_details"
  | "search"
  | "specials"
  | "bulk_prices"
  | "store_lookup";

export interface ProviderIdentity {
  retailerId: RetailerId;
  providerId: string;
  upstreamFamily: UpstreamFamily;
}

/** Each capability is separate. A provider may implement only some of them. */
export interface ProviderCapabilities {
  productDetails: boolean;
  search: boolean;
  specials: boolean;
  bulkPrices: boolean;
  storeLookup: boolean;
}

export type ProviderErrorClass =
  | "authorization"
  | "not_found"
  | "invalid_quote"
  | "timeout"
  | "rate_limited"
  | "budget_exhausted"
  | "unsupported_capability"
  | "unavailable"
  | "circuit_open";

/** Fixed diagnostic codes. Do not put response bodies or credentials here. */
export type DiagnosticReason =
  | "retailer_mismatch"
  | "unsupported_capability"
  | "authorization_blocked"
  | "authorization_rejected"
  | "circuit_open"
  | "budget_exhausted"
  | "deadline_exceeded"
  | "provider_threw"
  | "not_found"
  | "store_missing"
  | "rate_limited"
  | "upstream_unavailable"
  | "unexpected_status"
  | "wrong_product"
  | "store_mismatch"
  | "schema_invalid"
  | "selected";

/**
 * Phase 1A does not retry a failed call. Fallback to another provider is a
 * different attempt, still once, and still not a quota retry of the same call.
 */
export interface ProviderError {
  errorClass: ProviderErrorClass;
  reason: DiagnosticReason;
  retryable: false;
  schemaProblems?: readonly string[];
}

export interface RawMultiBuy {
  minQuantity?: number | null;
  priceEach?: number | null;
  totalPrice?: number | null;
}

/** Sanitized provider fields. This is not a stored HTTP body. */
export interface RawProviderProduct {
  retailerProductId: string;
  /** Copied store id, if the provider sent one. Equality with the request is not verification. */
  echoedStoreId: string | null;
  name?: string;
  currency?: string | null;
  price?: number | null;
  wasPrice?: number | null;
  isOnSpecial?: boolean | null;
  promotionType?: string | null;
  specialType?: string | null;
  priceDescription?: string | null;
  offerDescription?: string | null;
  savePercent?: number | null;
  multiBuy?: RawMultiBuy | null;
  isAvailable?: boolean | null;
  sourceTimestamp?: string | null;
  cacheProvenance?: "cached" | "not_cached" | "unknown" | null;
  freshnessConfirmed?: boolean;
  upstreamStoreParameterSent?: boolean;
  independentStorePrice?: boolean;
  httpStatus: number;
}

export interface ProviderAbortSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface ProviderCallContext {
  nowMs: number;
  signal: ProviderAbortSignal;
}

export interface ProductDetailsRequest {
  retailerProductId: string;
  externalStoreId: string;
}

export interface SearchRequest {
  query: string;
  externalStoreId: string;
}

export interface SpecialsRequest {
  externalStoreId: string;
  page: number;
}

export interface BulkPricesRequest {
  retailerProductIds: readonly string[];
  externalStoreId: string;
}

export interface StoreLookupRequest {
  query: string;
}

export interface StoreRecord {
  externalStoreId: string;
  name: string;
}

export type ProviderOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProviderError };

/**
 * Data provider boundary. Retailer identity stays on `identity.retailerId`
 * and is not reused as the provider id.
 */
export interface DataProvider {
  readonly identity: ProviderIdentity;
  readonly capabilities: ProviderCapabilities;
  getProductDetails(
    request: ProductDetailsRequest,
    context: ProviderCallContext,
  ): Promise<ProviderOutcome<RawProviderProduct>>;
  search(
    request: SearchRequest,
    context: ProviderCallContext,
  ): Promise<ProviderOutcome<readonly RawProviderProduct[]>>;
  specials(
    request: SpecialsRequest,
    context: ProviderCallContext,
  ): Promise<ProviderOutcome<readonly RawProviderProduct[]>>;
  bulkPrices(
    request: BulkPricesRequest,
    context: ProviderCallContext,
  ): Promise<ProviderOutcome<readonly RawProviderProduct[]>>;
  lookupStore(
    request: StoreLookupRequest,
    context: ProviderCallContext,
  ): Promise<ProviderOutcome<StoreRecord>>;
}
