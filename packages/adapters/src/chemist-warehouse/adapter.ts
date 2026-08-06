import type { RetailerId } from "@easypws/contracts";
import { StubRetailerAdapter } from "../base.js";

/** Chemist Warehouse adapter placeholder — not registered until enabled. */
export class ChemistWarehouseAdapter extends StubRetailerAdapter {
  readonly retailer: RetailerId = "chemist_warehouse";
}
