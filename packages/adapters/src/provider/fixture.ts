import type {
  BulkPricesRequest,
  DataProvider,
  ProductDetailsRequest,
  ProviderCallContext,
  ProviderCapabilities,
  ProviderError,
  ProviderIdentity,
  ProviderOutcome,
  RawProviderProduct,
  SearchRequest,
  SpecialsRequest,
  StoreLookupRequest,
  StoreRecord,
} from "@easypws/contracts";
import type { RouterClock } from "./clock.js";

export type FixtureScript =
  | { kind: "error"; error: ProviderError }
  | { kind: "hang" }
  | { kind: "quote"; product: RawProviderProduct; delayMs?: number };

export type FixtureListScript =
  | { kind: "error"; error: ProviderError }
  | { kind: "hang" }
  | { kind: "quotes"; products: readonly RawProviderProduct[] };

export interface FixtureCalls {
  productDetails: number;
  search: number;
  specials: number;
  bulkPrices: number;
  storeLookup: number;
}

export interface FixtureProvider extends DataProvider {
  readonly calls: FixtureCalls;
}

const UNSUPPORTED: ProviderError = {
  errorClass: "unsupported_capability",
  reason: "unsupported_capability",
  retryable: false,
};

function runScript(
  script: FixtureScript,
  context: ProviderCallContext,
  clock: RouterClock,
): Promise<ProviderOutcome<RawProviderProduct>> {
  if (script.kind === "error") {
    return Promise.resolve({ ok: false, error: script.error });
  }
  if (script.kind === "hang") {
    return hang(context);
  }
  const delayMs = script.delayMs ?? 0;
  if (delayMs <= 0) {
    return Promise.resolve({ ok: true, value: script.product });
  }
  return new Promise((resolve, reject) => {
    const timer = clock.setTimer(() => {
      resolve({ ok: true, value: script.product });
    }, delayMs);
    const fail = () => {
      timer.cancel();
      reject(new Error("aborted"));
    };
    if (context.signal.aborted) {
      fail();
      return;
    }
    context.signal.addEventListener("abort", fail);
  });
}

function hang(context: ProviderCallContext): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new Error("aborted"));
    if (context.signal.aborted) {
      fail();
      return;
    }
    context.signal.addEventListener("abort", fail);
  });
}

export function createFixtureProvider(options: {
  identity: ProviderIdentity;
  capabilities: ProviderCapabilities;
  clock: RouterClock;
  productDetails?: FixtureScript | ((request: ProductDetailsRequest) => FixtureScript);
  bulkPrices?: (request: BulkPricesRequest) => FixtureListScript;
}): FixtureProvider {
  const calls: FixtureCalls = {
    productDetails: 0,
    search: 0,
    specials: 0,
    bulkPrices: 0,
    storeLookup: 0,
  };

  return {
    identity: options.identity,
    capabilities: options.capabilities,
    calls,
    async getProductDetails(request, context) {
      if (!options.capabilities.productDetails || !options.productDetails) {
        return { ok: false, error: UNSUPPORTED };
      }
      calls.productDetails += 1;
      const script =
        typeof options.productDetails === "function"
          ? options.productDetails(request)
          : options.productDetails;
      return runScript(script, context, options.clock);
    },
    async search(_request: SearchRequest, _context) {
      if (!options.capabilities.search) {
        return { ok: false, error: UNSUPPORTED };
      }
      calls.search += 1;
      return { ok: true, value: [] };
    },
    async specials(_request: SpecialsRequest, _context) {
      if (!options.capabilities.specials) {
        return { ok: false, error: UNSUPPORTED };
      }
      calls.specials += 1;
      return { ok: true, value: [] };
    },
    async bulkPrices(request, context) {
      if (!options.capabilities.bulkPrices) {
        return { ok: false, error: UNSUPPORTED };
      }
      calls.bulkPrices += 1;
      if (!options.bulkPrices) {
        return { ok: true, value: [] };
      }
      const script = options.bulkPrices(request);
      if (script.kind === "error") {
        return { ok: false, error: script.error };
      }
      if (script.kind === "hang") {
        return hang(context);
      }
      return { ok: true, value: script.products };
    },
    async lookupStore(request: StoreLookupRequest, _context): Promise<ProviderOutcome<StoreRecord>> {
      if (!options.capabilities.storeLookup) {
        return { ok: false, error: UNSUPPORTED };
      }
      calls.storeLookup += 1;
      const query = request.query.trim();
      if (query === "") {
        return {
          ok: false,
          error: { errorClass: "not_found", reason: "store_missing", retryable: false },
        };
      }
      return { ok: true, value: { externalStoreId: query, name: "Fixture store" } };
    },
  };
}
