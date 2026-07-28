import type {
  AdapterProductDetails,
  AdapterSearchResult,
  PromotionType,
} from "@easypws/contracts";
import { isHalfPrice } from "@easypws/core";
import type { ColesProductRaw } from "./parser.js";

const IMAGE_BASE = "https://www.coles.com.au";

function mapPromotionType(
  pricing: ColesProductRaw["pricing"],
  currentPrice: number | undefined,
  regularPrice: number | undefined,
): PromotionType {
  if (isHalfPrice(regularPrice, currentPrice ?? Number.POSITIVE_INFINITY)) {
    return "half_price";
  }
  const special = (pricing?.specialType ?? "").toUpperCase();
  const promo = (pricing?.promotionType ?? "").toUpperCase();
  if (special.includes("MULTI") || promo.includes("MULTI")) {
    return "multibuy";
  }
  if (promo === "SPECIAL" || promo === "DOWNDOWN" || special) {
    if (regularPrice && currentPrice && currentPrice < regularPrice) {
      return "percentage_off";
    }
    return "other";
  }
  if (regularPrice && currentPrice && currentPrice < regularPrice) {
    return "percentage_off";
  }
  return "none";
}

function resolveImage(raw: ColesProductRaw): string | undefined {
  const uri = raw.imageUris?.find((i) => i.uri)?.uri ?? raw.images?.[0]?.full?.path;
  if (!uri) {
    return undefined;
  }
  if (uri.startsWith("http")) {
    return uri;
  }
  return `${IMAGE_BASE}${uri.startsWith("/") ? "" : "/"}${uri}`;
}

function productUrl(id: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://www.coles.com.au/product/${slug}-${id}`;
}

export function normalizeColesProduct(
  raw: ColesProductRaw,
  storeId?: string,
): AdapterProductDetails {
  const id = String(raw.id ?? "");
  if (!id) {
    throw new Error("Coles product missing id");
  }
  const name = raw.name ?? "Unknown product";
  const now = raw.pricing?.now ?? raw.pricing?.rawPriceNow;
  const was = raw.pricing?.was && raw.pricing.was > 0 ? raw.pricing.was : undefined;
  const currentPrice = typeof now === "number" ? now : undefined;
  const regularPrice = was ?? currentPrice;
  const unitPrice = raw.pricing?.unit?.price;
  const unit =
    raw.pricing?.unit?.ofMeasureType ??
    raw.pricing?.unit?.ofMeasureUnits ??
    raw.pricing?.comparable;

  return {
    retailerProductId: id,
    productUrl: productUrl(id, name),
    name,
    brand: raw.brand,
    size: raw.size,
    category: raw.merchandiseHeir?.name ?? raw.onlineHeirs?.[0]?.name,
    imageUrl: resolveImage(raw),
    currentPrice,
    regularPrice,
    unitPrice,
    unit,
    inStock: raw.availability !== false,
    promotionType: mapPromotionType(raw.pricing, currentPrice, regularPrice),
    storeId,
  };
}

export function normalizeColesSearchResult(raw: ColesProductRaw): AdapterSearchResult {
  const details = normalizeColesProduct(raw);
  return {
    retailerProductId: details.retailerProductId,
    name: details.name,
    brand: details.brand,
    size: details.size,
    productUrl: details.productUrl,
    imageUrl: details.imageUrl,
    currentPrice: details.currentPrice,
    regularPrice: details.regularPrice,
  };
}
