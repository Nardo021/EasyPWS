import type { PromotionType, RetailerListing } from "./listings.js";
import type { CanonicalProduct } from "./products.js";
import type { RetailerId } from "./retailers.js";

export type AdapterHealthStatus = "healthy" | "degraded" | "down";

export interface AdapterHealth {
  retailer: RetailerId;
  status: AdapterHealthStatus;
  latencyMs?: number;
  message?: string;
  checkedAt: string;
}

export interface AdapterSearchResult {
  retailerProductId: string;
  name: string;
  brand?: string;
  size?: string;
  productUrl: string;
  imageUrl?: string;
  currentPrice?: number;
  regularPrice?: number;
}

export interface AdapterProductDetails {
  retailerProductId: string;
  productUrl: string;
  name: string;
  brand?: string;
  size?: string;
  barcode?: string;
  category?: string;
  imageUrl?: string;
  currentPrice?: number;
  regularPrice?: number;
  unitPrice?: number;
  unit?: string;
  inStock: boolean;
  promotionType: PromotionType;
  storeId?: string;
}

export interface ParsedProductUrl {
  retailer: RetailerId;
  retailerProductId: string;
  productUrl: string;
  storeId?: string;
}

/**
 * RetailerAdapter — core business code must depend on this interface only,
 * never on Coles/Woolworths client internals.
 */
export interface RetailerAdapter {
  readonly retailer: RetailerId;
  searchProducts(query: string): Promise<AdapterSearchResult[]>;
  getProduct(retailerProductId: string): Promise<AdapterProductDetails>;
  parseProductUrl(url: string): Promise<ParsedProductUrl | null>;
  getCurrentPrice(retailerProductId: string): Promise<{
    price: number;
    regularPrice?: number;
    unitPrice?: number;
    unit?: string;
  }>;
  getPromotion(retailerProductId: string): Promise<{
    promotionType: PromotionType;
    label?: string;
    discountPercentage?: number;
  }>;
  getAvailability(retailerProductId: string): Promise<{ inStock: boolean }>;
  healthCheck(): Promise<AdapterHealth>;
}

export interface ProductMatchResult {
  product: CanonicalProduct;
  listing: RetailerListing;
  created: boolean;
}
