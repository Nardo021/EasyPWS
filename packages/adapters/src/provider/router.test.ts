import { describe, expect, it } from "vitest";
import type { ProviderCapabilities, RawProviderProduct } from "@easypws/contracts";
import { createFixtureProvider, type FixtureProvider, type FixtureScript } from "./fixture.js";
import { normalizeProductQuote } from "./normalize.js";
import { ManualClock, ProviderRouter, type RouterClock } from "./router.js";

const ASSESSED_AT = Date.parse("2026-11-11T02:00:00.000Z");
const CURRENT_SOURCE = "2026-11-11T01:00:00.000Z";

function capabilities(partial: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    productDetails: true,
    search: false,
    specials: false,
    bulkPrices: false,
    storeLookup: false,
    ...partial,
  };
}

function product(overrides: Partial<RawProviderProduct> = {}): RawProviderProduct {
  return {
    retailerProductId: "8737163",
    echoedStoreId: null,
    name: "Energy Drink",
    currency: "AUD",
    price: 6,
    wasPrice: null,
    isOnSpecial: false,
    promotionType: "none",
    specialType: null,
    priceDescription: null,
    offerDescription: null,
    savePercent: null,
    multiBuy: null,
    isAvailable: true,
    sourceTimestamp: null,
    httpStatus: 200,
    ...overrides,
  };
}

function quoteScript(overrides: Partial<RawProviderProduct> = {}): FixtureScript {
  return { kind: "quote", product: product(overrides) };
}

function routerFor(
  providers: FixtureProvider[],
  clock: RouterClock,
  budgets: Record<string, number> = {},
): ProviderRouter {
  return new ProviderRouter(providers, {
    timeoutMs: 50,
    circuitFailureThreshold: 2,
    circuitOpenMs: 1_000,
    budgets,
    clock,
  });
}

async function settle<T>(clock: ManualClock, work: Promise<T>, advanceMs = 0): Promise<T> {
  await Promise.resolve();
  if (advanceMs > 0) {
    clock.advance(advanceMs);
  }
  return work;
}

describe("quote normalization", () => {
  it("keeps regular, half-price, ordinary special, and multibuy prices distinct", () => {
    const regular = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "sku-regular",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({
        retailerProductId: "sku-regular",
        price: 4.95,
      }),
    });
    const half = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "sku-half",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({
        retailerProductId: "sku-half",
        price: 6,
        wasPrice: 12,
        isOnSpecial: true,
        promotionType: "special",
        specialType: "percent_off",
        priceDescription: "1/2 Price",
        savePercent: 50,
        sourceTimestamp: CURRENT_SOURCE,
      }),
    });
    const ordinary = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "sku-special",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({
        retailerProductId: "sku-special",
        price: 7,
        wasPrice: 10,
        isOnSpecial: true,
        promotionType: "special",
        savePercent: 30,
      }),
    });
    const multibuy = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "sku-multi",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({
        retailerProductId: "sku-multi",
        price: 5,
        isOnSpecial: true,
        promotionType: "special",
        offerDescription: "Pick any 2 for $8",
        multiBuy: { minQuantity: 2, totalPrice: 8 },
      }),
    });

    expect(regular.ok && regular.quote.promotionKind).toBe("regular");
    expect(half.ok && half.quote.promotionKind).toBe("half_price");
    expect(ordinary.ok && ordinary.quote.promotionKind).toBe("ordinary_special");
    expect(multibuy.ok && multibuy.quote.promotionKind).toBe("multibuy");
    if (!multibuy.ok) {
      throw new Error("expected multibuy quote");
    }
    expect(multibuy.quote.priceAud).toBe(5);
    expect(multibuy.quote.multiBuyTotalAud).toBe(8);
    expect(multibuy.quote.singleItemPriceFromOffer).toBeNull();
  });

  it("does not verify a store price from an echoed store id", () => {
    const result = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "8737163",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({
        echoedStoreId: "4166",
        claims: { upstreamStoreParameterSent: true, independentStorePrice: true },
      }),
    });
    const trusted = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "8737163",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({ echoedStoreId: "4166" }),
      trusted: { upstreamStoreParameterSent: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !trusted.ok) {
      return;
    }
    expect(result.quote.storeParameter).toBe("store_parameter_unknown");
    expect(result.quote.storePrice).toBe("store_price_unverified");
    expect(result.quote.provenanceClaims.independentStorePrice).toBe(true);
    expect(trusted.quote.storeParameter).toBe("store_parameter_forwarded");
    expect(trusted.quote.storePrice).toBe("store_price_unverified");
    expect(result.quote.notificationEligible).toBe(false);
    expect(result.quote.confirmedLiveSpecial).toBe(false);
  });

  it("keeps a missing source timestamp unknown and a current one unconfirmed", () => {
    const missing = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "8737163",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product(),
    });
    const current = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "8737163",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({
        sourceTimestamp: CURRENT_SOURCE,
        claims: { cacheProvenance: "not_cached", freshnessConfirmed: true },
      }),
    });
    expect(missing.ok && missing.quote.sourceAge).toBe("unknown");
    expect(missing.ok && missing.quote.freshness).toBe("unknown");
    expect(missing.ok && missing.quote.cacheProvenance).toBe("unknown");
    expect(current.ok && current.quote.sourceAge).toBe("current");
    expect(current.ok && current.quote.freshness).toBe("unknown");
    expect(current.ok && current.quote.cacheProvenance).toBe("unknown");
    expect(current.ok && current.quote.provenanceClaims.freshnessConfirmed).toBe(true);
    expect(current.ok && current.quote.notificationEligible).toBe(false);
  });

  it("rejects an HTTP 200 for the wrong product or an invalid price", () => {
    const wrong = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "8737163",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({ retailerProductId: "other" }),
    });
    const invalid = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "8737163",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({ price: null, currency: "USD" }),
    });
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.error.errorClass).toBe("invalid_quote");
    expect(!wrong.ok && wrong.error.reason).toBe("wrong_product");
    expect(invalid.ok).toBe(false);
    expect(!invalid.ok && invalid.error.reason).toBe("schema_invalid");
    expect(!invalid.ok && invalid.error.schemaProblems).toEqual(
      expect.arrayContaining(["bad_price", "bad_currency"]),
    );
  });

  it("keeps unknown availability and an ambiguous promotion off the notification path", () => {
    const unknownStock = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "8737163",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({ isAvailable: null }),
    });
    const ambiguous = normalizeProductQuote({
      retailerId: "coles",
      providerId: "fixture-a",
      upstreamFamily: "coles",
      requestedStoreId: "4166",
      requestedProductId: "8737163",
      retrievedAt: "2026-11-11T02:00:00.000Z",
      assessedAt: "2026-11-11T02:00:00.000Z",
      product: product({
        price: 3.9,
        isOnSpecial: true,
        promotionType: "everyday",
        sourceTimestamp: CURRENT_SOURCE,
        claims: { independentStorePrice: true, freshnessConfirmed: true },
      }),
      trusted: { independentStorePrice: true, freshnessConfirmed: true },
    });
    expect(!unknownStock.ok && unknownStock.error.reason).toBe("schema_invalid");
    expect(ambiguous.ok && ambiguous.quote.promotion).toBe("promotion_ambiguous");
    expect(ambiguous.ok && ambiguous.quote.promotionKind).toBe("special_without_former_price");
    expect(ambiguous.ok && ambiguous.quote.notificationEligible).toBe(false);
    expect(ambiguous.ok && ambiguous.quote.confirmedLiveSpecial).toBe(false);
  });
});

describe("provider router", () => {
  it("uses provider B when provider A fails, and does not call A again", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const providerA = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: {
        kind: "error",
        error: { errorClass: "authorization", reason: "authorization_rejected", retryable: false },
      },
    });
    const providerB = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-b", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: quoteScript(),
    });
    const result = await routerFor([providerA, providerB], clock).getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });

    expect(providerA.calls.productDetails).toBe(1);
    expect(providerB.calls.productDetails).toBe(1);
    expect(result.outcome).toBe("selected");
    if (result.outcome !== "selected") {
      return;
    }
    expect(result.quote.providerId).toBe("provider-b");
    expect(result.quote.storePrice).toBe("store_price_unverified");
    expect(result.notificationEligible).toBe(false);
    expect(result.diagnostics.map((item) => item.reason)).toEqual([
      "authorization_rejected",
      "selected",
    ]);
  });

  it("reports unavailable when every provider fails", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const providerA = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: { kind: "hang" },
    });
    const providerB = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-b", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: {
        kind: "error",
        error: { errorClass: "unavailable", reason: "upstream_unavailable", retryable: false },
      },
    });
    const pending = routerFor([providerA, providerB], clock).getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    const result = await settle(clock, pending, 50);

    expect(result.outcome).toBe("unavailable");
    expect(result.quote).toBeNull();
    expect(result.notificationEligible).toBe(false);
    expect(result.diagnostics.map((item) => item.reason)).toEqual([
      "deadline_exceeded",
      "upstream_unavailable",
    ]);
  });

  it("skips an unsupported capability without spending budget", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const providerA = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities({ productDetails: false, search: true }),
      clock,
      productDetails: quoteScript({ price: 1 }),
    });
    const providerB = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-b", upstreamFamily: "other" },
      capabilities: capabilities(),
      clock,
      productDetails: quoteScript(),
    });
    const router = routerFor([providerA, providerB], clock, { "provider-a": 1, "provider-b": 1 });
    const result = await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });

    expect(providerA.calls.productDetails).toBe(0);
    expect(router.budget("provider-a").remaining).toBe(1);
    expect(result.outcome).toBe("selected");
    expect(result.diagnostics[0]?.reason).toBe("unsupported_capability");
    expect(result.quote?.providerId).toBe("provider-b");
  });

  it("does not invent a store when the provider reports it missing", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: {
        kind: "error",
        error: { errorClass: "not_found", reason: "store_missing", retryable: false },
      },
    });
    const result = await routerFor([provider], clock).getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(result.outcome).toBe("unavailable");
    expect(result.quote).toBeNull();
    expect(result.diagnostics[0]?.reason).toBe("store_missing");
  });

  it("treats a wrong product and an invalid price schema as failed HTTP 200 responses", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const wrong = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "wrong-product", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: quoteScript({ retailerProductId: "999" }),
    });
    const invalid = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "bad-price", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: quoteScript({ price: null }),
    });
    const wrongResult = await routerFor([wrong], clock).getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    const invalidResult = await routerFor([invalid], clock).getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(wrongResult.outcome).toBe("unavailable");
    expect(wrongResult.diagnostics[0]?.reason).toBe("wrong_product");
    expect(invalidResult.outcome).toBe("unavailable");
    expect(invalidResult.diagnostics[0]?.reason).toBe("schema_invalid");
    expect(invalidResult.diagnostics[0]?.httpStatus).toBe(200);
  });

  it("stops calling a provider after its budget is exhausted", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: { kind: "hang" },
    });
    const router = routerFor([provider], clock, { "provider-a": 1 });
    const first = router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    await settle(clock, first, 50);
    const second = await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(provider.calls.productDetails).toBe(1);
    expect(second.diagnostics[0]?.reason).toBe("budget_exhausted");
    expect(router.budget("provider-a").remaining).toBe(0);
  });

  it("times out on the injected clock and does not retry that call", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: { kind: "hang" },
    });
    const pending = routerFor([provider], clock).getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    const result = await settle(clock, pending, 50);
    expect(result.outcome).toBe("unavailable");
    expect(provider.calls.productDetails).toBe(1);
    expect(result.diagnostics[0]?.errorClass).toBe("timeout");
  });

  it("opens the circuit after repeated timeouts and closes it after a later success", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    let mode: "hang" | "ok" = "hang";
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: () => (mode === "hang" ? { kind: "hang" } : quoteScript()),
    });
    const router = routerFor([provider], clock);
    const first = router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    await settle(clock, first, 50);
    const second = router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    await settle(clock, second, 50);
    expect(router.health("provider-a").circuit).toBe("open");

    const blocked = await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(blocked.diagnostics[0]?.reason).toBe("circuit_open");
    expect(provider.calls.productDetails).toBe(2);

    clock.advance(1_000);
    mode = "ok";
    const recovered = await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(recovered.outcome).toBe("selected");
    expect(router.health("provider-a").circuit).toBe("closed");
    expect(provider.calls.productDetails).toBe(3);
  });

  it("does not retry an authorization failure on a later request", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: {
        kind: "error",
        error: { errorClass: "authorization", reason: "authorization_rejected", retryable: false },
      },
    });
    const router = routerFor([provider], clock);
    await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    clock.advance(60_000);
    const again = await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(provider.calls.productDetails).toBe(1);
    expect(again.diagnostics[0]?.reason).toBe("authorization_blocked");
    expect(again.diagnostics[0]?.errorClass).toBe("authorization");
  });

  it("keeps an ambiguous promotion and unknown freshness in review only", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const ambiguous = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "ambiguous", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: quoteScript({
        price: 3.9,
        isOnSpecial: true,
        promotionType: "everyday",
        sourceTimestamp: CURRENT_SOURCE,
      }),
    });
    const unknown = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "unknown-freshness", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: quoteScript({ sourceTimestamp: null }),
    });
    const ambiguousResult = await routerFor([ambiguous], clock).getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    const unknownResult = await routerFor([unknown], clock).getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(ambiguousResult.quote?.promotion).toBe("promotion_ambiguous");
    expect(ambiguousResult.quote?.confirmedLiveSpecial).toBe(false);
    expect(ambiguousResult.notificationEligible).toBe(false);
    expect(unknownResult.quote?.freshness).toBe("unknown");
    expect(unknownResult.quote?.cacheProvenance).toBe("unknown");
    expect(unknownResult.notificationEligible).toBe(false);
  });

  it("does not treat another Coles-family provider as independent store evidence", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const providerA = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "hosted", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: {
        kind: "error",
        error: { errorClass: "unavailable", reason: "upstream_unavailable", retryable: false },
      },
    });
    const providerB = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "bff", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: quoteScript({ echoedStoreId: "4166", price: 6, wasPrice: 12 }),
    });
    const result = await routerFor([providerA, providerB], clock).getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(result.outcome).toBe("selected");
    expect(result.quote?.storePrice).toBe("store_price_unverified");
    expect(result.upstreamEvidence).toBe("not_independent");
    expect(result.notificationEligible).toBe(false);
  });

  it("does not let provider-controlled flags enable a notification", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "outside", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: quoteScript({
        echoedStoreId: "4166",
        price: 6,
        wasPrice: 12,
        isOnSpecial: true,
        promotionType: "special",
        priceDescription: "1/2 Price",
        savePercent: 50,
        sourceTimestamp: CURRENT_SOURCE,
        claims: {
          freshnessConfirmed: true,
          independentStorePrice: true,
          upstreamStoreParameterSent: true,
          cacheProvenance: "not_cached",
        },
      }),
    });
    const router = routerFor([provider], clock);
    const claimed = await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    const trusted = await router.getProductDetails(
      "coles",
      { retailerProductId: "8737163", externalStoreId: "4166" },
      { independentStorePrice: true, freshnessConfirmed: true },
    );
    expect(claimed.quote?.storePrice).toBe("store_price_unverified");
    expect(claimed.quote?.freshness).toBe("unknown");
    expect(claimed.quote?.storeParameter).toBe("store_parameter_unknown");
    expect(claimed.quote?.cacheProvenance).toBe("unknown");
    expect(claimed.quote?.provenanceClaims.independentStorePrice).toBe(true);
    expect(claimed.notificationEligible).toBe(false);
    expect(claimed.quote?.confirmedLiveSpecial).toBe(false);
    expect(trusted.quote?.storePrice).toBe("store_price_independently_verified");
    expect(trusted.quote?.freshness).toBe("fresh");
    expect(trusted.quote?.notificationEligible).toBe(true);
    expect(trusted.upstreamEvidence).toBe("explicit_outside_source");
  });

  it("skips search when that capability is absent and does not notify", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
    });
    const result = await routerFor([provider], clock).search("coles", {
      query: "milk",
      externalStoreId: "4166",
    });
    expect(provider.calls.search).toBe(0);
    expect(result.outcome).toBe("unavailable");
    expect(result.notificationEligible).toBe(false);
  });

  it("does not turn a store lookup into a verified price", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities({ storeLookup: true }),
      clock,
    });
    const router = routerFor([provider], clock);
    const missing = await router.lookupStore("coles", { query: " " });
    const found = await router.lookupStore("coles", { query: "4166" });
    expect(missing.outcome).toBe("unavailable");
    expect(missing.store).toBeNull();
    expect(missing.notificationEligible).toBe(false);
    expect(found.outcome).toBe("selected");
    expect(found.store).toEqual({ externalStoreId: "4166", name: "Fixture store" });
    expect(found.notificationEligible).toBe(false);
    expect(found.upstreamEvidence).toBe("not_independent");
  });

  it("opens the circuit on a rate limit and does not call that provider again", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: {
        kind: "error",
        error: { errorClass: "rate_limited", reason: "rate_limited", retryable: false },
      },
    });
    const router = routerFor([provider], clock);
    await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    const again = await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(provider.calls.productDetails).toBe(1);
    expect(router.health("provider-a").circuit).toBe("open");
    expect(again.diagnostics[0]?.reason).toBe("circuit_open");
  });

  it("allows only one in-flight half-open probe", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    let mode: "hang" | "ok" = "hang";
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities(),
      clock,
      productDetails: () => (mode === "hang" ? { kind: "hang" } : quoteScript()),
    });
    const router = routerFor([provider], clock);
    await settle(
      clock,
      router.getProductDetails("coles", { retailerProductId: "8737163", externalStoreId: "4166" }),
      50,
    );
    await settle(
      clock,
      router.getProductDetails("coles", { retailerProductId: "8737163", externalStoreId: "4166" }),
      50,
    );
    clock.advance(1_000);
    const first = router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    const second = await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(provider.calls.productDetails).toBe(3);
    expect(second.outcome).toBe("unavailable");
    expect(second.diagnostics[0]?.reason).toBe("probe_in_flight");
    expect(second.diagnostics[0]?.calls).toBe(0);
    await settle(clock, first, 50);
    expect(router.health("provider-a").circuit).toBe("open");
    clock.advance(1_000);
    mode = "ok";
    const recovered = router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    const blocked = await router.getProductDetails("coles", {
      retailerProductId: "8737163",
      externalStoreId: "4166",
    });
    expect(blocked.diagnostics[0]?.reason).toBe("probe_in_flight");
    expect(provider.calls.productDetails).toBe(4);
    await recovered;
    expect(router.health("provider-a").circuit).toBe("closed");
  });

  it("keeps an empty search or specials result without applying bulk completeness", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const provider = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "provider-a", upstreamFamily: "coles" },
      capabilities: capabilities({ search: true, specials: true }),
      clock,
    });
    const router = routerFor([provider], clock);
    const search = await router.search("coles", { query: "milk", externalStoreId: "4166" });
    const specials = await router.specials("coles", { externalStoreId: "4166", page: 1 });
    expect(search.outcome).toBe("selected");
    expect(search.quotes).toEqual([]);
    expect(search.bulkIntegrity.status).toBe("not_applicable");
    expect(search.notificationEligible).toBe(false);
    expect(specials.outcome).toBe("selected");
    expect(specials.quotes).toEqual([]);
    expect(specials.bulkIntegrity.status).toBe("not_applicable");
  });

  it("does not treat an incomplete bulk response as a complete success", async () => {
    const clock = new ManualClock(ASSESSED_AT);
    const incomplete = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "incomplete", upstreamFamily: "coles" },
      capabilities: capabilities({ bulkPrices: true, productDetails: false }),
      clock,
      bulkPrices: () => ({
        kind: "quotes",
        products: [
          product({ retailerProductId: "sku-a" }),
          product({ retailerProductId: "sku-a" }),
          product({ retailerProductId: "sku-c", echoedStoreId: "584" }),
          product({ retailerProductId: "sku-d" }),
          product({ retailerProductId: "sku-extra" }),
        ],
      }),
    });
    const exact = createFixtureProvider({
      identity: { retailerId: "coles", providerId: "exact", upstreamFamily: "coles" },
      capabilities: capabilities({ bulkPrices: true, productDetails: false }),
      clock,
      bulkPrices: () => ({
        kind: "quotes",
        products: [
          product({
            retailerProductId: "sku-b",
            claims: { independentStorePrice: true, freshnessConfirmed: true },
          }),
          product({ retailerProductId: "sku-a", echoedStoreId: "4166" }),
          product({ retailerProductId: "sku-c" }),
          product({ retailerProductId: "sku-d" }),
        ],
      }),
    });
    const requested = {
      retailerProductIds: ["sku-a", "sku-b", "sku-c", "sku-d"],
      externalStoreId: "4166",
    };
    const onlyIncomplete = await routerFor([incomplete], clock).bulkPrices("coles", requested);
    const recovered = await routerFor([incomplete, exact], clock).bulkPrices("coles", requested);
    expect(onlyIncomplete.outcome).toBe("partial");
    expect(onlyIncomplete.notificationEligible).toBe(false);
    expect(onlyIncomplete.requestedStoreId).toBe("4166");
    expect(onlyIncomplete.bulkIntegrity.missingIds).toEqual(["sku-b"]);
    expect(onlyIncomplete.bulkIntegrity.duplicateIds).toEqual(["sku-a"]);
    expect(onlyIncomplete.bulkIntegrity.unexpectedIds).toEqual(["sku-extra"]);
    expect(onlyIncomplete.bulkIntegrity.storeMismatchIds).toEqual(["sku-c"]);
    expect(onlyIncomplete.quotes.map((quote) => quote.retailerProductId)).toEqual(["sku-d"]);
    expect(onlyIncomplete.quotes[0]?.notificationEligible).toBe(false);
    expect(onlyIncomplete.quotes[0]?.requestedStoreId).toBe("4166");
    expect(onlyIncomplete.diagnostics[0]?.reason).toBe("bulk_incomplete");
    expect(recovered.outcome).toBe("selected");
    expect(recovered.quotes.map((quote) => quote.retailerProductId)).toEqual([
      "sku-a",
      "sku-b",
      "sku-c",
      "sku-d",
    ]);
    expect(recovered.quotes.every((quote) => quote.requestedStoreId === "4166")).toBe(true);
    expect(recovered.quotes.every((quote) => quote.notificationEligible === false)).toBe(true);
    expect(recovered.bulkIntegrity.status).toBe("complete");
    expect(exact.calls.bulkPrices).toBe(1);
  });
});
