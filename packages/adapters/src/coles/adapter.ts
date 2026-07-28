import type { ParsedProductUrl, RetailerId } from "@easypws/contracts";
import { StubRetailerAdapter } from "../base.js";

/**
 * Coles adapter scaffold.
 * Implementation plan: api-client → parser → normalizer → this adapter.
 */
export class ColesAdapter extends StubRetailerAdapter {
  readonly retailer: RetailerId = "coles";

  override async parseProductUrl(url: string): Promise<ParsedProductUrl | null> {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith("coles.com.au")) {
        return null;
      }
      // Placeholder: extract numeric product id from path when real parser lands.
      const match = parsed.pathname.match(/\/(\d{5,})(?:\/|$)/);
      if (!match?.[1]) {
        return null;
      }
      return {
        retailer: "coles",
        retailerProductId: match[1],
        productUrl: parsed.toString(),
      };
    } catch {
      return null;
    }
  }
}
