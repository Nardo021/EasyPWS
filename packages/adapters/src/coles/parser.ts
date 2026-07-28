export interface ColesPricingRaw {
  now?: number;
  rawPriceNow?: number;
  was?: number;
  promotionType?: string;
  specialType?: string;
  offerDescription?: string;
  unit?: {
    price?: number;
    ofMeasureUnits?: string;
    ofMeasureType?: string;
  };
  comparable?: string;
}

export interface ColesProductRaw {
  id?: number | string;
  name?: string;
  brand?: string;
  size?: string;
  description?: string;
  availability?: boolean;
  pricing?: ColesPricingRaw;
  imageUris?: Array<{ uri?: string; type?: string }>;
  images?: Array<{ full?: { path?: string } }>;
  merchandiseHeir?: { name?: string };
  onlineHeirs?: Array<{ name?: string }>;
}

export function parseColesProductPayload(payload: unknown): ColesProductRaw {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Coles product payload");
  }
  return payload as ColesProductRaw;
}

export function parseColesSearchPayload(payload: unknown): ColesProductRaw[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const root = payload as Record<string, unknown>;
  const results =
    (root["results"] as unknown) ??
    (root["products"] as unknown) ??
    (root["Items"] as unknown) ??
    [];
  if (!Array.isArray(results)) {
    return [];
  }
  return results.filter((item) => item && typeof item === "object") as ColesProductRaw[];
}
