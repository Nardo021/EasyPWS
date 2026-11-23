import type { MappedOmkarProduct } from "@easypws/adapters/omkar";
import { COLES_MARRICKVILLE_STORE_ID } from "@easypws/adapters/omkar";
import { STORE_NAME, type Env } from "./catalogue.js";

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

export async function toWatchItem(env: Env, row: ProductRow): Promise<WatchItem> {
  const current = optionalNumber(row.current_price);
  const regular = optionalNumber(row.regular_price);
  const low = await historicalLow(env, row.id);
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

export async function saveProduct(
  env: Env,
  product: MappedOmkarProduct,
  copy: { sourceLabel: string; priceNote: string },
  targetPrice?: number,
): Promise<string> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT id, target_price FROM watched_products WHERE retailer_product_id = ? AND store_id = ?",
  )
    .bind(product.retailerProductId, COLES_MARRICKVILLE_STORE_ID)
    .first<{ id: string; target_price: number | null }>();
  const id = existing?.id ?? crypto.randomUUID();
  const target = targetPrice ?? existing?.target_price ?? null;
  await env.DB.prepare(
    `INSERT INTO watched_products (
      id, retailer_product_id, store_id, name, brand, size, product_url, image_url,
      current_price, regular_price, promotion_type, promotion_kind, in_stock, availability_known,
      source_label, price_note, source_timestamp, retrieved_at, target_price, monitoring_status,
      notification_eligible, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)
    ON CONFLICT(retailer_product_id, store_id) DO UPDATE SET
      name = excluded.name,
      brand = excluded.brand,
      size = excluded.size,
      product_url = excluded.product_url,
      image_url = excluded.image_url,
      current_price = excluded.current_price,
      regular_price = excluded.regular_price,
      promotion_type = excluded.promotion_type,
      promotion_kind = excluded.promotion_kind,
      in_stock = excluded.in_stock,
      availability_known = excluded.availability_known,
      source_label = excluded.source_label,
      price_note = excluded.price_note,
      source_timestamp = excluded.source_timestamp,
      retrieved_at = excluded.retrieved_at,
      target_price = excluded.target_price`,
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
      product.currentPrice,
      product.regularPrice,
      product.promotionType,
      product.promotionKind,
      product.inStock ? 1 : 0,
      product.availabilityKnown ? 1 : 0,
      copy.sourceLabel,
      copy.priceNote,
      product.sourceTimestamp,
      now,
      target,
      now,
    )
    .run();
  if (typeof product.currentPrice === "number") {
    await env.DB.prepare(
      `INSERT INTO price_observations (product_id, observed_at, price, regular_price, promotion_type)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, now, product.currentPrice, product.regularPrice, product.promotionType)
      .run();
  }
  return id;
}

export async function removeItem(env: Env, id: string): Promise<boolean> {
  const existing = await env.DB.prepare("SELECT id FROM watched_products WHERE id = ?").bind(id).first();
  if (!existing) {
    return false;
  }
  await env.DB.prepare("DELETE FROM price_observations WHERE product_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM watched_products WHERE id = ?").bind(id).run();
  return true;
}

export async function setStatus(env: Env, id: string, status: "active" | "paused"): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE watched_products SET monitoring_status = ? WHERE id = ?",
  )
    .bind(status, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function setTarget(env: Env, id: string, targetPrice: number): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE watched_products SET target_price = ? WHERE id = ?")
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
