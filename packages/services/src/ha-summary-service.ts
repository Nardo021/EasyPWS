import { and, eq } from "drizzle-orm";
import { discountPercentage } from "@easypws/core";
import {
  adapterHealth,
  type Database,
  num,
  products,
  retailerListings,
  watchlistItems,
  watchlists,
} from "@easypws/database";

export class HaSummaryService {
  constructor(private readonly db: Database) {}

  async summarize(userId: string) {
    const items = await this.db
      .select({
        item: watchlistItems,
        listing: retailerListings,
        product: products,
      })
      .from(watchlistItems)
      .innerJoin(watchlists, eq(watchlists.id, watchlistItems.watchlistId))
      .innerJoin(retailerListings, eq(retailerListings.id, watchlistItems.listingId))
      .innerJoin(products, eq(products.id, retailerListings.productId))
      .where(and(eq(watchlists.userId, userId), eq(watchlistItems.status, "active")));

    const discounts: number[] = [];
    let activeSpecials = 0;
    let lastSync: Date | null = null;

    const productsOut = items.map((row) => {
      const currentPrice = num(row.listing.currentPrice);
      const regularPrice = num(row.listing.regularPrice);
      const discount = discountPercentage(regularPrice, currentPrice ?? Number.NaN);
      if (discount !== undefined) {
        discounts.push(discount);
      }
      if (row.listing.promotionType !== "none") {
        activeSpecials += 1;
      }
      if (
        row.listing.lastCheckedAt &&
        (!lastSync || row.listing.lastCheckedAt > lastSync)
      ) {
        lastSync = row.listing.lastCheckedAt;
      }
      return {
        watchlistItemId: row.item.id,
        listingId: row.listing.id,
        name: [row.product.brand, row.product.name, row.product.size]
          .filter(Boolean)
          .join(" "),
        retailer: row.listing.retailer,
        currentPrice,
        regularPrice,
        discountPercentage: discount,
        inStock: row.listing.inStock,
        promotionType: row.listing.promotionType,
        halfPrice: row.listing.promotionType === "half_price",
        monitoring: row.item.status === "active",
        productUrl: row.listing.productUrl,
        targetPrice: num(row.item.targetPrice),
        lastCheckedAt: row.listing.lastCheckedAt?.toISOString(),
      };
    });

    const healthRows = await this.db.select().from(adapterHealth);
    const coles = healthRows.find((h) => h.retailer === "coles");
    const adapterHealthy = coles
      ? coles.status === "healthy"
      : healthRows.some((h) => h.status === "healthy");

    return {
      watched_products: productsOut.length,
      active_specials: activeSpecials,
      average_discount:
        discounts.length > 0
          ? Math.round((discounts.reduce((a, b) => a + b, 0) / discounts.length) * 100) /
            100
          : null,
      last_sync: lastSync ? (lastSync as Date).toISOString() : null,
      adapter_healthy: adapterHealthy,
      products: productsOut,
      adapters: healthRows.map((h) => ({
        retailer: h.retailer,
        status: h.status,
        latencyMs: h.latencyMs,
        message: h.message,
        checkedAt: h.checkedAt.toISOString(),
      })),
    };
  }
}
