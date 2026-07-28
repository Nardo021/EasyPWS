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

function asProductArray(value: unknown): ColesProductRaw[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => item && typeof item === "object") as ColesProductRaw[];
}

/** Best-effort extraction across evolving Coles BFF / GraphQL search shapes. */
export function parseColesSearchPayload(payload: unknown): ColesProductRaw[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const root = payload as Record<string, unknown>;

  const direct = asProductArray(
    root["results"] ?? root["products"] ?? root["Items"] ?? root["items"],
  );
  if (direct.length > 0) {
    return direct;
  }

  const data = root["data"];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const search = d["search"] ?? d["searchProducts"] ?? d["productSearch"];
    if (search && typeof search === "object") {
      const s = search as Record<string, unknown>;
      const nested = asProductArray(
        s["results"] ?? s["products"] ?? s["items"] ?? s["productList"],
      );
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  const results = root["Results"];
  if (results && typeof results === "object") {
    const r = results as Record<string, unknown>;
    const nested = asProductArray(r["Products"] ?? r["products"]);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
}
