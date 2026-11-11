import { isHalfPrice } from "@easypws/core";

/**
 * Evidence labels for a provider quote.
 * A matching store id is not an input: Omkar copies it from the request.
 */
export type SchemaVerdict = "schema_valid" | "schema_invalid";
export type StoreParameterVerdict = "store_parameter_forwarded" | "store_parameter_unknown";
export type StorePriceVerdict =
  | "store_price_independently_verified"
  | "store_price_unverified";
export type RetrievalState = "known" | "unknown";
export type SourceTimestampState = "missing" | "invalid" | "present";
export type SourceAge = "current" | "old" | "unknown";
export type FreshnessVerdict = "fresh" | "stale" | "unknown";
export type CacheProvenance = "cached" | "not_cached" | "unknown";

/** A source timestamp inside this age is current, not automatically fresh. */
export const SOURCE_CURRENT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A source timestamp this far ahead of the assessment clock is not trusted. */
export const SOURCE_FUTURE_SKEW_MS = 5 * 60 * 1000;
export type PromotionConfidence = "promotion_confirmed" | "promotion_ambiguous";
export type PromotionKind =
  | "regular"
  | "half_price"
  | "ordinary_special"
  | "multibuy"
  | "special_without_former_price"
  | "unknown";
export type AvailabilityVerdict = "available" | "unavailable" | "unknown";
export type CatalogueEnumeration = "not_possible" | "not_proven";

export interface MultiBuyEvidence {
  minQuantity?: number | null;
  priceEach?: number | null;
  totalPrice?: number | null;
}

/** Sanitized quote fields. Do not put raw provider payloads here. */
export interface QuoteEvidenceInput {
  id?: string;
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
  multiBuy?: MultiBuyEvidence | null;
  isAvailable?: boolean | null;
  /** When this client received the HTTP response. Not a freshness proof. */
  retrievedAt?: string | null;
  /** Provider source timestamp. Absent on listing cards and bulk cards. */
  sourceTimestamp?: string | null;
  /** Clock used to judge source age. Tests pass this explicitly. */
  assessedAt?: string | null;
  /**
   * Set only from an explicit cache signal such as a cache header.
   * A missing or present source timestamp does not set this.
   */
  cacheProvenance?: CacheProvenance | null;
  /**
   * Set only when something other than the timestamp establishes freshness.
   * A current source timestamp does not set this.
   */
  freshnessConfirmed?: boolean;
  /**
   * Set only from provider source that shows the store argument is sent upstream.
   * Do not set this because the response store id matches the request.
   */
  upstreamStoreParameterSent?: boolean;
  /**
   * Set only when a store-selected source outside this provider agrees on the price.
   */
  independentStorePrice?: boolean;
}

export interface QuoteClassification {
  schema: SchemaVerdict;
  schemaProblems: string[];
  storeParameter: StoreParameterVerdict;
  storePrice: StorePriceVerdict;
  retrieval: RetrievalState;
  sourceTimestampState: SourceTimestampState;
  sourceAge: SourceAge;
  freshness: FreshnessVerdict;
  cacheProvenance: CacheProvenance;
  promotion: PromotionConfidence;
  promotionKind: PromotionKind;
  availability: AvailabilityVerdict;
}

export interface ListingPageEvidence {
  totalCount: number;
  perPage: number;
  reportedTotalPages: number;
  returnedProducts: number;
  sponsoredProducts: number;
  maxPages: number;
}

export interface ListingPageAssessment {
  organicProducts: number;
  organicMatchesPageSize: boolean;
  sponsoredAreExtra: boolean;
  calculatedPages: number;
  pageCapBinds: boolean;
  reportedPagesMatchContract: boolean;
  reachableOrganicProducts: number;
  unreachableProducts: number;
  completeCatalogueEnumeration: CatalogueEnumeration;
}

export interface StoreQuoteComparisonInput {
  priceA: number;
  priceB: number;
  wasPriceA: number | null;
  wasPriceB: number | null;
  quantityA: number | null;
  quantityB: number | null;
}

export interface StoreQuoteComparison {
  pricesEqual: boolean;
  formerPricesEqual: boolean;
  stockDiffers: boolean;
  storePrice: "store_price_unverified";
  equalPricesAreInconclusive: true;
}

export const OMKAR_LISTING_PAGE_SIZE = 48;
export const OMKAR_LISTING_MAX_PAGES = 104;

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseUtcTimestamp(value: string | null | undefined): number | null {
  if (!hasText(value)) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  const millisecond = fraction.length === 0 ? 0 : Number(fraction.padEnd(3, "0"));
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const epochMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const parsed = new Date(epochMs);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return epochMs;
}

function sourceTimestampState(value: string | null | undefined): SourceTimestampState {
  if (!hasText(value)) {
    return "missing";
  }
  return parseUtcTimestamp(value) === null ? "invalid" : "present";
}

function sourceAge(sourceMs: number | null, assessedMs: number | null): SourceAge {
  if (sourceMs === null || assessedMs === null) {
    return "unknown";
  }
  const ageMs = assessedMs - sourceMs;
  if (ageMs < -SOURCE_FUTURE_SKEW_MS) {
    return "unknown";
  }
  if (ageMs > SOURCE_CURRENT_WINDOW_MS) {
    return "old";
  }
  return "current";
}

function freshnessFor(age: SourceAge, confirmed: boolean): FreshnessVerdict {
  switch (age) {
    case "old":
      return "stale";
    case "current":
      return confirmed ? "fresh" : "unknown";
    case "unknown":
      return "unknown";
    default: {
      const unexpected: never = age;
      return unexpected;
    }
  }
}

function describesHalfPrice(description: string | null | undefined): boolean {
  return /1\/2\s*price|half[\s-]*price/i.test(description ?? "");
}

function multibuyIsComplete(input: QuoteEvidenceInput): boolean {
  const multiBuy = input.multiBuy;
  if (multiBuy == null) {
    return false;
  }
  const minQuantity = multiBuy.minQuantity;
  const totalPrice = multiBuy.totalPrice;
  const minimumOk = typeof minQuantity === "number" && Number.isInteger(minQuantity) && minQuantity >= 2;
  const rewardOk =
    (typeof totalPrice === "number" && Number.isFinite(totalPrice) && totalPrice > 0) ||
    hasText(input.offerDescription);
  return minimumOk && rewardOk;
}

export function classifyQuote(input: QuoteEvidenceInput): QuoteClassification {
  const schemaProblems: string[] = [];
  if (!hasText(input.id)) {
    schemaProblems.push("missing_id");
  }
  if (!hasText(input.name)) {
    schemaProblems.push("missing_name");
  }
  if (typeof input.price !== "number" || !Number.isFinite(input.price) || input.price < 0) {
    schemaProblems.push("bad_price");
  }
  if (input.currency !== "AUD") {
    schemaProblems.push("bad_currency");
  }
  if (
    input.wasPrice != null &&
    (typeof input.wasPrice !== "number" || !Number.isFinite(input.wasPrice) || input.wasPrice <= 0)
  ) {
    schemaProblems.push("bad_was_price");
  }
  if (typeof input.isAvailable !== "boolean") {
    schemaProblems.push("bad_availability");
  }
  if (typeof input.isOnSpecial !== "boolean") {
    schemaProblems.push("bad_special_flag");
  }
  if (input.multiBuy != null && !multibuyIsComplete(input)) {
    schemaProblems.push("bad_multibuy");
  }

  const schema: SchemaVerdict = schemaProblems.length === 0 ? "schema_valid" : "schema_invalid";
  const storeParameter: StoreParameterVerdict =
    input.upstreamStoreParameterSent === true ? "store_parameter_forwarded" : "store_parameter_unknown";
  const storePrice: StorePriceVerdict =
    input.independentStorePrice === true && schema === "schema_valid"
      ? "store_price_independently_verified"
      : "store_price_unverified";
  const retrieval: RetrievalState = parseUtcTimestamp(input.retrievedAt) === null ? "unknown" : "known";
  const timestampState = sourceTimestampState(input.sourceTimestamp);
  const age = sourceAge(parseUtcTimestamp(input.sourceTimestamp), parseUtcTimestamp(input.assessedAt));
  const freshness = freshnessFor(age, input.freshnessConfirmed === true);
  const cacheProvenance: CacheProvenance = input.cacheProvenance ?? "unknown";

  let availability: AvailabilityVerdict = "unknown";
  if (input.isAvailable === true) {
    availability = "available";
  } else if (input.isAvailable === false) {
    availability = "unavailable";
  }

  const promotionFields = classifyPromotion(input, schema);
  return {
    schema,
    schemaProblems,
    storeParameter,
    storePrice,
    retrieval,
    sourceTimestampState: timestampState,
    sourceAge: age,
    freshness,
    cacheProvenance,
    promotion: promotionFields.promotion,
    promotionKind: promotionFields.promotionKind,
    availability,
  };
}

function classifyPromotion(
  input: QuoteEvidenceInput,
  schema: SchemaVerdict,
): { promotion: PromotionConfidence; promotionKind: PromotionKind } {
  if (schema === "schema_invalid") {
    return { promotion: "promotion_ambiguous", promotionKind: "unknown" };
  }
  if (multibuyIsComplete(input)) {
    return { promotion: "promotion_confirmed", promotionKind: "multibuy" };
  }

  const price = input.price;
  const wasPrice = input.wasPrice ?? null;
  const ratioHalf =
    typeof wasPrice === "number" && typeof price === "number" && isHalfPrice(wasPrice, price);
  const saveHalf = input.savePercent === 50;
  const textHalf = describesHalfPrice(input.priceDescription);
  const halfConflict = textHalf && typeof wasPrice === "number" && typeof price === "number" && !ratioHalf;
  if ((ratioHalf || saveHalf || textHalf) && !halfConflict && (ratioHalf || saveHalf)) {
    return { promotion: "promotion_confirmed", promotionKind: "half_price" };
  }
  if (textHalf || saveHalf || ratioHalf) {
    return { promotion: "promotion_ambiguous", promotionKind: "half_price" };
  }

  if (
    input.isOnSpecial === true &&
    typeof wasPrice === "number" &&
    typeof price === "number" &&
    price < wasPrice
  ) {
    return { promotion: "promotion_confirmed", promotionKind: "ordinary_special" };
  }

  const regularType = input.promotionType == null || input.promotionType === "none";
  if (input.isOnSpecial === false && regularType && wasPrice == null) {
    return { promotion: "promotion_confirmed", promotionKind: "regular" };
  }

  if (input.isOnSpecial === true && wasPrice == null) {
    return { promotion: "promotion_ambiguous", promotionKind: "special_without_former_price" };
  }

  return { promotion: "promotion_ambiguous", promotionKind: "unknown" };
}

export function assessListingPage(input: ListingPageEvidence): ListingPageAssessment {
  if (input.perPage <= 0 || input.maxPages <= 0) {
    throw new Error("Listing page size must be positive");
  }
  const organicProducts = input.returnedProducts - input.sponsoredProducts;
  const calculatedPages = Math.ceil(input.totalCount / input.perPage);
  const pageCapBinds = calculatedPages > input.maxPages;
  const servedPages = Math.min(calculatedPages, input.maxPages);
  const reachableOrganicProducts = servedPages * input.perPage;
  const completeCatalogueEnumeration: CatalogueEnumeration = pageCapBinds ? "not_possible" : "not_proven";
  return {
    organicProducts,
    organicMatchesPageSize: organicProducts === input.perPage,
    sponsoredAreExtra: input.sponsoredProducts > 0 && organicProducts === input.perPage,
    calculatedPages,
    pageCapBinds,
    reportedPagesMatchContract: input.reportedTotalPages === servedPages,
    reachableOrganicProducts,
    unreachableProducts: Math.max(0, input.totalCount - reachableOrganicProducts),
    completeCatalogueEnumeration,
  };
}

export function compareStoreQuotes(input: StoreQuoteComparisonInput): StoreQuoteComparison {
  return {
    pricesEqual: input.priceA === input.priceB && input.wasPriceA === input.wasPriceB,
    formerPricesEqual: input.wasPriceA === input.wasPriceB,
    stockDiffers: input.quantityA !== input.quantityB,
    storePrice: "store_price_unverified",
    equalPricesAreInconclusive: true,
  };
}
