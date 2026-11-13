import {
  COLES_MARRICKVILLE_STORE_ID,
  mapOmkarProduct,
  omkarProductRows,
  type MappedOmkarProduct,
} from "@easypws/adapters/omkar";

export const STORE_NAME = "Coles Marrickville, NSW";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OMKAR_API_KEY?: string;
  RAPIDAPI_KEY?: string;
  EASYPWS_OMKAR_MODE?: string;
  EASYPWS_RUNTIME?: string;
}

const HOST = "best-coles-scraper-free-1000-calls.p.rapidapi.com";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isProduction(env: Env): boolean {
  return env.EASYPWS_RUNTIME === "production";
}

export function omkarKey(env: Env): string {
  return (env.OMKAR_API_KEY ?? env.RAPIDAPI_KEY ?? "").trim();
}

/** Production never uses fixture data, even when fixture mode is requested. */
export function omkarMode(env: Env): "live" | "fixture" | "unavailable" {
  if (isProduction(env)) {
    return omkarKey(env).length > 0 && env.EASYPWS_OMKAR_MODE !== "fixture" ? "live" : "unavailable";
  }
  if (env.EASYPWS_OMKAR_MODE === "fixture" || omkarKey(env).length === 0) {
    return "fixture";
  }
  return "live";
}

export function assertOmkarReady(env: Env): "live" | "fixture" {
  const mode = omkarMode(env);
  if (mode === "unavailable") {
    throw new HttpError(503, "生产环境没有可用的 Omkar 密钥，已拒绝示例价格");
  }
  return mode;
}

export function sourceCopy(live: boolean): { sourceLabel: string; priceNote: string } {
  if (live) {
    return {
      sourceLabel: "Omkar Hosted API",
      priceNote: "API 报告价，不是 Coles 官方核验价。不发送通知。",
    };
  }
  return {
    sourceLabel: "本地示例",
    priceNote: "本地示例数据，没有请求 Omkar，也不是 Coles 官方核验价。不发送通知。",
  };
}

const ENERGY = {
  id: 8737163,
  name: "V Energy Drink Original 4x250ml",
  brand: "V",
  size: "1L",
  link: "https://www.coles.com.au/product/v-energy-drink-original-4x250ml-8737163",
  is_available: true,
  store_id: COLES_MARRICKVILLE_STORE_ID,
  last_updated: "2026-11-11T11:41:07Z",
  pricing: {
    currency: "AUD",
    price: 6,
    was_price: 12,
    save_percent: 50,
    is_on_special: true,
    promotion_type: "special",
    special_type: "percent_off",
    price_description: "1/2 Price",
  },
};

const MILK = {
  id: 8150288,
  name: "Coles Full Cream Milk",
  brand: "Coles",
  size: "3L",
  link: "https://www.coles.com.au/product/coles-full-cream-milk-8150288",
  is_available: true,
  store_id: COLES_MARRICKVILLE_STORE_ID,
  pricing: {
    currency: "AUD",
    price: 4.95,
    is_on_special: false,
  },
};

function fixtureBody(operation: "search" | "details", query: string): { status: number; body: unknown } {
  if (operation === "search") {
    return { status: 200, body: { products: [MILK] } };
  }
  if (query === String(ENERGY.id)) {
    return { status: 200, body: ENERGY };
  }
  if (query === String(MILK.id)) {
    return { status: 200, body: MILK };
  }
  if (query === "1001") {
    return {
      status: 200,
      body: { id: 1001, name: "Unpriced sample", store_id: COLES_MARRICKVILLE_STORE_ID, is_available: true },
    };
  }
  return { status: 404, body: null };
}

async function recordCall(env: Env, operation: string, httpStatus: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO provider_calls (operation, http_status, created_at) VALUES (?, ?, ?)",
  )
    .bind(operation, httpStatus, new Date().toISOString())
    .run();
}

export async function externalRequestCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_calls").first<{ n: number }>();
  return row?.n ?? 0;
}

/** One Omkar call. No retry. Store is always 4166. */
export async function omkarRequest(
  env: Env,
  operation: "search" | "details",
  query: string,
): Promise<{ status: number; body: unknown; live: boolean }> {
  const mode = assertOmkarReady(env);
  if (mode === "fixture") {
    const fixture = fixtureBody(operation, query);
    return { ...fixture, live: false };
  }
  const key = omkarKey(env);
  const url = new URL(`https://${HOST}${operation === "search" ? "/products/search" : "/products/details"}`);
  url.searchParams.set("store", COLES_MARRICKVILLE_STORE_ID);
  if (operation === "search") {
    url.searchParams.set("query", query);
    url.searchParams.set("page", "1");
  } else {
    url.searchParams.set("product", query);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let status = 0;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-rapidapi-host": HOST,
        "x-rapidapi-key": key,
      },
      signal: controller.signal,
    });
    status = response.status;
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    return { status, body, live: true };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new HttpError(aborted ? 504 : 502, aborted ? "Omkar 请求超时，没有自动重试" : "暂时无法连接 Omkar，没有自动重试");
  } finally {
    clearTimeout(timer);
    await recordCall(env, operation, status);
  }
}

function rejectStatus(status: number): never {
  if (status === 401 || status === 403) {
    throw new HttpError(502, "Omkar 授权失败");
  }
  if (status === 404) {
    throw new HttpError(404, "没有找到这个商品");
  }
  if (status === 429) {
    throw new HttpError(429, "Omkar 额度已用尽");
  }
  throw new HttpError(502, "Omkar 没有返回可用报价");
}

export async function searchReported(env: Env, query: string): Promise<MappedOmkarProduct[]> {
  const response = await omkarRequest(env, "search", query);
  if (response.status !== 200) {
    rejectStatus(response.status);
  }
  const now = new Date().toISOString();
  const products: MappedOmkarProduct[] = [];
  const seen = new Set<string>();
  for (const row of omkarProductRows(response.body)) {
    const id = productIdOf(row);
    if (!id || seen.has(id)) {
      continue;
    }
    const mapped = mapOmkarProduct(row, id, now);
    if (!mapped.ok) {
      continue;
    }
    seen.add(id);
    products.push(mapped.product);
    if (products.length >= 12) {
      break;
    }
  }
  return products;
}

export async function detailsReported(env: Env, productId: string): Promise<{ product: MappedOmkarProduct; live: boolean }> {
  const response = await omkarRequest(env, "details", productId);
  if (response.status !== 200) {
    rejectStatus(response.status);
  }
  const mapped = mapOmkarProduct(response.body, productId, new Date().toISOString());
  if (!mapped.ok) {
    const message =
      mapped.reason === "store_mismatch"
        ? "返回的门店不是 4166，已拒绝"
        : "商品报价无法使用";
    throw new HttpError(502, message);
  }
  return { product: mapped.product, live: response.live };
}

function productIdOf(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  if (typeof id === "number" && Number.isInteger(id) && id > 0) {
    return String(id);
  }
  if (typeof id === "string" && /^\d+$/.test(id)) {
    return id;
  }
  return null;
}
