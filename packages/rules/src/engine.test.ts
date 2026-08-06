import { describe, expect, it } from "vitest";
import type { WatchRule } from "@easypws/contracts";
import { evaluateRules } from "./engine.js";

function rule(partial: Partial<WatchRule> & Pick<WatchRule, "type">): WatchRule {
  return {
    id: partial.id ?? "rule_1",
    watchlistItemId: "witem_1",
    type: partial.type,
    operator: partial.operator ?? "LESS_THAN_OR_EQUAL",
    value: partial.value,
    cooldownHours: partial.cooldownHours ?? 24,
    enabled: partial.enabled ?? true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastTriggeredAt: partial.lastTriggeredAt,
  };
}

describe("evaluateRules", () => {
  it("matches TARGET_PRICE", () => {
    const matches = evaluateRules([rule({ type: "TARGET_PRICE", value: 3.5 })], {
      listingId: "l1",
      watchlistItemId: "witem_1",
      currentPrice: 3.2,
      currentlyInStock: true,
      promotionType: "none",
    });
    expect(matches.map((m) => m.type)).toContain("TARGET_PRICE");
  });

  it("matches HALF_PRICE", () => {
    const matches = evaluateRules([rule({ type: "HALF_PRICE" })], {
      listingId: "l1",
      watchlistItemId: "witem_1",
      currentPrice: 2.5,
      regularPrice: 5,
      currentlyInStock: true,
      promotionType: "half_price",
    });
    expect(matches.map((m) => m.type)).toContain("HALF_PRICE");
  });

  it("matches HISTORICAL_LOW only when beating previous low", () => {
    const matches = evaluateRules([rule({ type: "HISTORICAL_LOW" })], {
      listingId: "l1",
      watchlistItemId: "witem_1",
      currentPrice: 2.0,
      historicalLow: 2.5,
      currentlyInStock: true,
      promotionType: "none",
    });
    expect(matches.map((m) => m.type)).toContain("HISTORICAL_LOW");

    const noMatch = evaluateRules([rule({ type: "HISTORICAL_LOW" })], {
      listingId: "l1",
      watchlistItemId: "witem_1",
      currentPrice: 2.5,
      historicalLow: 2.5,
      currentlyInStock: true,
      promotionType: "none",
    });
    expect(noMatch).toHaveLength(0);
  });

  it("respects cooldown", () => {
    const matches = evaluateRules(
      [
        rule({
          type: "ANY_PRICE_DROP",
          lastTriggeredAt: new Date().toISOString(),
          cooldownHours: 24,
        }),
      ],
      {
        listingId: "l1",
        watchlistItemId: "witem_1",
        previousPrice: 5,
        currentPrice: 4,
        currentlyInStock: true,
        promotionType: "none",
      },
    );
    expect(matches).toHaveLength(0);
  });
});
