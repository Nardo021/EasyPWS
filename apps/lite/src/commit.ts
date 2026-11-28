import { COLES_MARRICKVILLE_STORE_ID } from "@easypws/adapters/omkar";
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
  /** Revision read with previousPrice. A mismatch makes the commit stale. */
  expectedRevision: number;
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
  const seen = await env.DB.prepare(
    "SELECT 1 AS ok FROM price_observations WHERE observation_key = ?",
  )
    .bind(input.observationKey)
    .first<{ ok: number }>();
  if (seen) {
    return "stale";
  }
  const transitionId = input.observationKey;
  const token = crypto.randomUUID();
  const expectedTarget = input.expectedTarget === undefined ? input.targetPrice : input.expectedTarget;
  const countAttempt = input.countAttempt !== false;
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE watched_products SET
        name = ?, brand = ?, size = ?, product_url = ?, image_url = ?,
        current_price = ?, regular_price = ?, promotion_type = ?, promotion_kind = ?,
        in_stock = ?, availability_known = ?, source_label = ?, price_note = ?,
        source_timestamp = ?, retrieved_at = ?, revision = revision + 1,
        last_attempt_at = CASE WHEN ? = 1 THEN ? ELSE last_attempt_at END,
        target_price = CASE WHEN ? = 1 THEN ? ELSE target_price END
      WHERE id = ? AND monitoring_status = 'active' AND revision = ?
        AND ((? IS NULL AND current_price IS NULL) OR current_price = ?)
        AND ((? IS NULL AND target_price IS NULL) OR target_price = ?)
        AND NOT EXISTS (SELECT 1 FROM price_observations WHERE observation_key = ?)`,
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
      input.expectedRevision,
      previous,
      previous,
      expectedTarget,
      expectedTarget,
      input.observationKey,
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
    env.DB.prepare("INSERT INTO commit_tokens (token) SELECT ? WHERE changes() = 1").bind(token),
    env.DB.prepare(
      `INSERT INTO monitor_attempts (day, product_id, outcome, created_at)
       SELECT ?, ?, 'updated', ?
       WHERE ? = 1 AND EXISTS (SELECT 1 FROM commit_tokens WHERE token = ?)`,
    ).bind(input.day, input.productId, input.at, flag(countAttempt), token),
    env.DB.prepare(
      `INSERT OR IGNORE INTO alert_events (
        id, product_id, kind, previous_price, price, target_price, dedupe_key, created_at
      )
      SELECT ?, ?, 'price_drop', ?, ?, ?, ?, ?
      WHERE ? = 1 AND EXISTS (SELECT 1 FROM commit_tokens WHERE token = ?)`,
    ).bind(
      crypto.randomUUID(),
      input.productId,
      previous,
      input.price,
      input.targetPrice,
      `v2|${input.observationKey}|price_drop`,
      input.at,
      flag(drop),
      token,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO alert_events (
        id, product_id, kind, previous_price, price, target_price, dedupe_key, created_at
      )
      SELECT ?, ?, 'target_crossed', ?, ?, ?, ?, ?
      WHERE ? = 1 AND EXISTS (SELECT 1 FROM commit_tokens WHERE token = ?)`,
    ).bind(
      crypto.randomUUID(),
      input.productId,
      previous,
      input.price,
      input.targetPrice,
      `v2|${input.observationKey}|target_crossed`,
      input.at,
      flag(crossed),
      token,
    ),
    env.DB.prepare(
      `INSERT INTO price_transitions (
        id, observation_key, product_id, store_id, product_name, product_url,
        previous_price, price, target_price, price_drop, target_crossed, observed_at, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
      WHERE ? = 1
        AND EXISTS (SELECT 1 FROM commit_tokens WHERE token = ?)
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
      token,
      input.observationKey,
      input.observationKey,
    ),
    env.DB.prepare(
      `INSERT INTO notification_outbox (
        transition_id, status, consent_epoch, created_at, updated_at
      )
      SELECT ?, CASE WHEN pref.enabled = 1 THEN 'queued' ELSE 'suppressed' END, pref.epoch, ?, ?
      FROM owner_alert_preference pref
      WHERE pref.id = 1
        AND EXISTS (SELECT 1 FROM commit_tokens WHERE token = ?)
        AND EXISTS (SELECT 1 FROM price_transitions WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM notification_outbox WHERE transition_id = ?)`,
    ).bind(transitionId, input.at, input.at, token, transitionId, transitionId),
    env.DB.prepare("DELETE FROM commit_tokens WHERE token = ?").bind(token),
  ]);
  const priceUpdated = (results[0]?.meta?.changes ?? 0) === 1;
  const observationStored = (results[2]?.meta?.changes ?? 0) === 1;
  if (priceUpdated && observationStored) {
    return "committed";
  }
  const replayed = await env.DB.prepare(
    "SELECT 1 AS ok FROM price_observations WHERE observation_key = ?",
  )
    .bind(input.observationKey)
    .first<{ ok: number }>();
  if (!replayed && countAttempt) {
    await env.DB.batch([
      env.DB.prepare("UPDATE watched_products SET last_attempt_at = ? WHERE id = ?").bind(input.at, input.productId),
      env.DB.prepare(
        "INSERT INTO monitor_attempts (day, product_id, outcome, created_at) VALUES (?, ?, 'preserved', ?)",
      ).bind(input.day, input.productId, input.at),
    ]);
  }
  return "stale";
}
