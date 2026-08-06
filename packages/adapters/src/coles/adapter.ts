import type {
  AdapterHealth,
  AdapterProductDetails,
  AdapterSearchResult,
  ParsedProductUrl,
  PromotionType,
  RetailerId,
} from "@easypws/contracts";
import { StubRetailerAdapter } from "../base.js";
import { ColesApiClient } from "./api-client.js";
import { normalizeColesProduct, normalizeColesSearchResult } from "./normalizer.js";
import { parseColesProductPayload, parseColesSearchPayload } from "./parser.js";

export class ColesAdapter extends StubRetailerAdapter {
  readonly retailer: RetailerId = "coles";
  private readonly client: ColesApiClient;

  constructor(client?: ColesApiClient) {
    super();
    this.client = client ?? new ColesApiClient();
  }

  override async parseProductUrl(url: string): Promise<ParsedProductUrl | null> {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith("coles.com.au")) {
        return null;
      }
      // URLs look like /product/{slug}-{productId}
      const match =
        parsed.pathname.match(/-(\d{5,})(?:\/|$)/) ??
        parsed.pathname.match(/\/(\d{5,})(?:\/|$)/);
      if (!match?.[1]) {
        return null;
      }
      return {
        retailer: "coles",
        retailerProductId: match[1],
        productUrl: parsed.toString(),
        storeId: this.client.defaultStoreId,
      };
    } catch {
      return null;
    }
  }

  override async getProduct(retailerProductId: string): Promise<AdapterProductDetails> {
    const payload = await this.client.fetchProductJson(retailerProductId);
    const raw = parseColesProductPayload(payload);
    return normalizeColesProduct(raw, this.client.defaultStoreId);
  }

  override async searchProducts(query: string): Promise<AdapterSearchResult[]> {
    const payload = await this.client.searchJson(query);
    const items = parseColesSearchPayload(payload).map(normalizeColesSearchResult);
    if (items.length === 0) {
      throw new Error(
        "Coles search returned no products (endpoint may be blocked or shape changed). Paste a product URL instead.",
      );
    }
    return items;
  }

  override async getCurrentPrice(retailerProductId: string): Promise<{
    price: number;
    regularPrice?: number;
    unitPrice?: number;
    unit?: string;
  }> {
    const product = await this.getProduct(retailerProductId);
    if (product.currentPrice === undefined) {
      throw new Error(`Coles product ${retailerProductId} has no price`);
    }
    return {
      price: product.currentPrice,
      regularPrice: product.regularPrice,
      unitPrice: product.unitPrice,
      unit: product.unit,
    };
  }

  override async getPromotion(retailerProductId: string): Promise<{
    promotionType: PromotionType;
    label?: string;
    discountPercentage?: number;
  }> {
    const product = await this.getProduct(retailerProductId);
    let discountPercentage: number | undefined;
    if (
      product.regularPrice &&
      product.currentPrice !== undefined &&
      product.regularPrice > 0
    ) {
      discountPercentage =
        Math.round(
          ((product.regularPrice - product.currentPrice) / product.regularPrice) * 10000,
        ) / 100;
    }
    return {
      promotionType: product.promotionType,
      discountPercentage,
    };
  }

  override async getAvailability(
    retailerProductId: string,
  ): Promise<{ inStock: boolean }> {
    const product = await this.getProduct(retailerProductId);
    return { inStock: product.inStock };
  }

  override async healthCheck(): Promise<AdapterHealth> {
    try {
      const { latencyMs } = await this.client.ping();
      return {
        retailer: "coles",
        status: latencyMs > 5000 ? "degraded" : "healthy",
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        retailer: "coles",
        status: "down",
        message: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
