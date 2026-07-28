import { and, eq } from "drizzle-orm";
import type {
  AdapterProductDetails,
  ParsedProductUrl,
  RetailerId,
} from "@easypws/contracts";
import { createAdapterRegistry } from "@easypws/adapters";
import { createId, discountPercentage } from "@easypws/core";
import {
  type Database,
  num,
  priceObservations,
  products,
  retailerListings,
  stores,
} from "@easypws/database";
import { enqueuePriceCheck } from "./queue.js";

export class ProductService {
  private readonly adapters = createAdapterRegistry();

  constructor(private readonly db: Database) {}

  async importByUrl(params: {
    url: string;
    watchlistId?: string;
    targetPrice?: number;
    userId: string;
  }): Promise<{
    productId: string;
    listingId: string;
    details: AdapterProductDetails;
    created: boolean;
  }> {
    let parsed: ParsedProductUrl | null = null;
    for (const adapter of this.adapters.list()) {
      parsed = await adapter.parseProductUrl(params.url);
      if (parsed) {
        break;
      }
    }
    if (!parsed) {
      throw new Error("Unsupported product URL — currently Coles product URLs are supported");
    }

    const adapter = this.adapters.get(parsed.retailer);
    const details = await adapter.getProduct(parsed.retailerProductId);
    const storeRowId = await this.resolveStoreId(parsed.retailer, details.storeId);

    const existingListing = await this.db
      .select()
      .from(retailerListings)
      .where(
        and(
          eq(retailerListings.retailer, parsed.retailer),
          eq(retailerListings.retailerProductId, details.retailerProductId),
          eq(retailerListings.storeId, storeRowId),
        ),
      )
      .limit(1);

    let productId: string;
    let listingId: string;
    let created = false;

    if (existingListing[0]) {
      productId = existingListing[0].productId;
      listingId = existingListing[0].id;
      await this.db
        .update(retailerListings)
        .set({
          productUrl: details.productUrl,
          currentPrice: details.currentPrice?.toFixed(2),
          regularPrice: details.regularPrice?.toFixed(2),
          unitPrice: details.unitPrice?.toFixed(4),
          unit: details.unit,
          inStock: details.inStock,
          promotionType: details.promotionType,
          lastCheckedAt: new Date(),
          nextCheckAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(retailerListings.id, listingId));
    } else {
      created = true;
      productId = createId("prod");
      listingId = createId("listing");
      await this.db.insert(products).values({
        id: productId,
        barcode: details.barcode,
        brand: details.brand,
        name: details.name,
        size: details.size,
        category: details.category,
        imageUrl: details.imageUrl,
      });
      await this.db.insert(retailerListings).values({
        id: listingId,
        productId,
        retailer: parsed.retailer,
        retailerProductId: details.retailerProductId,
        productUrl: details.productUrl,
        storeId: storeRowId,
        currentPrice: details.currentPrice?.toFixed(2),
        regularPrice: details.regularPrice?.toFixed(2),
        unitPrice: details.unitPrice?.toFixed(4),
        unit: details.unit,
        inStock: details.inStock,
        promotionType: details.promotionType,
        lastCheckedAt: new Date(),
        checkTier: details.promotionType !== "none" ? "on_promotion" : "normal",
        nextCheckAt: new Date(),
      });
    }

    if (details.currentPrice !== undefined) {
      await this.db.insert(priceObservations).values({
        id: createId("pobs"),
        listingId,
        price: details.currentPrice.toFixed(2),
        regularPrice: details.regularPrice?.toFixed(2),
        unitPrice: details.unitPrice?.toFixed(4),
        promotionType: details.promotionType,
        inStock: details.inStock,
        source: "adapter_api",
      });
    }

    await enqueuePriceCheck(listingId, { priority: 1 });

    return { productId, listingId, details, created };
  }

  async search(query: string, retailer: RetailerId = "coles") {
    const adapter = this.adapters.get(retailer);
    return adapter.searchProducts(query);
  }

  async getListingSummary(listingId: string) {
    const rows = await this.db
      .select({
        listing: retailerListings,
        product: products,
      })
      .from(retailerListings)
      .innerJoin(products, eq(products.id, retailerListings.productId))
      .where(eq(retailerListings.id, listingId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const currentPrice = num(row.listing.currentPrice);
    const regularPrice = num(row.listing.regularPrice);
    const hist = await this.db
      .select({ price: priceObservations.price })
      .from(priceObservations)
      .where(eq(priceObservations.listingId, listingId));
    const prices = hist
      .map((h) => num(h.price))
      .filter((n): n is number => n !== undefined);
    const historicalLow = prices.length ? Math.min(...prices) : undefined;

    return {
      listingId: row.listing.id,
      productId: row.product.id,
      productName: [row.product.brand, row.product.name, row.product.size]
        .filter(Boolean)
        .join(" "),
      brand: row.product.brand,
      size: row.product.size,
      imageUrl: row.product.imageUrl,
      retailer: row.listing.retailer,
      productUrl: row.listing.productUrl,
      currentPrice,
      regularPrice,
      discountPercentage: discountPercentage(regularPrice, currentPrice ?? Number.NaN),
      historicalLow,
      inStock: row.listing.inStock,
      promotionType: row.listing.promotionType,
      lastCheckedAt: row.listing.lastCheckedAt?.toISOString(),
    };
  }

  private async resolveStoreId(
    retailer: RetailerId,
    externalStoreId: string | undefined,
  ): Promise<string> {
    const external =
      externalStoreId ??
      (retailer === "coles" ? process.env["COLES_STORE_ID"] ?? "647" : "default");
    const id = `store_${retailer}_${external}`;
    const existing = await this.db.select().from(stores).where(eq(stores.id, id)).limit(1);
    if (!existing[0]) {
      await this.db.insert(stores).values({
        id,
        retailerId: retailer,
        externalStoreId: external,
        name: `${retailer} ${external}`,
      });
    }
    return id;
  }
}
