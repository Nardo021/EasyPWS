import { normalizeProductQuote } from "./normalize.js";

/** Coles Marrickville, NSW. The lite client never substitutes another store. */
export const COLES_MARRICKVILLE_STORE_ID = "4166";

export interface MappedOmkarProduct {
  retailerProductId: string;
  name: string;
  brand: string | null;
  size: string | null;
  productUrl: string;
  imageUrl: string | null;
  currentPrice: number | null;
  regularPrice: number | null;
  promotionType: string;
  promotionKind: string;
  inStock: boolean;
  availabilityKnown: boolean;
  sourceTimestamp: string | null;
  echoedStoreId: string | null;
  notificationEligible: false;
  quoteUse: "review_only" | "unpriced";
  storePrice: "store_price_unverified" | "not_a_quote";
}

export type MapOmkarResult =
  | { ok: true; product: MappedOmkarProduct }
  | { ok: false; reason: "not_a_product" | "wrong_product" | "store_mismatch" | "schema_invalid" };

export function parseColesProductId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "www.coles.com.au" && host !== "coles.com.au") {
    return null;
  }
  const match = url.pathname.match(/\/product\/(?:.*-)?(\d+)\/?$/);
  return match?.[1] ?? null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function productId(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return value;
  }
  return null;
}

export function omkarProductRows(payload: unknown): unknown[] {
  const root = recordOf(payload);
  if (!root) {
    return [];
  }
  const rows = root["products"] ?? root["results"];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Map one hosted Omkar product object.
 * Provider claims are not trusted. The quote stays review-only.
 */
export function mapOmkarProduct(
  payload: unknown,
  requestedProductId: string,
  retrievedAt: string,
): MapOmkarResult {
  const raw = recordOf(payload);
  const id = productId(raw?.["id"]);
  if (!raw || !id) {
    return { ok: false, reason: "not_a_product" };
  }
  if (id !== requestedProductId) {
    return { ok: false, reason: "wrong_product" };
  }

  const echoed = text(raw["store_id"]) ?? (raw["store_id"] != null ? String(raw["store_id"]) : null);
  if (echoed !== null && echoed !== COLES_MARRICKVILLE_STORE_ID) {
    return { ok: false, reason: "store_mismatch" };
  }

  const pricing = recordOf(raw["pricing"]) ?? raw;
  const name = text(raw["name"]);
  const price = finite(pricing["price"]);
  const wasPrice = finite(pricing["was_price"]);
  const availabilityKnown = typeof raw["is_available"] === "boolean";
  const isAvailable = raw["is_available"] === true;
  const promotionType = text(pricing["promotion_type"]);
  const explicitSpecial = pricing["is_on_special"];
  const isOnSpecial =
    typeof explicitSpecial === "boolean" ? explicitSpecial : Boolean(promotionType || wasPrice);
  const currency = text(pricing["currency"]) ?? "AUD";
  const multi = recordOf(pricing["multi_buy"]);
  const multiBuy = multi
    ? {
        minQuantity: finite(multi["min_quantity"]),
        priceEach: finite(multi["price_each"]),
        totalPrice: finite(multi["total_price"]),
      }
    : null;
  const completeMultiBuy =
    multiBuy !== null &&
    typeof multiBuy.minQuantity === "number" &&
    multiBuy.minQuantity >= 2 &&
    (typeof multiBuy.totalPrice === "number" || text(pricing["offer_description"]) !== null);

  const base = {
    retailerProductId: id,
    name: name ?? "未命名商品",
    brand: text(raw["brand"]),
    size: text(raw["size"]),
    productUrl:
      text(raw["link"]) ?? `https://www.coles.com.au/product/${id}`,
    imageUrl: text(raw["image"]),
    sourceTimestamp: text(raw["last_updated"]),
    echoedStoreId: echoed,
    notificationEligible: false as const,
    inStock: isAvailable,
    availabilityKnown,
  };

  if (price === null || !name) {
    return {
      ok: true,
      product: {
        ...base,
        currentPrice: price,
        regularPrice: wasPrice,
        promotionType: promotionType ?? "unknown",
        promotionKind: "unknown",
        quoteUse: "unpriced",
        storePrice: "not_a_quote",
      },
    };
  }

  const normalized = normalizeProductQuote({
    retailerId: "coles",
    providerId: "omkar-hosted",
    upstreamFamily: "coles",
    requestedStoreId: COLES_MARRICKVILLE_STORE_ID,
    requestedProductId,
    retrievedAt,
    assessedAt: retrievedAt,
    product: {
      retailerProductId: id,
      echoedStoreId: echoed,
      name,
      currency,
      price,
      wasPrice,
      isOnSpecial,
      promotionType,
      specialType: text(pricing["special_type"]),
      priceDescription: text(pricing["price_description"]),
      offerDescription: text(pricing["offer_description"]),
      savePercent: finite(pricing["save_percent"]),
      multiBuy: completeMultiBuy ? multiBuy : null,
      isAvailable,
      sourceTimestamp: text(raw["last_updated"]),
      httpStatus: 200,
    },
  });

  if (!normalized.ok) {
    return {
      ok: false,
      reason: normalized.error.reason === "store_mismatch" ? "store_mismatch" : "schema_invalid",
    };
  }
  if (normalized.quote.notificationEligible) {
    return { ok: false, reason: "schema_invalid" };
  }

  return {
    ok: true,
    product: {
      ...base,
      name,
      currentPrice: normalized.quote.priceAud,
      regularPrice: normalized.quote.regularPriceAud,
      promotionType: normalized.quote.promotionKind,
      promotionKind: normalized.quote.promotionKind,
      inStock: normalized.quote.availability === "available",
      quoteUse: "review_only",
      storePrice: "store_price_unverified",
    },
  };
}
