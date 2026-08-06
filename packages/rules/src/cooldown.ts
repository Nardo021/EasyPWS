import type { WatchRule, WatchRuleType } from "@easypws/contracts";

export function isInCooldown(rule: WatchRule, now = new Date()): boolean {
  if (!rule.lastTriggeredAt) {
    return false;
  }
  const last = new Date(rule.lastTriggeredAt).getTime();
  const cooldownMs = rule.cooldownHours * 60 * 60 * 1000;
  return now.getTime() - last < cooldownMs;
}

export function buildDedupeKey(params: {
  watchlistItemId: string;
  ruleType: WatchRuleType;
  priceBucket?: number;
  dayKey?: string;
}): string {
  const day = params.dayKey ?? new Date().toISOString().slice(0, 10);
  const price = params.priceBucket ?? "na";
  return `${params.watchlistItemId}:${params.ruleType}:${price}:${day}`;
}
