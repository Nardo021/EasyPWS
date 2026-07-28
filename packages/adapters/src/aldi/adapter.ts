import type { RetailerId } from "@easypws/contracts";
import { StubRetailerAdapter } from "../base.js";

/** ALDI adapter placeholder — not registered until enabled. */
export class AldiAdapter extends StubRetailerAdapter {
  readonly retailer: RetailerId = "aldi";
}
