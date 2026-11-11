import type {
  ProviderError,
  RawProviderProduct,
  RetailerId,
  UpstreamFamily,
} from "@easypws/contracts";
import { classifyHttpStatus } from "./http.js";
import {
  classifyQuote,
  type AvailabilityVerdict,
  type CacheProvenance,
  type FreshnessVerdict,
  type PromotionConfidence,
  type PromotionKind,
  type SchemaVerdict,
  type SourceAge,
  type StoreParameterVerdict,
  type StorePriceVerdict,
} from "../evidence/contract.js";

export interface QuoteNormalizationInput {
  retailerId: RetailerId;
  providerId: string;
  upstreamFamily: UpstreamFamily;
  requestedStoreId: string;
  requestedProductId: string;
  retrievedAt: string;
  assessedAt: string;
  product: RawProviderProduct;
}

interface NormalizedQuoteFields {
  retailerId: RetailerId;
  providerId: string;
  upstreamFamily: UpstreamFamily;
  requestedStoreId: string;
  echoedStoreId: string | null;
  retailerProductId: string;
  name: string;
  priceAud: number;
  regularPriceAud: number | null;
  multiBuyMinQuantity: number | null;
  multiBuyTotalAud: number | null;
  /** Reserved so a multibuy total cannot be divided into a single-item price. */
  singleItemPriceFromOffer: null;
  offerText: string | null;
  retrievedAt: string;
  sourceTimestamp: string | null;
  sourceAge: SourceAge;
  freshness: FreshnessVerdict;
  cacheProvenance: CacheProvenance;
  storeParameter: StoreParameterVerdict;
  storePrice: StorePriceVerdict;
  promotion: PromotionConfidence;
  promotionKind: PromotionKind;
  availability: AvailabilityVerdict;
  schema: SchemaVerdict;
  httpStatus: number;
}

export type NormalizedProviderQuote =
  | (NormalizedQuoteFields & {
      use: "review_only";
      confirmedLiveSpecial: false;
      notificationEligible: false;
    })
  | (NormalizedQuoteFields & {
      use: "notification_eligible";
      confirmedLiveSpecial: true;
      notificationEligible: true;
    });

export type NormalizationResult =
  | { ok: true; quote: NormalizedProviderQuote }
  | { ok: false; error: ProviderError };

function invalid(reason: ProviderError["reason"], schemaProblems?: readonly string[]): ProviderError {
  return {
    errorClass: "invalid_quote",
    reason,
    retryable: false,
    ...(schemaProblems ? { schemaProblems } : {}),
  };
}

function isConfirmedSpecial(kind: PromotionKind): boolean {
  switch (kind) {
    case "half_price":
    case "ordinary_special":
    case "multibuy":
      return true;
    case "regular":
    case "special_without_former_price":
    case "unknown":
      return false;
    default: {
      const unexpected: never = kind;
      return unexpected;
    }
  }
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Turn sanitized provider fields into a quote.
 * An echoed store id is ignored for verification. A multibuy total is not
 * converted into a single-item price.
 */
export function normalizeProductQuote(input: QuoteNormalizationInput): NormalizationResult {
  const product = input.product;
  if (product.httpStatus !== 200) {
    return { ok: false, error: classifyHttpStatus(product.httpStatus) };
  }
  if (product.retailerProductId !== input.requestedProductId) {
    return { ok: false, error: invalid("wrong_product") };
  }
  if (product.echoedStoreId !== null && product.echoedStoreId !== input.requestedStoreId) {
    return { ok: false, error: invalid("store_mismatch") };
  }

  const classification = classifyQuote({
    id: product.retailerProductId,
    name: product.name,
    currency: product.currency,
    price: product.price,
    wasPrice: product.wasPrice,
    isOnSpecial: product.isOnSpecial,
    promotionType: product.promotionType,
    specialType: product.specialType,
    priceDescription: product.priceDescription,
    offerDescription: product.offerDescription,
    savePercent: product.savePercent,
    multiBuy: product.multiBuy,
    isAvailable: product.isAvailable,
    retrievedAt: input.retrievedAt,
    sourceTimestamp: product.sourceTimestamp,
    assessedAt: input.assessedAt,
    cacheProvenance: product.cacheProvenance,
    freshnessConfirmed: product.freshnessConfirmed === true,
    upstreamStoreParameterSent: product.upstreamStoreParameterSent === true,
    independentStorePrice: product.independentStorePrice === true,
  });

  if (classification.schema !== "schema_valid" || typeof product.price !== "number" || !product.name) {
    return {
      ok: false,
      error: invalid("schema_invalid", classification.schemaProblems),
    };
  }

  const eligible =
    classification.storePrice === "store_price_independently_verified" &&
    classification.freshness === "fresh" &&
    classification.promotion === "promotion_confirmed" &&
    classification.availability === "available" &&
    isConfirmedSpecial(classification.promotionKind);

  const fields: NormalizedQuoteFields = {
    retailerId: input.retailerId,
    providerId: input.providerId,
    upstreamFamily: input.upstreamFamily,
    requestedStoreId: input.requestedStoreId,
    echoedStoreId: product.echoedStoreId,
    retailerProductId: product.retailerProductId,
    name: product.name,
    priceAud: product.price,
    regularPriceAud: finiteOrNull(product.wasPrice),
    multiBuyMinQuantity: finiteOrNull(product.multiBuy?.minQuantity),
    multiBuyTotalAud: finiteOrNull(product.multiBuy?.totalPrice),
    singleItemPriceFromOffer: null,
    offerText: product.offerDescription ?? null,
    retrievedAt: input.retrievedAt,
    sourceTimestamp: product.sourceTimestamp ?? null,
    sourceAge: classification.sourceAge,
    freshness: classification.freshness,
    cacheProvenance: classification.cacheProvenance,
    storeParameter: classification.storeParameter,
    storePrice: classification.storePrice,
    promotion: classification.promotion,
    promotionKind: classification.promotionKind,
    availability: classification.availability,
    schema: classification.schema,
    httpStatus: product.httpStatus,
  };

  if (eligible) {
    return {
      ok: true,
      quote: {
        ...fields,
        use: "notification_eligible",
        confirmedLiveSpecial: true,
        notificationEligible: true,
      },
    };
  }
  return {
    ok: true,
    quote: {
      ...fields,
      use: "review_only",
      confirmedLiveSpecial: false,
      notificationEligible: false,
    },
  };
}
