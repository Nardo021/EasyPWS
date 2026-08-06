import type { RetailerAdapter, RetailerId } from "@easypws/contracts";
import { assertNever } from "@easypws/core";
import { ColesAdapter } from "./coles/adapter.js";
import { WoolworthsAdapter } from "./woolworths/adapter.js";
import { GenericScraperAdapter } from "./generic/adapter.js";

export interface AdapterRegistry {
  get(retailer: RetailerId): RetailerAdapter;
  list(): RetailerAdapter[];
}

export function createAdapterRegistry(): AdapterRegistry {
  const adapters: RetailerAdapter[] = [
    new ColesAdapter(),
    new WoolworthsAdapter(),
    new GenericScraperAdapter(),
  ];
  const byId = new Map(adapters.map((a) => [a.retailer, a]));

  return {
    get(retailer: RetailerId): RetailerAdapter {
      const adapter = byId.get(retailer);
      if (!adapter) {
        // Exhaustive check for known retailers without a registered adapter yet.
        switch (retailer) {
          case "aldi":
          case "chemist_warehouse":
            throw new Error(`Adapter not implemented: ${retailer}`);
          case "coles":
          case "woolworths":
          case "generic":
            throw new Error(`Adapter missing from registry: ${retailer}`);
          default:
            return assertNever(retailer);
        }
      }
      return adapter;
    },
    list: () => [...adapters],
  };
}
