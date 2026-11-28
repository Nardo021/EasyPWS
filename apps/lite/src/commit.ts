import { COLES_MARRICKVILLE_STORE_ID } from "@easypws/adapters/omkar";
import { telegramAlertsEnabled } from "./alerts.js";
import type { Env } from "./catalogue.js";

export interface CommitInput {
  productId: string;
  storeId: string;
  name: string;
  brand: string | null;
  size: string | null;
  productUrl: string;
  imageUrl: string | null;
  previousPrice: number | null;
  price: number;
  regularPrice: number | null;
  promotionType: string;
  promotionKind: string;
  inStock: boolean;
  availabilityKnown: boolean;
  sourceLabel: string;
  priceNote: string;
  sourceTimestamp: string | null;
  targetPrice: number | null;
  /** Target currently stored. Defaults to targetPrice. A mismatch makes the commit stale. */
  expectedTarget?: number | null;
  /** When true, store targetPrice after the compare-and-set matches. */
  writeTarget?: boolean;
  /** Manual refresh must not consume the daily monitor budget. */
  countAttempt?: boolean;
  live: boolean;
  at: string;
  observationKey: string;
  day: string;
}

function visibleName(name: string): string {
  let cleaned = "";
  for (const char of name) {
    const code = char.charCodeAt(0);
    cleaned += code <= 31 || code === 127 || code === 60 || code === 62 ? " " : char;
  }
  return cleaned;
}

export function notificationName(name: string): string | null {
  const cleaned = visibleName(name).replace(/\s+/g, " ").trim();
  if (cleaned.length < 1 || cleaned.length > 120) {
    return null;
  }
  return cleaned;
}

export function isColesProductUrl(value: string): boolean {
  if (value.length < 1 || value.length > 300) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:"
    && url.hostname === "www.coles.com.au"
    && url.port === ""
    && url.username === ""
    && url.password === ""
    && url.pathname.startsWith("/product/")
    && !url.pathname.includes("..");
}

function flag(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export async function commitWatchedPrice(env: Env, input: CommitInput): Promise<"committed" | "stale"> {
  const previous = input.previousPrice;
  const drop = previous !== null && input.price < previous;
  const crossed = drop
    && input.targetPrice !== null
    && previous !== null
    && previous > input.targetPrice
    && input.price <= input.targetPrice;
  const safeName = notificationName(input.name);
  const notify = input.live
    && drop
    && previous !== null
    && safeName !== null
    && isColesProductUrl(input.productUrl)
    && input.storeId === COLES_MARRICKVILLE_STORE_ID;
  const enabled = notify ? await telegramAlertsEnabled(env) : false;
  const transitionId = input.observationKey;
  const outboxStatus = enabled ? "queued" : "suppressed";
  const expectedTarget = input.expectedTarget === undefined ? input.targetPrice : input.expectedTarget;
  const countAttempt = input.countAttempt !== false;
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE watched_products SET
        name = ?, brand = ?, size = ?, product_url = ?, image_url = ?,
        current_price = ?, regular_price = ?, promotion_type = ?, promotion_kind = ?,
        in_stock = ?, availability_known = ?, source_label = ?, price_note = ?,
        source_timestamp = ?, retrieved_at = ?,
        last_attempt_at = CASE WHEN ? = 1 THEN ? ELSE last_attempt_at END,
        target_price = CASE WHEN ? = 1 THEN ? ELSE target_price END
      WHERE id = ? AND monitoring_status = 'active'
        AND ((? IS NULL AND current_price IS NULL) OR current_price = ?)
        AND ((? IS NULL AND target_price IS NULL) OR target_price = ?)`,
    ).bind(
      input.name,
      input.brand,
      input.size,
      input.productUrl,
      input.imageUrl,
      input.price,
      input.regularPrice,
      input.promotionType,
      input.promotionKind,
      flag(input.inStock),
      flag(input.availabilityKnown),
      input.sourceLabel,
      input.priceNote,
      input.sourceTimestamp,
      input.at,
      flag(countAttempt),
      input.at,
      flag(input.writeTarget === true),
      input.targetPrice,
      input.productId,
      previous,
      previous,
      expectedTarget,
      expectedTarget,
    ),
    env.DB.prepare(
      `INSERT INTO price_observations (
        product_id, observed_at, price, regular_price, promotion_type, observation_key
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE changes() = 1
      AND NOT EXISTS (SELECT 1 FROM price_observations WHERE observation_key = ?)`,
    ).bind(
      input.productId,
      input.at,
      input.price,
      input.regularPrice,
      input.promotionType,
      input.observationKey,
      input.observationKey,
    ),
    env.DB.prepare(
      `INSERT INTO monitor_attempts (day, product_id, outcome, created_at)
       SELECT ?, ?, 'updated', ?
       WHERE ? = 1 AND EXISTS (
         SELECT 1 FROM price_observations WHERE observation_key = ?
       )`,
    ).bind(input.day, input.productId, input.at, flag(countAttempt), input.observationKey),
    env.DB.prepare(
      `INSERT OR IGNORE INTO alert_events (
        id, product_id, kind, previous_price, price, target_price, dedupe_key, created_at
      )
      SELECT ?, ?, 'price_drop', ?, ?, ?, ?, ?
      WHERE ? = 1 AND EXISTS (SELECT 1 FROM price_observations WHERE observation_key = ?)`,
    ).bind(
      crypto.randomUUID(),
      input.productId,
      previous,
      input.price,
      input.targetPrice,
      `v2|${input.observationKey}|price_drop`,
      input.at,
      flag(drop),
      input.observationKey,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO alert_events (
        id, product_id, kind, previous_price, price, target_price, dedupe_key, created_at
      )
      SELECT ?, ?, 'target_crossed', ?, ?, ?, ?, ?
      WHERE ? = 1 AND EXISTS (SELECT 1 FROM price_observations WHERE observation_key = ?)`,
    ).bind(
      crypto.randomUUID(),
      input.productId,
      previous,
      input.price,
      input.targetPrice,
      `v2|${input.observationKey}|target_crossed`,
      input.at,
      flag(crossed),
      input.observationKey,
    ),
    env.DB.prepare(
      `INSERT INTO price_transitions (
        id, observation_key, product_id, store_id, product_name, product_url,
        previous_price, price, target_price, price_drop, target_crossed, observed_at, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
      WHERE ? = 1
        AND EXISTS (SELECT 1 FROM price_observations WHERE observation_key = ?)
        AND NOT EXISTS (SELECT 1 FROM price_transitions WHERE observation_key = ?)`,
    ).bind(
      transitionId,
      input.observationKey,
      input.productId,
      input.storeId,
      safeName ?? input.name,
      input.productUrl,
      previous,
      input.price,
      input.targetPrice,
      flag(crossed),
      input.at,
      input.at,
      flag(notify),
      input.observationKey,
      input.observationKey,
    ),
    env.DB.prepare(
      `INSERT INTO notification_outbox (transition_id, status, created_at, updated_at)
       SELECT ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM price_transitions WHERE id = ?)
         AND NOT EXISTS (SELECT 1 FROM notification_outbox WHERE transition_id = ?)`,
    ).bind(transitionId, outboxStatus, input.at, input.at, transitionId, transitionId),
  ]);
  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    if (countAttempt) {
      await env.DB.batch([
        env.DB.prepare("UPDATE watched_products SET last_attempt_at = ? WHERE id = ?").bind(input.at, input.productId),
        env.DB.prepare(
          "INSERT INTO monitor_attempts (day, product_id, outcome, created_at) VALUES (?, ?, 'preserved', ?)",
        ).bind(input.day, input.productId, input.at),
      ]);
    }
    return "stale";
  }
  return "committed";
}
