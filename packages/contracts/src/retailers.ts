/** Supported retailer identifiers for first- and second-wave adapters. */
export type RetailerId =
  | "coles"
  | "woolworths"
  | "aldi"
  | "chemist_warehouse"
  | "generic";

export interface Retailer {
  id: RetailerId;
  displayName: string;
  baseUrl: string;
  enabled: boolean;
}

export interface Store {
  id: string;
  retailerId: RetailerId;
  externalStoreId: string;
  name: string;
  region?: string;
  timezone?: string;
}
