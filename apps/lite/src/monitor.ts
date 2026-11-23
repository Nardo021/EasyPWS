import type { MappedOmkarProduct } from "@easypws/adapters/omkar";
import { detailsReported, sourceCopy, type Env } from "./catalogue.js";

export const DAILY_MONITOR_BUDGET = 15;

interface ActiveRow {
  id: string;
  retailer_product_id: string;
  current_price: number | null;
  target_price: number | null;
}

export function sydneyDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function money(value: number): string {
  return value.toFixed(2);
}

export function alertText(
  kind: string,
  previous: number | null,
  price: number,
  target: number | null,
): string {
  if (kind === "price_drop" && previous !== null) {
    return `API 报告价下降 ${money(previous)} → ${money(price)}。不是官方核验价，未发送通知。`;
  }
  if (kind === "target_crossed" && target !== null) {
    return `API 报告价达到目标价 ${money(target)}，现报 ${money(price)}。不是官方核验价，未发送通知。`;
  }
  return "有一条未发送的价格记录。";
}

export async function monitorUsage(env: Env, now = new Date()): Promise<{ budget: number; usedToday: number }> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM monitor_attempts WHERE day = ?")
    .bind(sydneyDay(now))
    .first<{ n: number }>();
  return { budget: DAILY_MONITOR_BUDGET, usedToday: row?.n ?? 0 };
}

function reportedPrice(product: MappedOmkarProduct): number | null {
  if (product.quoteUse !== "review_only") {
    return null;
  }
  if (typeof product.currentPrice !== "number" || !Number.isFinite(product.currentPrice) || product.currentPrice < 0) {
    return null;
  }
  return product.currentPrice;
}

async function recordAttempt(env: Env, day: string, productId: string, outcome: "updated" | "preserved", at: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO monitor_attempts (day, product_id, outcome, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(day, productId, outcome, at)
    .run();
}

async function insertAlert(
  env: Env,
  productId: string,
  kind: "price_drop" | "target_crossed",
  previous: number | null,
  price: number,
  target: number | null,
  at: string,
): Promise<void> {
  const dedupe = `${productId}|${kind}|${previous === null ? "" : money(previous)}|${money(price)}|${target === null ? "" : money(target)}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO alert_events (
      id, product_id, kind, previous_price, price, target_price, dedupe_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), productId, kind, previous, price, target, dedupe, at)
    .run();
}

async function applyReport(
  env: Env,
  row: ActiveRow,
  product: MappedOmkarProduct,
  price: number,
  live: boolean,
  at: string,
): Promise<void> {
  const previous = typeof row.current_price === "number" ? row.current_price : null;
  const target = typeof row.target_price === "number" ? row.target_price : null;
  if (previous !== null && price < previous) {
    await insertAlert(env, row.id, "price_drop", previous, price, target, at);
  }
  if (previous !== null && target !== null && previous > target && price <= target) {
    await insertAlert(env, row.id, "target_crossed", previous, price, target, at);
  }
  const copy = sourceCopy(live);
  await env.DB.prepare(
    `UPDATE watched_products SET
      name = ?, brand = ?, size = ?, product_url = ?, image_url = ?,
      current_price = ?, regular_price = ?, promotion_type = ?, promotion_kind = ?,
      in_stock = ?, availability_known = ?, source_label = ?, price_note = ?,
      source_timestamp = ?, retrieved_at = ?, last_attempt_at = ?
    WHERE id = ?`,
  )
    .bind(
      product.name,
      product.brand,
      product.size,
      product.productUrl,
      product.imageUrl,
      price,
      product.regularPrice,
      product.promotionType,
      product.promotionKind,
      product.inStock ? 1 : 0,
      product.availabilityKnown ? 1 : 0,
      copy.sourceLabel,
      copy.priceNote,
      product.sourceTimestamp,
      at,
      at,
      row.id,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO price_observations (product_id, observed_at, price, regular_price, promotion_type)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(row.id, at, price, product.regularPrice, product.promotionType)
    .run();
}

export async function runMonitor(env: Env, now = new Date()): Promise<{ checked: number; updated: number; preserved: number }> {
  const day = sydneyDay(now);
  const usage = await monitorUsage(env, now);
  const remaining = Math.max(0, usage.budget - usage.usedToday);
  if (remaining === 0) {
    return { checked: 0, updated: 0, preserved: 0 };
  }
  const rows = await env.DB.prepare(
    `SELECT id, retailer_product_id, current_price, target_price
     FROM watched_products
     WHERE monitoring_status = 'active'
     ORDER BY COALESCE(last_attempt_at, retrieved_at, '') ASC, created_at ASC
     LIMIT ?`,
  )
    .bind(remaining)
    .all<ActiveRow>();

  let updated = 0;
  let preserved = 0;
  for (const row of rows.results) {
    const at = new Date().toISOString();
    const loaded = await detailsReported(env, row.retailer_product_id)
      .then((result) => ({ product: result.product, live: result.live }))
      .catch(() => null);
    const product = loaded?.product ?? null;
    const price = product ? reportedPrice(product) : null;
    if (!loaded || price === null) {
      await env.DB.prepare("UPDATE watched_products SET last_attempt_at = ? WHERE id = ?")
        .bind(at, row.id)
        .run();
      await recordAttempt(env, day, row.id, "preserved", at);
      preserved += 1;
      continue;
    }
    await applyReport(env, row, loaded.product, price, loaded.live, at);
    await recordAttempt(env, day, row.id, "updated", at);
    updated += 1;
  }
  return { checked: rows.results.length, updated, preserved };
}
