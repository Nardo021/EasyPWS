import type {
  RuleEvaluationContext,
  RuleMatch,
  WatchRule,
  WatchRuleType,
} from "@easypws/contracts";
import { assertNever, isHalfPrice } from "@easypws/core";
import { buildDedupeKey, isInCooldown } from "./cooldown.js";

/**
 * Scaffold rule engine — evaluates enabled rules against a price transition.
 * Full promotion / historical-low queries will be wired when DB layer lands.
 */
export function evaluateRules(
  rules: WatchRule[],
  ctx: RuleEvaluationContext,
): RuleMatch[] {
  const matches: RuleMatch[] = [];

  for (const rule of rules) {
    if (!rule.enabled || isInCooldown(rule)) {
      continue;
    }
    if (!matchesRule(rule, ctx)) {
      continue;
    }
    matches.push({
      ruleId: rule.id,
      type: rule.type,
      dedupeKey: buildDedupeKey({
        watchlistItemId: ctx.watchlistItemId,
        ruleType: rule.type,
        priceBucket: Math.round(ctx.currentPrice * 100),
      }),
      message: describeMatch(rule.type, ctx),
    });
  }

  return matches;
}

function matchesRule(rule: WatchRule, ctx: RuleEvaluationContext): boolean {
  switch (rule.type) {
    case "TARGET_PRICE":
      return rule.value !== undefined && ctx.currentPrice <= rule.value;
    case "ANY_PRICE_DROP":
      return (
        ctx.previousPrice !== undefined && ctx.currentPrice < ctx.previousPrice
      );
    case "HALF_PRICE":
      return isHalfPrice(ctx.regularPrice, ctx.currentPrice);
    case "DISCOUNT_PERCENTAGE":
      return (
        rule.value !== undefined &&
        ctx.discountPercentage !== undefined &&
        ctx.discountPercentage >= rule.value
      );
    case "HISTORICAL_LOW":
      return (
        ctx.historicalLow !== undefined &&
        ctx.currentPrice < ctx.historicalLow
      );
    case "BACK_IN_STOCK":
      return ctx.previouslyInStock === false && ctx.currentlyInStock;
    case "OUT_OF_STOCK":
      return ctx.previouslyInStock === true && !ctx.currentlyInStock;
    case "PROMOTION_STARTED":
      return (
        ctx.previousPromotionType === "none" &&
        ctx.promotionType !== "none"
      );
    case "PROMOTION_ENDED":
      return (
        ctx.previousPromotionType !== undefined &&
        ctx.previousPromotionType !== "none" &&
        ctx.promotionType === "none"
      );
    default:
      return assertNever(rule.type);
  }
}

function describeMatch(type: WatchRuleType, ctx: RuleEvaluationContext): string {
  switch (type) {
    case "TARGET_PRICE":
      return `Target price reached at ${ctx.currentPrice}`;
    case "ANY_PRICE_DROP":
      return `Price dropped from ${ctx.previousPrice} to ${ctx.currentPrice}`;
    case "HALF_PRICE":
      return `Half-price detected at ${ctx.currentPrice}`;
    case "DISCOUNT_PERCENTAGE":
      return `Discount ${ctx.discountPercentage}%`;
    case "HISTORICAL_LOW":
      return `Historical low at ${ctx.currentPrice}`;
    case "BACK_IN_STOCK":
      return "Back in stock";
    case "OUT_OF_STOCK":
      return "Out of stock";
    case "PROMOTION_STARTED":
      return "Promotion started";
    case "PROMOTION_ENDED":
      return "Promotion ended";
    default:
      return assertNever(type);
  }
}
