import type { AdapterProductDetails } from "@easypws/contracts";

/** Map Coles-specific fields onto AdapterProductDetails. */
export function normalizeColesProduct(_raw: unknown): AdapterProductDetails {
  throw new Error("normalizeColesProduct not implemented");
}
