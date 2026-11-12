import { describe, expect, it } from "vitest";
import {
  COLES_MARRICKVILLE_STORE_ID,
  mapOmkarProduct,
  omkarProductRows,
  parseColesProductId,
} from "./omkar-map.js";

const retrievedAt = "2026-11-12T01:00:00.000Z";

const halfPrice = {
  id: 8737163,
  name: "V Energy Drink Original 4x250ml",
  brand: "V",
  size: "1L",
  link: "https://www.coles.com.au/product/v-energy-drink-original-4x250ml-8737163",
  is_available: true,
  store_id: "4166",
  last_updated: "2026-11-12T00:30:00.000Z",
  pricing: {
    currency: "AUD",
    price: 6,
    was_price: 12,
    save_percent: 50,
    is_on_special: true,
    promotion_type: "special",
    special_type: "percent_off",
    price_description: "1/2 Price",
  },
};

describe("omkar map", () => {
  it("keeps an API-reported special review-only", () => {
    const mapped = mapOmkarProduct(halfPrice, "8737163", retrievedAt);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }
    expect(mapped.product.notificationEligible).toBe(false);
    expect(mapped.product.quoteUse).toBe("review_only");
    expect(mapped.product.storePrice).toBe("store_price_unverified");
    expect(mapped.product.promotionKind).toBe("half_price");
    expect(mapped.product.currentPrice).toBe(6);
    expect(mapped.product.echoedStoreId).toBe(COLES_MARRICKVILLE_STORE_ID);
  });

  it("rejects a Victorian store echo and reads search rows", () => {
    const rejected = mapOmkarProduct({ ...halfPrice, store_id: "584" }, "8737163", retrievedAt);
    expect(rejected).toEqual({ ok: false, reason: "store_mismatch" });
    const rows = omkarProductRows({
      products: [halfPrice, { ...halfPrice, id: 1, store_id: "584" }],
    });
    expect(rows).toHaveLength(2);
  });

  it("reads a Coles product URL without using a store query", () => {
    expect(
      parseColesProductId(
        "https://www.coles.com.au/product/v-energy-drink-original-4x250ml-8737163?store=584",
      ),
    ).toBe("8737163");
    expect(parseColesProductId("https://coles.com.au/product/8737163")).toBe("8737163");
    expect(parseColesProductId("https://example.com/product/8737163")).toBeNull();
  });
});
