import { describe, expect, it } from "vitest";
import { ColesAdapter } from "./adapter.js";
import { parseColesSearchPayload } from "./parser.js";
import { normalizeColesProduct } from "./normalizer.js";

describe("ColesAdapter.parseProductUrl", () => {
  const adapter = new ColesAdapter();

  it("extracts id from slug-productId URLs", async () => {
    const parsed = await adapter.parseProductUrl(
      "https://www.coles.com.au/product/v-original-energy-drink-4x250ml-4-pack-8737163",
    );
    expect(parsed?.retailerProductId).toBe("8737163");
    expect(parsed?.retailer).toBe("coles");
  });

  it("returns null for non-Coles hosts", async () => {
    const parsed = await adapter.parseProductUrl(
      "https://www.woolworths.com.au/shop/productdetails/12345",
    );
    expect(parsed).toBeNull();
  });
});

describe("normalizeColesProduct", () => {
  it("maps half price promotions", () => {
    const details = normalizeColesProduct({
      id: 1,
      name: "Tim Tam",
      brand: "Arnott's",
      size: "200g",
      availability: true,
      pricing: { now: 2.5, was: 5, promotionType: "SPECIAL" },
    });
    expect(details.promotionType).toBe("half_price");
    expect(details.currentPrice).toBe(2.5);
    expect(details.regularPrice).toBe(5);
  });
});

describe("parseColesSearchPayload", () => {
  it("reads nested GraphQL-like results", () => {
    const items = parseColesSearchPayload({
      data: {
        search: {
          results: [{ id: 11, name: "A" }, { id: 12, name: "B" }],
        },
      },
    });
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe(11);
  });

  it("returns empty for unknown shapes", () => {
    expect(parseColesSearchPayload({ foo: 1 })).toEqual([]);
  });
});
