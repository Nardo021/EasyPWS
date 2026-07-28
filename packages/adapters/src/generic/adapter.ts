import type { RetailerId } from "@easypws/contracts";
import { StubRetailerAdapter } from "../base.js";

/** Last-resort HTML / headless path — keep unused until specific adapters fail. */
export class GenericScraperAdapter extends StubRetailerAdapter {
  readonly retailer: RetailerId = "generic";
}
