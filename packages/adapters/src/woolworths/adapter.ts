import type { ParsedProductUrl, RetailerId } from "@easypws/contracts";
import { StubRetailerAdapter } from "../base.js";

/**
 * Woolworths adapter scaffold — second adapter to prove platform abstraction.
 */
export class WoolworthsAdapter extends StubRetailerAdapter {
  readonly retailer: RetailerId = "woolworths";

  override async parseProductUrl(url: string): Promise<ParsedProductUrl | null> {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith("woolworths.com.au")) {
        return null;
      }
      const match = parsed.pathname.match(/\/(\d{5,})(?:\/|$)/);
      if (!match?.[1]) {
        return null;
      }
      return {
        retailer: "woolworths",
        retailerProductId: match[1],
        productUrl: parsed.toString(),
      };
    } catch {
      return null;
    }
  }
}
