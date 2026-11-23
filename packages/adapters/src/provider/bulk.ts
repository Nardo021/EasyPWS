import type { RawProviderProduct, RetailerId, UpstreamFamily } from "@easypws/contracts";
import { normalizeProductQuote, type NormalizedProviderQuote } from "./normalize.js";

export interface BulkIntegrity {
  status: "complete" | "incomplete" | "not_applicable";
  requestedStoreId: string;
  missingIds: readonly string[];
  duplicateIds: readonly string[];
  unexpectedIds: readonly string[];
  storeMismatchIds: readonly string[];
  invalidIds: readonly string[];
}

export interface BulkEvaluation {
  complete: boolean;
  quotes: NormalizedProviderQuote[];
  integrity: BulkIntegrity;
}

function counts(ids: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const id of ids) {
    result.set(id, (result.get(id) ?? 0) + 1);
  }
  return result;
}

function sorted(ids: Iterable<string>): string[] {
  return [...ids].sort();
}

export function emptyBulkIntegrity(requestedStoreId: string): BulkIntegrity {
  return {
    status: "not_applicable",
    requestedStoreId,
    missingIds: [],
    duplicateIds: [],
    unexpectedIds: [],
    storeMismatchIds: [],
    invalidIds: [],
  };
}

/**
 * A bulk response is complete only when the returned ids are exactly the
 * requested ids, each once, at the requested store, and each row normalizes.
 */
export function evaluateBulkResponse(input: {
  retailerId: RetailerId;
  providerId: string;
  upstreamFamily: UpstreamFamily;
  requestedStoreId: string;
  requestedProductIds: readonly string[];
  products: readonly RawProviderProduct[];
  retrievedAt: string;
  assessedAt: string;
}): BulkEvaluation {
  const requested = counts(input.requestedProductIds);
  const returned = counts(input.products.map((product) => product.retailerProductId));
  const duplicateIds = sorted(
    [...new Set([...requested.keys(), ...returned.keys()])].filter(
      (id) => (requested.get(id) ?? 0) > 1 || (returned.get(id) ?? 0) > 1,
    ),
  );
  const missingIds = sorted([...requested.keys()].filter((id) => (returned.get(id) ?? 0) === 0));
  const unexpectedIds = sorted([...returned.keys()].filter((id) => !requested.has(id)));
  const storeMismatchIds: string[] = [];
  const invalidIds: string[] = [];
  const quotes: NormalizedProviderQuote[] = [];

  for (const id of [...requested.keys()].sort()) {
    if ((requested.get(id) ?? 0) !== 1 || (returned.get(id) ?? 0) !== 1) {
      continue;
    }
    const product = input.products.find((item) => item.retailerProductId === id);
    if (!product) {
      continue;
    }
    if (product.echoedStoreId !== null && product.echoedStoreId !== input.requestedStoreId) {
      storeMismatchIds.push(id);
      continue;
    }
    const normalized = normalizeProductQuote({
      retailerId: input.retailerId,
      providerId: input.providerId,
      upstreamFamily: input.upstreamFamily,
      requestedStoreId: input.requestedStoreId,
      requestedProductId: id,
      retrievedAt: input.retrievedAt,
      assessedAt: input.assessedAt,
      product,
    });
    if (!normalized.ok) {
      invalidIds.push(id);
      continue;
    }
    quotes.push(normalized.quote);
  }

  const complete =
    requested.size > 0 &&
    duplicateIds.length === 0 &&
    missingIds.length === 0 &&
    unexpectedIds.length === 0 &&
    storeMismatchIds.length === 0 &&
    invalidIds.length === 0 &&
    quotes.length === requested.size;

  return {
    complete,
    quotes,
    integrity: {
      status: complete ? "complete" : "incomplete",
      requestedStoreId: input.requestedStoreId,
      missingIds,
      duplicateIds,
      unexpectedIds,
      storeMismatchIds,
      invalidIds,
    },
  };
}
