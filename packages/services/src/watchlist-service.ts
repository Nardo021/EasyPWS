import { and, desc, eq } from "drizzle-orm";
import type { RuleOperator, WatchRuleType } from "@easypws/contracts";
import { createId, discountPercentage } from "@easypws/core";
import {
  type Database,
  num,
  priceObservations,
  products,
  retailerListings,
  watchlistItems,
  watchlists,
  watchRules,
} from "@easypws/database";

export class WatchlistService {
  constructor(private readonly db: Database) {}

  async getOrCreateDefault(userId: string) {
    const existing = await this.db
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .limit(1);
    if (existing[0]) {
      return existing[0];
    }
    const id = createId("wlist");
    await this.db.insert(watchlists).values({ id, userId, name: "Default" });
    const created = await this.db.select().from(watchlists).where(eq(watchlists.id, id));
    return created[0]!;
  }

  async listItems(userId: string) {
    const list = await this.getOrCreateDefault(userId);
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
      .where(and(eq(watchlists.userId, userId), eq(watchlistItems.watchlistId, list.id)));

    const result = [];
    for (const row of items) {
      if (row.item.status === "removed") {
        continue;
      }
      const currentPrice = num(row.listing.currentPrice);
      const regularPrice = num(row.listing.regularPrice);
      const hist = await this.db
        .select({ price: priceObservations.price })
        .from(priceObservations)
        .where(eq(priceObservations.listingId, row.listing.id));
      const prices = hist
        .map((h) => num(h.price))
        .filter((n): n is number => n !== undefined);
      const historicalLow = prices.length ? Math.min(...prices) : undefined;

      result.push({
        watchlistItemId: row.item.id,
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
        monitoringStatus: row.item.status,
        targetPrice: num(row.item.targetPrice),
        lastCheckedAt: row.listing.lastCheckedAt?.toISOString(),
      });
    }
    return result;
  }

  async addListing(params: {
    userId: string;
    listingId: string;
    targetPrice?: number;
    watchlistId?: string;
  }) {
    const list = params.watchlistId
      ? (
          await this.db
            .select()
            .from(watchlists)
            .where(
              and(
                eq(watchlists.id, params.watchlistId),
                eq(watchlists.userId, params.userId),
              ),
            )
            .limit(1)
        )[0]
      : await this.getOrCreateDefault(params.userId);
    if (!list) {
      throw new Error("Watchlist not found");
    }

    const existing = await this.db
      .select()
      .from(watchlistItems)
      .where(
        and(
          eq(watchlistItems.watchlistId, list.id),
          eq(watchlistItems.listingId, params.listingId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(watchlistItems)
        .set({
          status: "active",
          targetPrice: params.targetPrice?.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(watchlistItems.id, existing[0].id));
      if (params.targetPrice !== undefined) {
        await this.ensureTargetRule(existing[0].id, params.targetPrice);
      }
      return existing[0].id;
    }

    const id = createId("witem");
    await this.db.insert(watchlistItems).values({
      id,
      watchlistId: list.id,
      listingId: params.listingId,
      status: "active",
      targetPrice: params.targetPrice?.toFixed(2),
    });

    await this.db.insert(watchRules).values([
      {
        id: createId("rule"),
        watchlistItemId: id,
        type: "ANY_PRICE_DROP",
        operator: "LESS_THAN",
        cooldownHours: 24,
        enabled: true,
      },
      {
        id: createId("rule"),
        watchlistItemId: id,
        type: "HALF_PRICE",
        operator: "EQUAL",
        cooldownHours: 24,
        enabled: true,
      },
      {
        id: createId("rule"),
        watchlistItemId: id,
        type: "HISTORICAL_LOW",
        operator: "LESS_THAN_OR_EQUAL",
        cooldownHours: 24,
        enabled: true,
      },
    ]);

    if (params.targetPrice !== undefined) {
      await this.ensureTargetRule(id, params.targetPrice);
    }

    return id;
  }

  async setStatus(userId: string, watchlistItemId: string, status: "active" | "paused") {
    await this.assertOwnedItem(userId, watchlistItemId);
    await this.db
      .update(watchlistItems)
      .set({ status, updatedAt: new Date() })
      .where(eq(watchlistItems.id, watchlistItemId));
  }

  async removeItem(userId: string, watchlistItemId: string) {
    await this.assertOwnedItem(userId, watchlistItemId);
    await this.db
      .update(watchlistItems)
      .set({ status: "removed", updatedAt: new Date() })
      .where(eq(watchlistItems.id, watchlistItemId));
  }

  async setTargetPrice(userId: string, watchlistItemId: string, targetPrice: number) {
    await this.assertOwnedItem(userId, watchlistItemId);
    await this.db
      .update(watchlistItems)
      .set({ targetPrice: targetPrice.toFixed(2), updatedAt: new Date() })
      .where(eq(watchlistItems.id, watchlistItemId));
    await this.ensureTargetRule(watchlistItemId, targetPrice);
  }

  async createRule(params: {
    userId: string;
    watchlistItemId: string;
    type: WatchRuleType;
    operator: RuleOperator;
    value?: number;
    cooldownHours?: number;
    enabled?: boolean;
  }) {
    await this.assertOwnedItem(params.userId, params.watchlistItemId);
    const id = createId("rule");
    await this.db.insert(watchRules).values({
      id,
      watchlistItemId: params.watchlistItemId,
      type: params.type,
      operator: params.operator,
      value: params.value?.toFixed(4),
      cooldownHours: params.cooldownHours ?? 24,
      enabled: params.enabled ?? true,
    });
    return id;
  }

  async priceHistory(listingId: string, limit = 200) {
    const rows = await this.db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.listingId, listingId))
      .orderBy(desc(priceObservations.observedAt))
      .limit(limit);
    return rows
      .map((r) => ({
        observedAt: r.observedAt.toISOString(),
        price: num(r.price) ?? 0,
        regularPrice: num(r.regularPrice),
        promotionType: r.promotionType,
      }))
      .reverse();
  }

  private async ensureTargetRule(watchlistItemId: string, targetPrice: number) {
    const existing = await this.db
      .select()
      .from(watchRules)
      .where(
        and(
          eq(watchRules.watchlistItemId, watchlistItemId),
          eq(watchRules.type, "TARGET_PRICE"),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(watchRules)
        .set({
          value: targetPrice.toFixed(4),
          operator: "LESS_THAN_OR_EQUAL",
          enabled: true,
          updatedAt: new Date(),
        })
        .where(eq(watchRules.id, existing[0].id));
      return;
    }
    await this.db.insert(watchRules).values({
      id: createId("rule"),
      watchlistItemId,
      type: "TARGET_PRICE",
      operator: "LESS_THAN_OR_EQUAL",
      value: targetPrice.toFixed(4),
      cooldownHours: 24,
      enabled: true,
    });
  }

  private async assertOwnedItem(userId: string, watchlistItemId: string) {
    const rows = await this.db
      .select({ id: watchlistItems.id })
      .from(watchlistItems)
      .innerJoin(watchlists, eq(watchlists.id, watchlistItems.watchlistId))
      .where(and(eq(watchlistItems.id, watchlistItemId), eq(watchlists.userId, userId)))
      .limit(1);
    if (!rows[0]) {
      throw new Error("Watchlist item not found");
    }
  }
}
