import type {
  BulkPricesRequest,
  DataProvider,
  DiagnosticReason,
  ProductDetailsRequest,
  ProviderCallContext,
  ProviderCapabilities,
  ProviderCapability,
  ProviderError,
  ProviderErrorClass,
  ProviderOutcome,
  RawProviderProduct,
  RetailerId,
  SearchRequest,
  SpecialsRequest,
  StoreLookupRequest,
  StoreRecord,
  TrustedQuoteEvidence,
  UpstreamFamily,
} from "@easypws/contracts";
import { emptyBulkIntegrity, evaluateBulkResponse, type BulkIntegrity } from "./bulk.js";
import { ManualClock, systemRouterClock, type RouterClock } from "./clock.js";
import { classifyHttpStatus } from "./http.js";
import { normalizeProductQuote, type NormalizedProviderQuote } from "./normalize.js";

export { ManualClock, systemRouterClock, type RouterClock };

export interface AttemptDiagnostic {
  providerId: string;
  retailerId: RetailerId;
  upstreamFamily: UpstreamFamily;
  capability: ProviderCapability;
  calls: 0 | 1;
  reason: DiagnosticReason;
  errorClass?: ProviderErrorClass;
  httpStatus?: number;
  budgetRemaining: number;
  elapsedMs: number;
}

export type UpstreamEvidence = "not_independent" | "explicit_outside_source";

export type ProductRouteResult = {
  diagnostics: readonly AttemptDiagnostic[];
  notificationEligible: boolean;
  upstreamEvidence: UpstreamEvidence;
} & (
  | { outcome: "selected"; quote: NormalizedProviderQuote }
  | { outcome: "unavailable"; quote: null }
);

export type CollectionRouteResult = {
  diagnostics: readonly AttemptDiagnostic[];
  notificationEligible: false;
  upstreamEvidence: UpstreamEvidence;
  requestedStoreId: string;
  bulkIntegrity: BulkIntegrity;
} & (
  | { outcome: "selected"; quotes: readonly NormalizedProviderQuote[] }
  | { outcome: "partial"; quotes: readonly NormalizedProviderQuote[] }
  | { outcome: "unavailable"; quotes: readonly [] }
);

export type { BulkIntegrity };

export type StoreRouteResult = {
  outcome: "selected" | "unavailable";
  store: StoreRecord | null;
  diagnostics: readonly AttemptDiagnostic[];
  notificationEligible: false;
  upstreamEvidence: "not_independent";
};

export interface RouterConfig {
  timeoutMs: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
  budgets: Readonly<Record<string, number>>;
  clock: RouterClock;
}

type CircuitState = "closed" | "open" | "half_open";

interface BudgetState {
  limit: number;
  remaining: number;
}

interface HealthState {
  circuit: CircuitState;
  consecutiveTransientFailures: number;
  authBlocked: boolean;
  openedAtMs: number | null;
  probeInFlight: boolean;
}

const DEFAULT_BUDGET = 1_000;

class DeadlineExceeded extends Error {
  constructor() {
    super("deadline_exceeded");
    this.name = "DeadlineExceeded";
  }
}

function supports(capabilities: ProviderCapabilities, capability: ProviderCapability): boolean {
  switch (capability) {
    case "product_details":
      return capabilities.productDetails;
    case "search":
      return capabilities.search;
    case "specials":
      return capabilities.specials;
    case "bulk_prices":
      return capabilities.bulkPrices;
    case "store_lookup":
      return capabilities.storeLookup;
    default: {
      const unexpected: never = capability;
      return unexpected;
    }
  }
}

function isTransient(errorClass: ProviderErrorClass): boolean {
  switch (errorClass) {
    case "timeout":
    case "unavailable":
      return true;
    case "authorization":
    case "not_found":
    case "invalid_quote":
    case "rate_limited":
    case "budget_exhausted":
    case "unsupported_capability":
    case "circuit_open":
      return false;
    default: {
      const unexpected: never = errorClass;
      return unexpected;
    }
  }
}

function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  clock: RouterClock,
  controller: AbortController,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      timer.cancel();
      settle();
    };
    const timer = clock.setTimer(() => {
      controller.abort();
      finish(() => reject(new DeadlineExceeded()));
    }, timeoutMs);
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => {
        if (controller.signal.aborted) {
          finish(() => reject(new DeadlineExceeded()));
          return;
        }
        finish(() => reject(error));
      },
    );
  });
}

function evidenceFor(quote: NormalizedProviderQuote): UpstreamEvidence {
  return quote.storePrice === "store_price_independently_verified"
    ? "explicit_outside_source"
    : "not_independent";
}

/**
 * Ordered, one-attempt provider selection.
 * A shared upstream family never upgrades a quote to independent evidence.
 */
export class ProviderRouter {
  private readonly budgets = new Map<string, BudgetState>();
  private readonly healthByProvider = new Map<string, HealthState>();

  constructor(
    private readonly providers: readonly DataProvider[],
    private readonly config: RouterConfig,
  ) {}

  budget(providerId: string): { limit: number; remaining: number } {
    const state = this.budgetOf(providerId);
    return { limit: state.limit, remaining: state.remaining };
  }

  health(providerId: string): { circuit: CircuitState } {
    return { circuit: this.healthOf(providerId).circuit };
  }

  getProductDetails(
    retailerId: RetailerId,
    request: ProductDetailsRequest,
    trusted?: TrustedQuoteEvidence,
  ): Promise<ProductRouteResult> {
    return this.routeProduct(
      retailerId,
      "product_details",
      request.retailerProductId,
      request.externalStoreId,
      (provider, context) => provider.getProductDetails(request, context),
      trusted,
    );
  }

  search(retailerId: RetailerId, request: SearchRequest): Promise<CollectionRouteResult> {
    return this.routeCollection(retailerId, "search", request.externalStoreId, (provider, context) =>
      provider.search(request, context),
    );
  }

  specials(retailerId: RetailerId, request: SpecialsRequest): Promise<CollectionRouteResult> {
    return this.routeCollection(retailerId, "specials", request.externalStoreId, (provider, context) =>
      provider.specials(request, context),
    );
  }

  bulkPrices(retailerId: RetailerId, request: BulkPricesRequest): Promise<CollectionRouteResult> {
    return this.routeBulk(retailerId, request);
  }

  lookupStore(retailerId: RetailerId, request: StoreLookupRequest): Promise<StoreRouteResult> {
    return this.routeStore(retailerId, request);
  }

  private async routeProduct(
    retailerId: RetailerId,
    capability: ProviderCapability,
    requestedProductId: string,
    requestedStoreId: string,
    call: (provider: DataProvider, context: ProviderCallContext) => Promise<ProviderOutcome<RawProviderProduct>>,
    trusted?: TrustedQuoteEvidence,
  ): Promise<ProductRouteResult> {
    const diagnostics: AttemptDiagnostic[] = [];
    for (const provider of this.providers) {
      const skip = this.preflight(provider, retailerId, capability);
      if (skip) {
        diagnostics.push(skip);
        continue;
      }
      const started = this.config.clock.now();
      this.consume(provider.identity.providerId);
      const called = await this.callProvider((context) => call(provider, context));
      const elapsedMs = this.config.clock.now() - started;
      if (!called.ok) {
        this.observeFailure(provider.identity.providerId, called.error);
        diagnostics.push(this.failureDiagnostic(provider, capability, called.error, elapsedMs));
        continue;
      }
      const httpStatus = called.value.httpStatus;
      if (httpStatus !== 200) {
        const error = classifyHttpStatus(httpStatus);
        this.observeFailure(provider.identity.providerId, error);
        diagnostics.push(this.failureDiagnostic(provider, capability, error, elapsedMs, httpStatus));
        continue;
      }
      const retrievedAt = isoUtc(this.config.clock.now());
      const normalized = normalizeProductQuote({
        retailerId: provider.identity.retailerId,
        providerId: provider.identity.providerId,
        upstreamFamily: provider.identity.upstreamFamily,
        requestedStoreId,
        requestedProductId,
        retrievedAt,
        assessedAt: retrievedAt,
        product: called.value,
        ...(trusted ? { trusted } : {}),
      });
      if (!normalized.ok) {
        this.observeFailure(provider.identity.providerId, normalized.error);
        diagnostics.push(
          this.failureDiagnostic(provider, capability, normalized.error, elapsedMs, httpStatus),
        );
        continue;
      }
      this.observeSuccess(provider.identity.providerId);
      diagnostics.push(this.selectedDiagnostic(provider, capability, elapsedMs, httpStatus));
      return {
        outcome: "selected",
        quote: normalized.quote,
        notificationEligible: normalized.quote.notificationEligible,
        upstreamEvidence: evidenceFor(normalized.quote),
        diagnostics,
      };
    }
    return {
      outcome: "unavailable",
      quote: null,
      notificationEligible: false,
      upstreamEvidence: "not_independent",
      diagnostics,
    };
  }

  private async routeCollection(
    retailerId: RetailerId,
    capability: ProviderCapability,
    requestedStoreId: string,
    call: (
      provider: DataProvider,
      context: ProviderCallContext,
    ) => Promise<ProviderOutcome<readonly RawProviderProduct[]>>,
  ): Promise<CollectionRouteResult> {
    const diagnostics: AttemptDiagnostic[] = [];
    for (const provider of this.providers) {
      const skip = this.preflight(provider, retailerId, capability);
      if (skip) {
        diagnostics.push(skip);
        continue;
      }
      const started = this.config.clock.now();
      this.consume(provider.identity.providerId);
      const called = await this.callProvider((context) => call(provider, context));
      const elapsedMs = this.config.clock.now() - started;
      if (!called.ok) {
        this.observeFailure(provider.identity.providerId, called.error);
        diagnostics.push(this.failureDiagnostic(provider, capability, called.error, elapsedMs));
        continue;
      }
      const retrievedAt = isoUtc(this.config.clock.now());
      const quotes: NormalizedProviderQuote[] = [];
      let rejected: { error: ProviderError; httpStatus?: number } | undefined;
      for (const product of called.value) {
        if (product.httpStatus !== 200) {
          rejected = { error: classifyHttpStatus(product.httpStatus), httpStatus: product.httpStatus };
          break;
        }
        const normalized = normalizeProductQuote({
          retailerId: provider.identity.retailerId,
          providerId: provider.identity.providerId,
          upstreamFamily: provider.identity.upstreamFamily,
          requestedStoreId,
          requestedProductId: product.retailerProductId,
          retrievedAt,
          assessedAt: retrievedAt,
          product,
        });
        if (!normalized.ok) {
          rejected = { error: normalized.error, httpStatus: product.httpStatus };
          break;
        }
        quotes.push(normalized.quote);
      }
      if (rejected) {
        this.observeFailure(provider.identity.providerId, rejected.error);
        diagnostics.push(
          this.failureDiagnostic(provider, capability, rejected.error, elapsedMs, rejected.httpStatus),
        );
        continue;
      }
      this.observeSuccess(provider.identity.providerId);
      diagnostics.push(this.selectedDiagnostic(provider, capability, elapsedMs));
      const upstreamEvidence = quotes.some(
        (quote) => quote.storePrice === "store_price_independently_verified",
      )
        ? "explicit_outside_source"
        : "not_independent";
      return {
        outcome: "selected",
        quotes,
        notificationEligible: false,
        upstreamEvidence,
        requestedStoreId,
        bulkIntegrity: emptyBulkIntegrity(requestedStoreId),
        diagnostics,
      };
    }
    return {
      outcome: "unavailable",
      quotes: [],
      notificationEligible: false,
      upstreamEvidence: "not_independent",
      requestedStoreId,
      bulkIntegrity: emptyBulkIntegrity(requestedStoreId),
      diagnostics,
    };
  }

  private async routeBulk(retailerId: RetailerId, request: BulkPricesRequest): Promise<CollectionRouteResult> {
    const diagnostics: AttemptDiagnostic[] = [];
    const requestedStoreId = request.externalStoreId;
    let partial: { quotes: readonly NormalizedProviderQuote[]; integrity: BulkIntegrity } | undefined;
    for (const provider of this.providers) {
      const skip = this.preflight(provider, retailerId, "bulk_prices");
      if (skip) {
        diagnostics.push(skip);
        continue;
      }
      const started = this.config.clock.now();
      this.consume(provider.identity.providerId);
      const called = await this.callProvider((context) => provider.bulkPrices(request, context));
      const elapsedMs = this.config.clock.now() - started;
      if (!called.ok) {
        this.observeFailure(provider.identity.providerId, called.error);
        diagnostics.push(this.failureDiagnostic(provider, "bulk_prices", called.error, elapsedMs));
        continue;
      }
      const retrievedAt = isoUtc(this.config.clock.now());
      const evaluation = evaluateBulkResponse({
        retailerId: provider.identity.retailerId,
        providerId: provider.identity.providerId,
        upstreamFamily: provider.identity.upstreamFamily,
        requestedStoreId,
        requestedProductIds: request.retailerProductIds,
        products: called.value,
        retrievedAt,
        assessedAt: retrievedAt,
      });
      if (evaluation.complete) {
        this.observeSuccess(provider.identity.providerId);
        diagnostics.push(this.selectedDiagnostic(provider, "bulk_prices", elapsedMs));
        return {
          outcome: "selected",
          quotes: evaluation.quotes,
          notificationEligible: false,
          upstreamEvidence: "not_independent",
          requestedStoreId,
          bulkIntegrity: evaluation.integrity,
          diagnostics,
        };
      }
      const error: ProviderError = {
        errorClass: "invalid_quote",
        reason: "bulk_incomplete",
        retryable: false,
      };
      this.observeFailure(provider.identity.providerId, error);
      diagnostics.push(this.failureDiagnostic(provider, "bulk_prices", error, elapsedMs));
      partial ??= { quotes: evaluation.quotes, integrity: evaluation.integrity };
    }
    if (partial) {
      return {
        outcome: "partial",
        quotes: partial.quotes,
        notificationEligible: false,
        upstreamEvidence: "not_independent",
        requestedStoreId,
        bulkIntegrity: partial.integrity,
        diagnostics,
      };
    }
    return {
      outcome: "unavailable",
      quotes: [],
      notificationEligible: false,
      upstreamEvidence: "not_independent",
      requestedStoreId,
      bulkIntegrity: emptyBulkIntegrity(requestedStoreId),
      diagnostics,
    };
  }

  private async routeStore(retailerId: RetailerId, request: StoreLookupRequest): Promise<StoreRouteResult> {
    const diagnostics: AttemptDiagnostic[] = [];
    for (const provider of this.providers) {
      const skip = this.preflight(provider, retailerId, "store_lookup");
      if (skip) {
        diagnostics.push(skip);
        continue;
      }
      const started = this.config.clock.now();
      this.consume(provider.identity.providerId);
      const called = await this.callProvider((context) => provider.lookupStore(request, context));
      const elapsedMs = this.config.clock.now() - started;
      if (!called.ok) {
        this.observeFailure(provider.identity.providerId, called.error);
        diagnostics.push(this.failureDiagnostic(provider, "store_lookup", called.error, elapsedMs));
        continue;
      }
      if (called.value.externalStoreId.trim() === "") {
        const error: ProviderError = {
          errorClass: "not_found",
          reason: "store_missing",
          retryable: false,
        };
        this.observeFailure(provider.identity.providerId, error);
        diagnostics.push(this.failureDiagnostic(provider, "store_lookup", error, elapsedMs));
        continue;
      }
      this.observeSuccess(provider.identity.providerId);
      diagnostics.push(this.selectedDiagnostic(provider, "store_lookup", elapsedMs));
      return {
        outcome: "selected",
        store: called.value,
        diagnostics,
        notificationEligible: false,
        upstreamEvidence: "not_independent",
      };
    }
    return {
      outcome: "unavailable",
      store: null,
      diagnostics,
      notificationEligible: false,
      upstreamEvidence: "not_independent",
    };
  }

  private async callProvider<T>(
    run: (context: ProviderCallContext) => Promise<ProviderOutcome<T>>,
  ): Promise<ProviderOutcome<T>> {
    const controller = new AbortController();
    try {
      return await withTimeout(
        run({ nowMs: this.config.clock.now(), signal: controller.signal }),
        this.config.timeoutMs,
        this.config.clock,
        controller,
      );
    } catch (error) {
      if (error instanceof DeadlineExceeded) {
        return {
          ok: false,
          error: { errorClass: "timeout", reason: "deadline_exceeded", retryable: false },
        };
      }
      return {
        ok: false,
        error: { errorClass: "unavailable", reason: "provider_threw", retryable: false },
      };
    }
  }

  private preflight(
    provider: DataProvider,
    retailerId: RetailerId,
    capability: ProviderCapability,
  ): AttemptDiagnostic | null {
    const providerId = provider.identity.providerId;
    const base = {
      providerId,
      retailerId: provider.identity.retailerId,
      upstreamFamily: provider.identity.upstreamFamily,
      capability,
      calls: 0 as const,
      budgetRemaining: this.budgetOf(providerId).remaining,
      elapsedMs: 0,
    };
    if (provider.identity.retailerId !== retailerId) {
      return { ...base, reason: "retailer_mismatch", errorClass: "unsupported_capability" };
    }
    if (!supports(provider.capabilities, capability)) {
      return { ...base, reason: "unsupported_capability", errorClass: "unsupported_capability" };
    }
    const health = this.healthOf(providerId);
    if (health.authBlocked) {
      return { ...base, reason: "authorization_blocked", errorClass: "authorization" };
    }
    if (health.probeInFlight) {
      return { ...base, reason: "probe_in_flight", errorClass: "circuit_open" };
    }
    if (health.circuit === "open") {
      const openedAt = health.openedAtMs ?? this.config.clock.now();
      if (this.config.clock.now() < openedAt + this.config.circuitOpenMs) {
        return { ...base, reason: "circuit_open", errorClass: "circuit_open" };
      }
    }
    if (this.budgetOf(providerId).remaining <= 0) {
      return { ...base, reason: "budget_exhausted", errorClass: "budget_exhausted" };
    }
    if (health.circuit === "open") {
      health.probeInFlight = true;
      health.circuit = "half_open";
    }
    return null;
  }

  private observeFailure(providerId: string, error: ProviderError): void {
    const health = this.healthOf(providerId);
    health.probeInFlight = false;
    if (error.errorClass === "authorization") {
      health.authBlocked = true;
      return;
    }
    if (error.errorClass === "rate_limited") {
      health.circuit = "open";
      health.openedAtMs = this.config.clock.now();
      health.consecutiveTransientFailures += 1;
      return;
    }
    if (!isTransient(error.errorClass)) {
      return;
    }
    health.consecutiveTransientFailures += 1;
    if (
      health.circuit === "half_open" ||
      health.consecutiveTransientFailures >= this.config.circuitFailureThreshold
    ) {
      health.circuit = "open";
      health.openedAtMs = this.config.clock.now();
    }
  }

  private observeSuccess(providerId: string): void {
    const health = this.healthOf(providerId);
    health.circuit = "closed";
    health.consecutiveTransientFailures = 0;
    health.openedAtMs = null;
    health.probeInFlight = false;
  }

  private failureDiagnostic(
    provider: DataProvider,
    capability: ProviderCapability,
    error: ProviderError,
    elapsedMs: number,
    httpStatus?: number,
  ): AttemptDiagnostic {
    return {
      providerId: provider.identity.providerId,
      retailerId: provider.identity.retailerId,
      upstreamFamily: provider.identity.upstreamFamily,
      capability,
      calls: 1,
      reason: error.reason,
      errorClass: error.errorClass,
      budgetRemaining: this.budgetOf(provider.identity.providerId).remaining,
      elapsedMs,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
  }

  private selectedDiagnostic(
    provider: DataProvider,
    capability: ProviderCapability,
    elapsedMs: number,
    httpStatus?: number,
  ): AttemptDiagnostic {
    return {
      providerId: provider.identity.providerId,
      retailerId: provider.identity.retailerId,
      upstreamFamily: provider.identity.upstreamFamily,
      capability,
      calls: 1,
      reason: "selected",
      budgetRemaining: this.budgetOf(provider.identity.providerId).remaining,
      elapsedMs,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    };
  }

  private budgetOf(providerId: string): BudgetState {
    const existing = this.budgets.get(providerId);
    if (existing) {
      return existing;
    }
    const limit = this.config.budgets[providerId] ?? DEFAULT_BUDGET;
    const created = { limit, remaining: limit };
    this.budgets.set(providerId, created);
    return created;
  }

  private consume(providerId: string): void {
    const budget = this.budgetOf(providerId);
    if (budget.remaining > 0) {
      budget.remaining -= 1;
    }
  }

  private healthOf(providerId: string): HealthState {
    const existing = this.healthByProvider.get(providerId);
    if (existing) {
      return existing;
    }
    const created: HealthState = {
      circuit: "closed",
      consecutiveTransientFailures: 0,
      authBlocked: false,
      openedAtMs: null,
      probeInFlight: false,
    };
    this.healthByProvider.set(providerId, created);
    return created;
  }
}
