import type {
  AdapterHealth,
  AdapterProductDetails,
  AdapterSearchResult,
  ParsedProductUrl,
  PromotionType,
  RetailerAdapter,
  RetailerId,
} from "@easypws/contracts";

/**
 * Stub base — concrete adapters override methods as data sources are wired.
 * Prefer retailer JSON/API → third-party API → HTML → headless browser.
 */
export abstract class StubRetailerAdapter implements RetailerAdapter {
  abstract readonly retailer: RetailerId;

  async searchProducts(_query: string): Promise<AdapterSearchResult[]> {
    throw new Error(`${this.retailer}: searchProducts not implemented`);
  }

  async getProduct(_retailerProductId: string): Promise<AdapterProductDetails> {
    throw new Error(`${this.retailer}: getProduct not implemented`);
  }

  async parseProductUrl(_url: string): Promise<ParsedProductUrl | null> {
    return null;
  }

  async getCurrentPrice(_retailerProductId: string): Promise<{
    price: number;
    regularPrice?: number;
    unitPrice?: number;
    unit?: string;
  }> {
    throw new Error(`${this.retailer}: getCurrentPrice not implemented`);
  }

  async getPromotion(_retailerProductId: string): Promise<{
    promotionType: PromotionType;
    label?: string;
    discountPercentage?: number;
  }> {
    throw new Error(`${this.retailer}: getPromotion not implemented`);
  }

  async getAvailability(_retailerProductId: string): Promise<{ inStock: boolean }> {
    throw new Error(`${this.retailer}: getAvailability not implemented`);
  }

  async healthCheck(): Promise<AdapterHealth> {
    return {
      retailer: this.retailer,
      status: "down",
      message: "Adapter stub — not wired",
      checkedAt: new Date().toISOString(),
    };
  }
}
