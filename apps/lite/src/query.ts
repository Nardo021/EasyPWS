import { parseColesProductId } from "@easypws/adapters/omkar";
import { COLES_MARRICKVILLE_STORE_ID } from "@easypws/adapters/omkar";
import {
  detailsReported,
  HttpError,
  omkarMode,
  searchReported,
  sourceCopy,
  STORE_NAME,
  type Env,
} from "./catalogue.js";
import { sydneyDay } from "./monitor.js";

export const TELEGRAM_QUERY_BUDGET = 5;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ROWS = 32;
const SEARCH_LIMIT = 5;
const STORED_LIMIT = 8;
const MAX_TEXT = 3500;
const DISCLAIMER = "API 报告价，不是 Coles 官方核验价。";

export type QueryStatus =
  | "ok"
  | "unavailable"
  | "invalid"
  | "stale"
  | "provider_error"
  | "quota"
  | "not_found"
  | "rejected";

export interface PriceQueryReply {
  status: QueryStatus;
  text: string;
}

type LiveOperation = "search" | "price";
type StoredOperation = "watchlist" | "history" | "deals";
type QueryOperation = LiveOperation | StoredOperation;

interface QueryInput {
  operation: QueryOperation;
  argument: string;
  requestKey: string;
}

interface CachedItem {
  sku: string;
  name: string;
  price: number;
  regular: number | null;
  sourceTimestamp: string | null;
}

interface CachedPayload {
  retrievedAt: string;
  items: CachedItem[];
}

const STATUSES = new Set<QueryStatus>([
  "ok",
  "unavailable",
  "invalid",
  "stale",
  "provider_error",
  "quota",
  "not_found",
  "rejected",
]);

function reply(status: QueryStatus, text: string): PriceQueryReply {
  return { status, text: clip(text) };
}

function clip(text: string): string {
  const clean = plain(text, MAX_TEXT);
  return clean.length > 0 ? clean : "查询结果无法使用。";
}

function plain(value: string, max: number): string {
  let cleaned = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 10 || (code >= 32 && code !== 127)) {
      cleaned += char;
    }
  }
  const trimmed = cleaned.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
}

function aud(value: number): string {
  return `AUD ${value.toFixed(2)}`;
}

function sydneyStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} Australia/Sydney`;
}

function colesLink(sku: string): string | null {
  if (!/^[1-9]\d{0,11}$/.test(sku)) {
    return null;
  }
  const canonical = `https://www.coles.com.au/product/${sku}`;
  return parseColesProductId(canonical) === sku ? canonical : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReply(value: QueryInput | PriceQueryReply): value is PriceQueryReply {
  return "status" in value;
}

function parseInput(value: unknown): QueryInput | PriceQueryReply {
  if (!isRecord(value)) {
    return reply("invalid", "查询参数无法使用。没有请求价格源。");
  }
  const operation = value["operation"];
  if (operation !== "search" && operation !== "price" && operation !== "watchlist"
    && operation !== "history" && operation !== "deals") {
    return reply("invalid", "不支持这个查询。没有请求价格源。");
  }
  const argument = typeof value["argument"] === "string" ? value["argument"].trim() : "";
  const requestKey = typeof value["requestKey"] === "string" ? value["requestKey"] : "";
  if (argument.length > 80 || requestKey.length > 64) {
    return reply("invalid", "查询参数过长。没有请求价格源。");
  }
  return { operation, argument, requestKey };
}

function liveArgument(operation: LiveOperation, argument: string): PriceQueryReply | string {
  if (operation === "search") {
    if (argument.length < 2 || argument.length > 80) {
      return reply("invalid", "搜索词需要 2 到 80 个字符。没有请求价格源。");
    }
    return argument.replace(/\s+/g, " ").toLowerCase();
  }
  if (!/^[1-9]\d{0,11}$/.test(argument)) {
    return reply("invalid", "SKU 必须是数字商品编号。没有请求价格源。");
  }
  return argument;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function reserve(
  env: Env,
  requestKey: string,
  operation: LiveOperation,
  now: Date,
): Promise<"reserved" | "replay" | "quota" | "ambiguous"> {
  if (!/^[0-9a-f]{64}$/.test(requestKey)) {
    return "ambiguous";
  }
  const day = sydneyDay(now);
  const at = now.toISOString();
  const inserted = await env.DB.prepare(
    `INSERT INTO telegram_query_reservations (request_key, sydney_day, operation, created_at)
     SELECT ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM telegram_query_reservations WHERE request_key = ?)
       AND (SELECT COUNT(*) FROM telegram_query_reservations WHERE sydney_day = ?) < ?`,
  ).bind(requestKey, day, operation, at, requestKey, day, TELEGRAM_QUERY_BUDGET).run();
  const changes = inserted.meta?.changes;
  if (changes !== 0 && changes !== 1) {
    return "ambiguous";
  }
  if (changes === 1) {
    return "reserved";
  }
  const existing = await env.DB.prepare(
    "SELECT request_key FROM telegram_query_reservations WHERE request_key = ?",
  ).bind(requestKey).first<{ request_key: string }>();
  return existing ? "replay" : "quota";
}

async function readCache(env: Env, cacheKey: string, now: Date): Promise<CachedPayload | "expired" | null> {
  const row = await env.DB.prepare(
    "SELECT payload, stored_at FROM telegram_query_cache WHERE cache_key = ?",
  ).bind(cacheKey).first<{ payload: string; stored_at: string }>();
  if (!row) {
    return null;
  }
  const stored = new Date(row.stored_at);
  if (Number.isNaN(stored.getTime()) || now.getTime() - stored.getTime() > CACHE_TTL_MS) {
    return "expired";
  }
  return parseCached(row.payload, row.stored_at);
}

function parseCached(payload: string, storedAt: string): CachedPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["items"])) {
    return null;
  }
  const items: CachedItem[] = [];
  for (const item of parsed["items"]) {
    if (!isRecord(item) || typeof item["sku"] !== "string" || typeof item["name"] !== "string") {
      return null;
    }
    if (typeof item["price"] !== "number" || !Number.isFinite(item["price"])) {
      return null;
    }
    const regular = item["regular"];
    items.push({
      sku: item["sku"],
      name: plain(item["name"], 80),
      price: item["price"],
      regular: typeof regular === "number" && Number.isFinite(regular) ? regular : null,
      sourceTimestamp: typeof item["sourceTimestamp"] === "string" ? item["sourceTimestamp"] : null,
    });
    if (items.length >= SEARCH_LIMIT) {
      break;
    }
  }
  if (items.length === 0) {
    return null;
  }
  return { retrievedAt: storedAt, items };
}

async function writeCache(env: Env, cacheKey: string, payload: CachedPayload, now: Date): Promise<void> {
  const body = JSON.stringify({ items: payload.items });
  if (body.length > 4000) {
    return;
  }
  const at = now.toISOString();
  const expiredBefore = new Date(now.getTime() - CACHE_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR REPLACE INTO telegram_query_cache (cache_key, payload, stored_at) VALUES (?, ?, ?)",
    ).bind(cacheKey, body, at),
    env.DB.prepare("DELETE FROM telegram_query_cache WHERE stored_at < ?").bind(expiredBefore),
    env.DB.prepare(
      `DELETE FROM telegram_query_cache WHERE cache_key IN (
         SELECT cache_key FROM telegram_query_cache
         ORDER BY stored_at DESC, cache_key DESC
         LIMIT -1 OFFSET ?
       )`,
    ).bind(CACHE_MAX_ROWS),
  ]);
}

function formatLive(items: CachedItem[], retrievedAt: string, cached: boolean): string {
  const copy = sourceCopy(true);
  const lines = [
    cached ? "10 分钟内的已验证缓存，本次没有再次请求价格源。" : "本次向价格源请求了 1 次，没有自动重试。",
    `门店 ${COLES_MARRICKVILLE_STORE_ID} ${STORE_NAME}`,
    `取回时间 ${sydneyStamp(retrievedAt)}`,
    `来源：${copy.sourceLabel}。${DISCLAIMER}`,
  ];
  for (const item of items.slice(0, SEARCH_LIMIT)) {
    const link = colesLink(item.sku);
    const regular = item.regular !== null && item.regular > item.price ? `，记录原价 ${aud(item.regular)}` : "";
    const sourceTime = item.sourceTimestamp ? `，来源时间 ${sydneyStamp(item.sourceTimestamp)}` : "";
    lines.push(`${plain(item.name, 80)}｜SKU ${item.sku}｜${aud(item.price)}${regular}${sourceTime}`);
    if (link) {
      lines.push(link);
    }
  }
  return lines.join("\n");
}

function toCachedItem(product: {
  retailerProductId: string;
  name: string;
  currentPrice: number | null;
  regularPrice: number | null;
  sourceTimestamp: string | null;
  quoteUse: string;
}): CachedItem | null {
  if (product.quoteUse !== "review_only" || typeof product.currentPrice !== "number") {
    return null;
  }
  if (!/^[1-9]\d{0,11}$/.test(product.retailerProductId)) {
    return null;
  }
  return {
    sku: product.retailerProductId,
    name: plain(product.name, 80),
    price: product.currentPrice,
    regular: typeof product.regularPrice === "number" ? product.regularPrice : null,
    sourceTimestamp: product.sourceTimestamp,
  };
}

async function liveQuery(env: Env, input: QueryInput, now: Date): Promise<PriceQueryReply> {
  const operation = input.operation === "price" ? "price" : "search";
  const argument = liveArgument(operation, input.argument);
  if (typeof argument !== "string") {
    return argument;
  }
  if (!/^[0-9a-f]{64}$/.test(input.requestKey)) {
    return reply("invalid", "查询身份无法使用。没有请求价格源。");
  }
  const mode = omkarMode(env);
  if (mode !== "live") {
    return reply("rejected", "已拒绝示例价格。没有把示例数据当作当前 Coles 价格，也没有把它写入缓存。");
  }
  const cacheKey = await digest(`${operation}|${COLES_MARRICKVILLE_STORE_ID}|${argument}`);
  const cached = await readCache(env, cacheKey, now);
  if (cached && cached !== "expired") {
    return reply("ok", formatLive(cached.items, cached.retrievedAt, true));
  }
  const gate = await reserve(env, input.requestKey, operation, now);
  if (gate === "replay") {
    return reply("rejected", "这条查询已经处理过。没有再次请求价格源，也没有把旧缓存当作新的当前价格。");
  }
  if (gate === "quota") {
    if (cached === "expired") {
      return reply("stale", "缓存已过期，今日未缓存查询额度已用完。没有把旧价格当作当前价格。");
    }
    return reply("quota", "今日 Telegram 未缓存查询已用完 5 次。这次没有请求价格源。这不是全局供应商额度上限。");
  }
  if (gate === "ambiguous") {
    return reply("provider_error", "查询额度没有确认，已停止。没有请求价格源，也没有自动重试。");
  }
  try {
    const retrievedAt = now.toISOString();
    const items: CachedItem[] = [];
    if (operation === "search") {
      const products = await searchReported(env, argument);
      for (const product of products) {
        const item = toCachedItem(product);
        if (item) {
          items.push(item);
        }
        if (items.length >= SEARCH_LIMIT) {
          break;
        }
      }
    } else {
      const loaded = await detailsReported(env, argument);
      if (!loaded.live) {
        return reply("rejected", "已拒绝示例价格。没有把示例数据当作当前 Coles 价格。");
      }
      const item = toCachedItem(loaded.product);
      if (item) {
        items.push(item);
      } else if (loaded.product.quoteUse === "unpriced") {
        return reply("unavailable", `SKU ${argument} 没有可用价格。${DISCLAIMER}这次失败或空结果已计入今日查询次数。`);
      }
    }
    if (items.length === 0) {
      return reply("unavailable", "没有可用的商品报价。这次查询已计入今日次数，没有自动重试。");
    }
    const payload = { retrievedAt, items };
    await writeCache(env, cacheKey, payload, now);
    return reply("ok", formatLive(items, retrievedAt, false));
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404) {
        return reply("not_found", "没有找到这个商品。没有自动重试。这次查询已计入今日次数。");
      }
      if (error.message.includes("门店不是")) {
        return reply("rejected", "返回的门店不是 4166，已拒绝。没有把它当作价格。这次查询已计入今日次数。");
      }
      if (error.status === 429) {
        return reply("provider_error", "价格源额度受限。这次失败已计入今日查询次数，没有自动重试。这不是 Telegram 的 5 次本地额度。");
      }
      return reply("provider_error", "价格源没有返回可用结果。这次失败已计入今日查询次数，没有自动重试。");
    }
    return reply("provider_error", "价格查询没有完成。没有自动重试。若额度已预留，这次会计入今日次数。");
  }
}

interface StoredRow {
  retailer_product_id: string;
  name: string;
  product_url: string;
  current_price: number | null;
  regular_price: number | null;
  source_label: string;
  price_note: string;
  retrieved_at: string | null;
}

function storedLine(row: StoredRow): string {
  const sku = row.retailer_product_id;
  const price = typeof row.current_price === "number" ? aud(row.current_price) : "无可用价格";
  const when = row.retrieved_at ? sydneyStamp(row.retrieved_at) : "无取回时间";
  const link = colesLink(sku);
  const note = plain(row.price_note, 80);
  return [
    `${plain(row.name, 80)}｜SKU ${plain(sku, 16)}｜${price}`,
    `门店 ${COLES_MARRICKVILLE_STORE_ID}｜取回 ${when}｜来源 ${plain(row.source_label, 40)}`,
    note,
    link ?? "没有可用的 Coles 商品链接",
  ].join("\n");
}

async function watchlist(env: Env): Promise<PriceQueryReply> {
  const rows = await env.DB.prepare(
    `SELECT retailer_product_id, name, product_url, current_price, regular_price,
            source_label, price_note, retrieved_at
     FROM watched_products WHERE store_id = ?
     ORDER BY created_at DESC LIMIT ?`,
  ).bind(COLES_MARRICKVILLE_STORE_ID, STORED_LIMIT).all<StoredRow>();
  if (rows.results.length === 0) {
    return reply("ok", "收藏是空的。本次没有请求价格源，也没有修改收藏。");
  }
  const lines = ["已保存的收藏。本次没有请求价格源，也没有修改记录。", ...rows.results.map(storedLine)];
  return reply("ok", lines.join("\n"));
}

async function history(env: Env, argument: string): Promise<PriceQueryReply> {
  if (!/^[1-9]\d{0,11}$/.test(argument)) {
    return reply("invalid", "历史查询需要数字 SKU。没有请求价格源。");
  }
  const product = await env.DB.prepare(
    `SELECT id, name FROM watched_products WHERE retailer_product_id = ? AND store_id = ?`,
  ).bind(argument, COLES_MARRICKVILLE_STORE_ID).first<{ id: string; name: string }>();
  if (!product) {
    return reply("not_found", "收藏里没有这个商品。本次没有请求价格源，也没有新增收藏。");
  }
  const rows = await env.DB.prepare(
    `SELECT observed_at, price FROM price_observations
     WHERE product_id = ? AND price IS NOT NULL
     ORDER BY id DESC LIMIT ?`,
  ).bind(product.id, STORED_LIMIT).all<{ observed_at: string; price: number }>();
  const points = [...rows.results].reverse();
  if (points.length === 0) {
    return reply("unavailable", `SKU ${argument} 没有已保存的价格记录。本次没有请求价格源。`);
  }
  const lines = [
    `${plain(product.name, 80)}｜SKU ${argument}`,
    "已保存的价格记录。本次没有请求价格源，也没有修改记录。",
    ...points.map((point) => `${sydneyStamp(point.observed_at)}｜${aud(point.price)}`),
  ];
  return reply("ok", lines.join("\n"));
}

async function deals(env: Env): Promise<PriceQueryReply> {
  const rows = await env.DB.prepare(
    `SELECT retailer_product_id, name, product_url, current_price, regular_price,
            source_label, price_note, retrieved_at
     FROM watched_products
     WHERE store_id = ?
       AND current_price IS NOT NULL
       AND regular_price IS NOT NULL
       AND current_price < regular_price
     ORDER BY created_at DESC LIMIT ?`,
  ).bind(COLES_MARRICKVILLE_STORE_ID, STORED_LIMIT).all<StoredRow>();
  if (rows.results.length === 0) {
    return reply("ok", "收藏里没有已记录的折扣。本次没有请求价格源，也没有修改记录。");
  }
  const lines = ["收藏中已记录的折扣。这不是 Coles 官方核验特价。本次没有请求价格源。"];
  for (const row of rows.results) {
    const current = row.current_price ?? 0;
    const regular = row.regular_price ?? 0;
    lines.push(`${storedLine(row)}\n记录折扣 ${aud(regular)} → ${aud(current)}`);
  }
  return reply("ok", lines.join("\n"));
}

export function acceptQueryReply(value: unknown): PriceQueryReply | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = value["status"];
  const text = value["text"];
  if (typeof status !== "string" || !STATUSES.has(status as QueryStatus) || typeof text !== "string") {
    return null;
  }
  if (text.length === 0 || text.length > MAX_TEXT) {
    return null;
  }
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code !== 10 && (code < 32 || code === 127)) {
      return null;
    }
  }
  return { status: status as QueryStatus, text };
}

/** Read-only Telegram query. Search and price may call Omkar once; stored commands never do. */
export async function runPriceQuery(env: Env, input: unknown, now = new Date()): Promise<PriceQueryReply> {
  const parsed = parseInput(input);
  if (isReply(parsed)) {
    return parsed;
  }
  const query = parsed;
  switch (query.operation) {
    case "search":
    case "price":
      return liveQuery(env, query, now);
    case "watchlist":
      return watchlist(env);
    case "history":
      return history(env, query.argument);
    case "deals":
      return deals(env);
    default: {
      const unreachable: never = query.operation;
      return unreachable;
    }
  }
}
