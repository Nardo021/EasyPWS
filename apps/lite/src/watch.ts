import type { MappedOmkarProduct } from "@easypws/adapters/omkar";
import { COLES_MARRICKVILLE_STORE_ID } from "@easypws/adapters/omkar";
import { STORE_NAME, type Env } from "./catalogue.js";
import { suppressQueuedForProduct } from "./alerts.js";
import { commitWatchedPrice } from "./commit.js";
import { alertText, sydneyDay } from "./monitor.js";

export interface WatchItem {
  watchlistItemId: string;
  listingId: string;
  productName: string;
  retailer: "coles";
  productUrl: string;
  currentPrice?: number;
  regularPrice?: number;
  discountPercentage?: number;
  historicalLow?: number;
  inStock: boolean;
  promotionType: string;
  monitoringStatus: string;
  targetPrice?: number;
  lastCheckedAt?: string;
  imageUrl?: string;
  sourceLabel: string;
  storeId: string;
  storeName: string;
  priceNote: string;
  availabilityLabel: string;
  notificationEligible: false;
  alertCount: number;
  alerts?: string[];
}

interface ProductRow {
  id: string;
  retailer_product_id: string;
  name: string;
  product_url: string;
  image_url: string | null;
  current_price: number | null;
  regular_price: number | null;
  promotion_type: string;
  in_stock: number;
  availability_known: number;
  source_label: string;
  price_note: string;
  retrieved_at: string | null;
  target_price: number | null;
  monitoring_status: string;
}

function optionalNumber(value: number | null): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function discount(regular: number | null, current: number | null): number | undefined {
  if (regular === null || current === null || regular <= 0 || current >= regular) {
    return undefined;
  }
  return Math.round((1 - current / regular) * 100);
}

async function historicalLow(env: Env, productId: string): Promise<number | undefined> {
  const row = await env.DB.prepare(
    "SELECT MIN(price) AS low FROM price_observations WHERE product_id = ? AND price IS NOT NULL",
  )
    .bind(productId)
    .first<{ low: number | null }>();
  return optionalNumber(row?.low ?? null);
}

async function alertsFor(env: Env, productId: string): Promise<{ count: number; alerts: string[] }> {
  const countRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM alert_events WHERE product_id = ?")
    .bind(productId)
    .first<{ n: number }>();
  const rows = await env.DB.prepare(
    `SELECT kind, previous_price, price, target_price
     FROM alert_events WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 3`,
  )
    .bind(productId)
    .all<{ kind: string; previous_price: number | null; price: number; target_price: number | null }>();
  return {
    count: countRow?.n ?? 0,
    alerts: rows.results.map((alert) => alertText(alert.kind, alert.previous_price, alert.price, alert.target_price)),
  };
}

export async function toWatchItem(env: Env, row: ProductRow): Promise<WatchItem> {
  const current = optionalNumber(row.current_price);
  const regular = optionalNumber(row.regular_price);
  const low = await historicalLow(env, row.id);
  const alerts = await alertsFor(env, row.id);
  return {
    watchlistItemId: row.id,
    listingId: row.id,
    productName: row.name,
    retailer: "coles",
    productUrl: row.product_url,
    ...(current !== undefined ? { currentPrice: current } : {}),
    ...(regular !== undefined ? { regularPrice: regular } : {}),
    ...(discount(row.regular_price, row.current_price) !== undefined
      ? { discountPercentage: discount(row.regular_price, row.current_price) }
      : {}),
    ...(low !== undefined ? { historicalLow: low } : {}),
    inStock: row.in_stock === 1,
    promotionType: row.promotion_type,
    monitoringStatus: row.monitoring_status,
    ...(optionalNumber(row.target_price) !== undefined ? { targetPrice: row.target_price ?? undefined } : {}),
    ...(row.retrieved_at ? { lastCheckedAt: row.retrieved_at } : {}),
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
    sourceLabel: row.source_label,
    storeId: COLES_MARRICKVILLE_STORE_ID,
    storeName: STORE_NAME,
    priceNote: row.price_note,
    availabilityLabel:
      row.availability_known === 1 ? (row.in_stock === 1 ? "有货" : "无货") : "库存未返回",
    notificationEligible: false,
    alertCount: alerts.count,
    ...(alerts.alerts.length > 0 ? { alerts: alerts.alerts } : {}),
  };
}

const SELECT_ROW = `SELECT id, retailer_product_id, name, product_url, image_url, current_price,
  regular_price, promotion_type, in_stock, availability_known, source_label, price_note,
  retrieved_at, target_price, monitoring_status FROM watched_products`;

export async function listItems(env: Env): Promise<WatchItem[]> {
  const rows = await env.DB.prepare(`${SELECT_ROW} ORDER BY created_at DESC`).all<ProductRow>();
  const items: WatchItem[] = [];
  for (const row of rows.results) {
    items.push(await toWatchItem(env, row));
  }
  return items;
}

export async function getItem(env: Env, id: string): Promise<WatchItem | null> {
  const row = await env.DB.prepare(`${SELECT_ROW} WHERE id = ?`).bind(id).first<ProductRow>();
  return row ? toWatchItem(env, row) : null;
}

export type ManualOutcome = "committed" | "stale" | "preserved" | "missing";

interface StoredWatch {
  id: string;
  revision: number;
  target_price: number | null;
  current_price: number | null;
  monitoring_status: string;
}

export interface RefreshSnapshot {
  id: string;
  retailerProductId: string;
  revision: number;
  currentPrice: number | null;
  targetPrice: number | null;
  monitoringStatus: string;
}

function usablePrice(product: MappedOmkarProduct): number | null {
  if (product.quoteUse !== "review_only") {
    return null;
  }
  if (typeof product.currentPrice !== "number" || !Number.isFinite(product.currentPrice) || product.currentPrice < 0) {
    return null;
  }
  return product.currentPrice;
}

export async function readSkuSnapshot(env: Env, retailerProductId: string): Promise<StoredWatch | null> {
  return env.DB.prepare(
    `SELECT id, revision, target_price, current_price, monitoring_status
     FROM watched_products WHERE retailer_product_id = ? AND store_id = ?`,
  )
    .bind(retailerProductId, COLES_MARRICKVILLE_STORE_ID)
    .first<StoredWatch>();
}

async function commitExisting(
  env: Env,
  existing: StoredWatch,
  product: MappedOmkarProduct,
  copy: { sourceLabel: string; priceNote: string },
  targetPrice: number | null | undefined,
  live: boolean,
  at: string,
): Promise<ManualOutcome> {
  const price = usablePrice(product);
  if (price === null) {
    return "preserved";
  }
  if (existing.monitoring_status !== "active") {
    return "preserved";
  }
  const target = targetPrice === undefined ? existing.target_price : targetPrice;
  return commitWatchedPrice(env, {
    productId: existing.id,
    storeId: COLES_MARRICKVILLE_STORE_ID,
    name: product.name,
    brand: product.brand,
    size: product.size,
    productUrl: product.productUrl,
    imageUrl: product.imageUrl,
    previousPrice: typeof existing.current_price === "number" ? existing.current_price : null,
    price,
    regularPrice: product.regularPrice,
    promotionType: product.promotionType,
    promotionKind: product.promotionKind,
    inStock: product.inStock,
    availabilityKnown: product.availabilityKnown,
    sourceLabel: copy.sourceLabel,
    priceNote: copy.priceNote,
    sourceTimestamp: product.sourceTimestamp,
    targetPrice: target,
    expectedTarget: existing.target_price,
    expectedRevision: existing.revision,
    writeTarget: targetPrice !== undefined,
    countAttempt: false,
    live,
    at,
    observationKey: crypto.randomUUID(),
    day: sydneyDay(new Date(at)),
  });
}

export async function readRefreshSnapshot(env: Env, id: string): Promise<RefreshSnapshot | null> {
  const row = await env.DB.prepare(
    `SELECT id, retailer_product_id, revision, current_price, target_price, monitoring_status
     FROM watched_products WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      retailer_product_id: string;
      revision: number;
      current_price: number | null;
      target_price: number | null;
      monitoring_status: string;
    }>();
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    retailerProductId: row.retailer_product_id,
    revision: row.revision,
    currentPrice: row.current_price,
    targetPrice: row.target_price,
    monitoringStatus: row.monitoring_status,
  };
}

export async function applyRefresh(
  env: Env,
  snapshot: RefreshSnapshot,
  product: MappedOmkarProduct,
  copy: { sourceLabel: string; priceNote: string },
  live: boolean,
): Promise<ManualOutcome> {
  const still = await env.DB.prepare("SELECT id FROM watched_products WHERE id = ?")
    .bind(snapshot.id)
    .first<{ id: string }>();
  if (!still) {
    return "missing";
  }
  const price = usablePrice(product);
  if (price === null) {
    return "preserved";
  }
  return commitWatchedPrice(env, {
    productId: snapshot.id,
    storeId: COLES_MARRICKVILLE_STORE_ID,
    name: product.name,
    brand: product.brand,
    size: product.size,
    productUrl: product.productUrl,
    imageUrl: product.imageUrl,
    previousPrice: snapshot.currentPrice,
    price,
    regularPrice: product.regularPrice,
    promotionType: product.promotionType,
    promotionKind: product.promotionKind,
    inStock: product.inStock,
    availabilityKnown: product.availabilityKnown,
    sourceLabel: copy.sourceLabel,
    priceNote: copy.priceNote,
    sourceTimestamp: product.sourceTimestamp,
    targetPrice: snapshot.targetPrice,
    expectedTarget: snapshot.targetPrice,
    expectedRevision: snapshot.revision,
    writeTarget: false,
    countAttempt: false,
    live,
    at: new Date().toISOString(),
    observationKey: crypto.randomUUID(),
    day: sydneyDay(),
  });
}

export async function saveProduct(
  env: Env,
  product: MappedOmkarProduct,
  copy: { sourceLabel: string; priceNote: string },
  targetPrice?: number,
  live = false,
  known?: StoredWatch | null,
): Promise<{ id: string; outcome: ManualOutcome }> {
  const now = new Date().toISOString();
  const existing = known === undefined ? await readSkuSnapshot(env, product.retailerProductId) : known;
  if (existing) {
    const outcome = await commitExisting(env, existing, product, copy, targetPrice, live, now);
    return { id: existing.id, outcome };
  }
  const id = crypto.randomUUID();
  const price = usablePrice(product);
  const inserted = await env.DB.prepare(
    `INSERT INTO watched_products (
      id, retailer_product_id, store_id, name, brand, size, product_url, image_url,
      current_price, regular_price, promotion_type, promotion_kind, in_stock, availability_known,
      source_label, price_note, source_timestamp, retrieved_at, target_price, monitoring_status,
      notification_eligible, created_at, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, 0)
    ON CONFLICT(retailer_product_id, store_id) DO NOTHING`,
  )
    .bind(
      id,
      product.retailerProductId,
      COLES_MARRICKVILLE_STORE_ID,
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
      now,
      targetPrice ?? null,
      now,
    )
    .run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    const winner = await readSkuSnapshot(env, product.retailerProductId);
    if (!winner) {
      return { id, outcome: "missing" };
    }
    const moved = winner.revision !== 0
      || (typeof winner.current_price === "number" && winner.current_price !== price);
    if (moved) {
      return { id: winner.id, outcome: "stale" };
    }
    const outcome = await commitExisting(env, winner, product, copy, targetPrice, live, now);
    return { id: winner.id, outcome };
  }
  if (price !== null) {
    await env.DB.prepare(
      `INSERT INTO price_observations (product_id, observed_at, price, regular_price, promotion_type)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, now, price, product.regularPrice, product.promotionType)
      .run();
  }
  return { id, outcome: "committed" };
}

export async function removeItem(env: Env, id: string): Promise<boolean> {
  const existing = await env.DB.prepare("SELECT id FROM watched_products WHERE id = ?").bind(id).first();
  if (!existing) {
    return false;
  }
  await suppressQueuedForProduct(env, id, new Date().toISOString());
  await env.DB.prepare("DELETE FROM price_observations WHERE product_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM alert_events WHERE product_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM watched_products WHERE id = ?").bind(id).run();
  return true;
}

export async function setStatus(env: Env, id: string, status: "active" | "paused"): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE watched_products SET monitoring_status = ?, revision = revision + 1 WHERE id = ?",
  )
    .bind(status, id)
    .run();
  const updated = (result.meta.changes ?? 0) > 0;
  if (updated && status === "paused") {
    await suppressQueuedForProduct(env, id, new Date().toISOString());
  }
  return updated;
}

export async function setTarget(env: Env, id: string, targetPrice: number): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE watched_products SET target_price = ?, revision = revision + 1 WHERE id = ?",
  )
    .bind(targetPrice, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function history(env: Env, id: string): Promise<{ observedAt: string; price: number; regularPrice?: number; promotionType: string }[]> {
  const rows = await env.DB.prepare(
    `SELECT observed_at, price, regular_price, promotion_type
     FROM price_observations WHERE product_id = ? AND price IS NOT NULL ORDER BY id ASC`,
  )
    .bind(id)
    .all<{ observed_at: string; price: number; regular_price: number | null; promotion_type: string }>();
  return rows.results.map((row) => ({
    observedAt: row.observed_at,
    price: row.price,
    ...(typeof row.regular_price === "number" ? { regularPrice: row.regular_price } : {}),
    promotionType: row.promotion_type,
  }));
}
