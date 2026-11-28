import { COLES_MARRICKVILLE_STORE_ID, type MappedOmkarProduct } from "@easypws/adapters/omkar";
import { dispatchOutbox } from "./alerts.js";
import { detailsReported, omkarMode, sourceCopy, type Env } from "./catalogue.js";
import { commitWatchedPrice } from "./commit.js";

export const DAILY_MONITOR_BUDGET = 15;

interface ActiveRow {
  id: string;
  retailer_product_id: string;
  current_price: number | null;
  target_price: number | null;
  revision: number;
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

export async function runScheduled(env: Env, now = new Date()): Promise<void> {
  let monitorError: unknown = null;
  try {
    await runMonitor(env, now);
  } catch (error) {
    monitorError = error;
  }
  try {
    await dispatchOutbox(env, now);
  } catch {
    // A notification failure must not change the price-monitor result.
  }
  if (monitorError) {
    throw monitorError;
  }
}

export function alertText(
  kind: string,
  previous: number | null,
  price: number,
  target: number | null,
): string {
  if (kind === "price_drop" && previous !== null) {
    return `API 报告价下降 ${money(previous)} → ${money(price)}。不是官方核验价。`;
  }
  if (kind === "target_crossed" && target !== null) {
    return `API 报告价达到目标价 ${money(target)}，现报 ${money(price)}。不是官方核验价。`;
  }
  return "有一条未发送的价格记录。";
}

export async function monitorUsage(env: Env, now = new Date()): Promise<{ budget: number; usedToday: number }> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM monitor_attempts WHERE day = ?")
    .bind(sydneyDay(now))
    .first<{ n: number }>();
  return { budget: DAILY_MONITOR_BUDGET, usedToday: row?.n ?? 0 };
}

export function reportedPrice(product: MappedOmkarProduct): number | null {
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

async function applyReport(
  env: Env,
  row: ActiveRow,
  product: MappedOmkarProduct,
  price: number,
  live: boolean,
  at: string,
  day: string,
): Promise<"committed" | "stale"> {
  const copy = sourceCopy(live);
  return commitWatchedPrice(env, {
    productId: row.id,
    storeId: COLES_MARRICKVILLE_STORE_ID,
    name: product.name,
    brand: product.brand,
    size: product.size,
    productUrl: product.productUrl,
    imageUrl: product.imageUrl,
    previousPrice: typeof row.current_price === "number" ? row.current_price : null,
    price,
    regularPrice: product.regularPrice,
    promotionType: product.promotionType,
    promotionKind: product.promotionKind,
    inStock: product.inStock,
    availabilityKnown: product.availabilityKnown,
    sourceLabel: copy.sourceLabel,
    priceNote: copy.priceNote,
    sourceTimestamp: product.sourceTimestamp,
    targetPrice: typeof row.target_price === "number" ? row.target_price : null,
    expectedRevision: row.revision,
    live,
    at,
    observationKey: crypto.randomUUID(),
    day,
  });
}

export async function runMonitor(env: Env, now = new Date()): Promise<{ checked: number; updated: number; preserved: number }> {
  if (omkarMode(env) === "unavailable") {
    return { checked: 0, updated: 0, preserved: 0 };
  }
  const day = sydneyDay(now);
  const usage = await monitorUsage(env, now);
  const remaining = Math.max(0, usage.budget - usage.usedToday);
  if (remaining === 0) {
    return { checked: 0, updated: 0, preserved: 0 };
  }
  const rows = await env.DB.prepare(
    `SELECT id, retailer_product_id, current_price, target_price, revision
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
    const outcome = await applyReport(env, row, loaded.product, price, loaded.live, at, day);
    if (outcome === "committed") {
      updated += 1;
    } else {
      preserved += 1;
    }
  }
  return { checked: rows.results.length, updated, preserved };
}
