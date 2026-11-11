import { describe, expect, it } from "vitest";
import {
  OMKAR_LISTING_MAX_PAGES,
  OMKAR_LISTING_PAGE_SIZE,
  assessListingPage,
  classifyQuote,
  compareStoreQuotes,
  type QuoteEvidenceInput,
} from "./contract.js";

function quote(overrides: QuoteEvidenceInput): QuoteEvidenceInput {
  return {
    id: "sku-1",
    name: "Sample item",
    currency: "AUD",
    price: 4,
    wasPrice: null,
    isOnSpecial: false,
    promotionType: null,
    specialType: null,
    priceDescription: null,
    offerDescription: null,
    savePercent: null,
    multiBuy: null,
    isAvailable: true,
    sourceTimestamp: null,
    ...overrides,
  };
}

describe("classifyQuote", () => {
  it("confirms a half-price quote only from price evidence", () => {
    const result = classifyQuote(
      quote({
        price: 6,
        wasPrice: 12,
        isOnSpecial: true,
        promotionType: "special",
        specialType: "percent_off",
        priceDescription: "1/2 Price",
        savePercent: 50,
        sourceTimestamp: "2026-11-11T11:41:07Z",
        upstreamStoreParameterSent: true,
      }),
    );
    expect(result.schema).toBe("schema_valid");
    expect(result.promotion).toBe("promotion_confirmed");
    expect(result.promotionKind).toBe("half_price");
    expect(result.freshness).toBe("freshly_fetched");
    expect(result.storeParameter).toBe("store_parameter_forwarded");
    expect(result.storePrice).toBe("store_price_unverified");
    expect(result.availability).toBe("available");
  });

  it("does not treat percent_off below 50 percent as half price", () => {
    const result = classifyQuote(
      quote({
        price: 7,
        wasPrice: 10,
        isOnSpecial: true,
        promotionType: "special",
        specialType: "percent_off",
        savePercent: 30,
      }),
    );
    expect(result.promotionKind).toBe("ordinary_special");
    expect(result.promotion).toBe("promotion_confirmed");
  });

  it("keeps multibuy reward separate from the shelf price", () => {
    const result = classifyQuote(
      quote({
        price: 6,
        isOnSpecial: true,
        promotionType: "special",
        specialType: "multi_save",
        offerDescription: "Pick any 2 for $8",
        multiBuy: { minQuantity: 2, priceEach: 4, totalPrice: 8 },
      }),
    );
    expect(result.promotionKind).toBe("multibuy");
    expect(result.promotion).toBe("promotion_confirmed");
    expect(result.freshness).toBe("historical_cached");
  });

  it("leaves a special without a former price ambiguous", () => {
    const result = classifyQuote(
      quote({
        price: 3.9,
        isOnSpecial: true,
        promotionType: "everyday",
      }),
    );
    expect(result.promotion).toBe("promotion_ambiguous");
    expect(result.promotionKind).toBe("special_without_former_price");
  });

  it("confirms a regular shelf price", () => {
    const result = classifyQuote(quote({ price: 4.95 }));
    expect(result.promotionKind).toBe("regular");
    expect(result.promotion).toBe("promotion_confirmed");
    expect(result.storeParameter).toBe("store_parameter_unknown");
  });

  it("rejects a non-AUD or incomplete quote", () => {
    const result = classifyQuote(
      quote({
        id: " ",
        currency: "USD",
        price: null,
        isAvailable: null,
        isOnSpecial: null,
      }),
    );
    expect(result.schema).toBe("schema_invalid");
    expect(result.schemaProblems).toEqual([
      "missing_id",
      "bad_price",
      "bad_currency",
      "bad_availability",
      "bad_special_flag",
    ]);
    expect(result.promotionKind).toBe("unknown");
    expect(result.storePrice).toBe("store_price_unverified");
  });

  it("verifies a store price only from an independent source", () => {
    const result = classifyQuote(quote({ price: 6, wasPrice: 12, independentStorePrice: true }));
    expect(result.storePrice).toBe("store_price_independently_verified");
  });

  it("records unavailable separately from promotion", () => {
    const result = classifyQuote(quote({ isAvailable: false, isOnSpecial: true, price: 3.3 }));
    expect(result.availability).toBe("unavailable");
    expect(result.promotion).toBe("promotion_ambiguous");
  });
});

describe("assessListingPage", () => {
  it("explains the specials page as 48 organic rows plus sponsored extras under the 104 cap", () => {
    const result = assessListingPage({
      totalCount: 7289,
      perPage: OMKAR_LISTING_PAGE_SIZE,
      reportedTotalPages: 104,
      returnedProducts: 58,
      sponsoredProducts: 10,
      maxPages: OMKAR_LISTING_MAX_PAGES,
    });
    expect(result.organicProducts).toBe(48);
    expect(result.organicMatchesPageSize).toBe(true);
    expect(result.sponsoredAreExtra).toBe(true);
    expect(result.calculatedPages).toBe(152);
    expect(result.pageCapBinds).toBe(true);
    expect(result.reportedPagesMatchContract).toBe(true);
    expect(result.reachableOrganicProducts).toBe(4992);
    expect(result.unreachableProducts).toBe(2297);
    expect(result.completeCatalogueEnumeration).toBe("not_possible");
  });

  it("does not prove search enumeration when sponsored rows are injected", () => {
    const result = assessListingPage({
      totalCount: 296,
      perPage: OMKAR_LISTING_PAGE_SIZE,
      reportedTotalPages: 7,
      returnedProducts: 55,
      sponsoredProducts: 7,
      maxPages: OMKAR_LISTING_MAX_PAGES,
    });
    expect(result.pageCapBinds).toBe(false);
    expect(result.reportedPagesMatchContract).toBe(true);
    expect(result.organicProducts).toBe(48);
    expect(result.unreachableProducts).toBe(0);
    expect(result.completeCatalogueEnumeration).toBe("not_proven");
  });
});

describe("compareStoreQuotes", () => {
  it("treats equal prices as inconclusive when stock differs", () => {
    const result = compareStoreQuotes({
      priceA: 6,
      priceB: 6,
      wasPriceA: 12,
      wasPriceB: 12,
      quantityA: 257,
      quantityB: 399,
    });
    expect(result.pricesEqual).toBe(true);
    expect(result.stockDiffers).toBe(true);
    expect(result.storePrice).toBe("store_price_unverified");
    expect(result.equalPricesAreInconclusive).toBe(true);
  });
});
