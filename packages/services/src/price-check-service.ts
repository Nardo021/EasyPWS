import { and, asc, eq, sql } from "drizzle-orm";
import { createAdapterRegistry } from "@easypws/adapters";
import type {
  NotificationEventKind,
  NotificationEventPayload,
  WatchRule,
} from "@easypws/contracts";
import { createId, discountPercentage } from "@easypws/core";
import {
  adapterHealth,
  type Database,
  notificationChannels,
  notificationEvents,
  num,
  priceObservations,
  products,
  retailerListings,
  watchlistItems,
  watchlists,
  watchRules,
} from "@easypws/database";
import {
  createNotificationDispatcher,
  HomeAssistantWebhookTransport,
} from "@easypws/notifications";
import { evaluateRules } from "@easypws/rules";
import { createLogger } from "@easypws/observability";

const log = createLogger("price-check");

function nextCheckAt(promotionType: string, failed = false): Date {
  const now = Date.now();
  if (failed) {
    return new Date(now + 2 * 60 * 60 * 1000);
  }
  if (promotionType !== "none") {
    return new Date(now + 3 * 60 * 60 * 1000);
  }
  return new Date(now + 8 * 60 * 60 * 1000);
}

function ruleKind(type: WatchRule["type"]): NotificationEventKind {
  switch (type) {
    case "TARGET_PRICE":
      return "target_price_reached";
    case "ANY_PRICE_DROP":
      return "price_drop";
    case "HALF_PRICE":
      return "half_price";
    case "DISCOUNT_PERCENTAGE":
      return "discount_percentage";
    case "HISTORICAL_LOW":
      return "historical_low";
    case "BACK_IN_STOCK":
      return "back_in_stock";
    case "OUT_OF_STOCK":
      return "out_of_stock";
    case "PROMOTION_STARTED":
      return "promotion_started";
    case "PROMOTION_ENDED":
      return "promotion_ended";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export class PriceCheckService {
  private readonly adapters = createAdapterRegistry();
  private readonly dispatcher = createNotificationDispatcher([
    new HomeAssistantWebhookTransport(),
  ]);

  constructor(private readonly db: Database) {}

  async checkListing(listingId: string): Promise<void> {
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
      throw new Error(`Listing not found: ${listingId}`);
    }

    const previousObs = await this.db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.listingId, listingId))
      .orderBy(sql`${priceObservations.observedAt} desc`)
      .limit(1);
    const prev = previousObs[0];

    const adapter = this.adapters.get(row.listing.retailer as import("@easypws/contracts").RetailerId);
    let details;
    const started = Date.now();
    try {
      details = await adapter.getProduct(row.listing.retailerProductId);
      // Record health from the real fetch — avoid a second Coles round-trip.
      await this.db
        .insert(adapterHealth)
        .values({
          retailer: row.listing.retailer,
          status: "healthy",
          latencyMs: Date.now() - started,
          message: null,
          checkedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: adapterHealth.retailer,
          set: {
            status: "healthy",
            latencyMs: Date.now() - started,
            message: null,
            checkedAt: new Date(),
          },
        });
    } catch (err) {
      await this.db
        .insert(adapterHealth)
        .values({
          retailer: row.listing.retailer,
          status: "down",
          latencyMs: Date.now() - started,
          message: err instanceof Error ? err.message : String(err),
          checkedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: adapterHealth.retailer,
          set: {
            status: "down",
            latencyMs: Date.now() - started,
            message: err instanceof Error ? err.message : String(err),
            checkedAt: new Date(),
          },
        });
      await this.db
        .update(retailerListings)
        .set({
          checkTier: "adapter_backoff",
          nextCheckAt: nextCheckAt("none", true),
          updatedAt: new Date(),
        })
        .where(eq(retailerListings.id, listingId));
      throw err;
    }

    if (details.currentPrice === undefined) {
      throw new Error("Adapter returned no price");
    }

    const prevPrice = num(prev?.price);
    const priceChanged =
      prevPrice === undefined ||
      prevPrice !== details.currentPrice ||
      Boolean(prev?.inStock) !== details.inStock ||
      (prev?.promotionType ?? "none") !== details.promotionType;

    const priorHist = await this.db
      .select({ price: priceObservations.price })
      .from(priceObservations)
      .where(eq(priceObservations.listingId, listingId));
    const priorPrices = priorHist
      .map((h) => num(h.price))
      .filter((n): n is number => n !== undefined);
    const previousHistoricalLow = priorPrices.length
      ? Math.min(...priorPrices)
      : undefined;

    if (priceChanged) {
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

    await this.db
      .update(retailerListings)
      .set({
        currentPrice: details.currentPrice.toFixed(2),
        regularPrice: details.regularPrice?.toFixed(2),
        unitPrice: details.unitPrice?.toFixed(4),
        unit: details.unit,
        inStock: details.inStock,
        promotionType: details.promotionType,
        lastCheckedAt: new Date(),
        checkTier: details.promotionType !== "none" ? "on_promotion" : "normal",
        nextCheckAt: nextCheckAt(details.promotionType),
        updatedAt: new Date(),
      })
      .where(eq(retailerListings.id, listingId));

    if (!priceChanged) {
      log.info("No price change", { listingId });
      return;
    }

    // New historical low only when beating the previous minimum.
    const historicalLow = previousHistoricalLow;

    const items = await this.db
      .select({
        item: watchlistItems,
        userId: watchlists.userId,
      })
      .from(watchlistItems)
      .innerJoin(watchlists, eq(watchlists.id, watchlistItems.watchlistId))
      .where(
        and(eq(watchlistItems.listingId, listingId), eq(watchlistItems.status, "active")),
      );

    for (const { item, userId } of items) {
      const rulesRows = await this.db
        .select()
        .from(watchRules)
        .where(eq(watchRules.watchlistItemId, item.id));

      const rules: WatchRule[] = rulesRows.map((r) => ({
        id: r.id,
        watchlistItemId: r.watchlistItemId,
        type: r.type as WatchRule["type"],
        operator: r.operator as WatchRule["operator"],
        value: num(r.value),
        cooldownHours: r.cooldownHours,
        enabled: r.enabled,
        lastTriggeredAt: r.lastTriggeredAt?.toISOString(),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));

      const matches = evaluateRules(rules, {
        listingId,
        watchlistItemId: item.id,
        previousPrice: prevPrice,
        currentPrice: details.currentPrice,
        regularPrice: details.regularPrice,
        discountPercentage: discountPercentage(
          details.regularPrice,
          details.currentPrice,
        ),
        historicalLow,
        previouslyInStock: prev?.inStock,
        currentlyInStock: details.inStock,
        promotionType: details.promotionType,
        previousPromotionType: prev?.promotionType,
      });

      const productLabel = [row.product.brand, row.product.name, row.product.size]
        .filter(Boolean)
        .join(" ");

      for (const match of matches) {
        const kind = ruleKind(match.type);
        const payload: NotificationEventPayload = {
          event: kind,
          product: productLabel,
          retailer: row.listing.retailer,
          oldPrice: prevPrice,
          newPrice: details.currentPrice,
          discountPercentage: discountPercentage(
            details.regularPrice,
            details.currentPrice,
          ),
          historicalLow,
          productUrl: row.listing.productUrl,
          listingId,
          observedAt: new Date().toISOString(),
        };

        const eventId = createId("nevt");
        try {
          await this.db.insert(notificationEvents).values({
            id: eventId,
            userId,
            watchRuleId: match.ruleId,
            listingId,
            kind,
            payload,
            dedupeKey: match.dedupeKey,
            status: "pending",
          });
        } catch {
          log.info("Suppressed duplicate notification", { dedupeKey: match.dedupeKey });
          continue;
        }

        await this.db
          .update(watchRules)
          .set({ lastTriggeredAt: new Date(), updatedAt: new Date() })
          .where(eq(watchRules.id, match.ruleId));

        const channels = await this.db
          .select()
          .from(notificationChannels)
          .where(
            and(
              eq(notificationChannels.userId, userId),
              eq(notificationChannels.enabled, true),
            ),
          );

        for (const channel of channels) {
          try {
            if (channel.type === "ha_webhook" || channel.type === "generic_webhook") {
              await this.dispatcher.dispatch(
                channel.type,
                payload,
                channel.config as Record<string, unknown>,
              );
            }
            await this.db
              .update(notificationEvents)
              .set({
                channelId: channel.id,
                status: "sent",
                deliveredAt: new Date(),
              })
              .where(eq(notificationEvents.id, eventId));
          } catch (err) {
            await this.db
              .update(notificationEvents)
              .set({
                channelId: channel.id,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              })
              .where(eq(notificationEvents.id, eventId));
          }
        }
      }
    }
  }

  async listDueListings(limit = 50): Promise<string[]> {
    const now = new Date();
    const rows = await this.db
      .select({ id: retailerListings.id })
      .from(retailerListings)
      .innerJoin(watchlistItems, eq(watchlistItems.listingId, retailerListings.id))
      .where(
        and(
          eq(watchlistItems.status, "active"),
          sql`(${retailerListings.nextCheckAt} is null or ${retailerListings.nextCheckAt} <= ${now})`,
        ),
      )
      .orderBy(asc(retailerListings.nextCheckAt))
      .limit(limit);
    return [...new Set(rows.map((r) => r.id))];
  }
}
