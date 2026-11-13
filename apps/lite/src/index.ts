import { parseColesProductId } from "@easypws/adapters/omkar";
import {
  HttpError,
  detailsReported,
  externalRequestCount,
  isProduction,
  omkarMode,
  searchReported,
  sourceCopy,
  STORE_NAME,
  type Env,
} from "./catalogue.js";
import { COLES_MARRICKVILLE_STORE_ID } from "@easypws/adapters/omkar";
import { monitorUsage, runMonitor } from "./monitor.js";
import {
  getItem,
  history,
  listItems,
  removeItem,
  saveProduct,
  setStatus,
  setTarget,
} from "./watch.js";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function accessEmail(request: Request): string | null {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email")?.trim() ?? "";
  return email.length > 0 ? email : null;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 4000) {
    throw new HttpError(400, "请求过大");
  }
  if (text.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "请求格式不正确");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "请求格式不正确");
  }
}

function itemId(pathname: string, suffix: string): string | null {
  const match = pathname.match(new RegExp(`^/api/v1/watchlists/items/([^/]+)${suffix}$`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const dataMode = omkarMode(env);
  const live = dataMode === "live";
  const copy = sourceCopy(live);

  if (method === "GET" && path === "/api/v1/health") {
    const usage = await monitorUsage(env);
    return json({
      ok: dataMode !== "unavailable",
      runtime: isProduction(env) ? "production" : "workerd-local",
      mode: dataMode,
      storeId: COLES_MARRICKVILLE_STORE_ID,
      externalRequests: await externalRequestCount(env),
      monitorBudget: usage.budget,
      monitorUsedToday: usage.usedToday,
    });
  }

  if (method === "GET" && path === "/api/v1/auth/me") {
    if (isProduction(env)) {
      const email = accessEmail(request);
      if (!email) {
        throw new HttpError(401, "需要 Cloudflare Access 登录");
      }
        return json({
          email,
          scopes: ["private"],
          mode: "private",
          sourceLabel: dataMode === "unavailable" ? "Omkar Hosted API" : copy.sourceLabel,
          storeId: COLES_MARRICKVILLE_STORE_ID,
          storeName: STORE_NAME,
          priceNote: dataMode === "unavailable" ? "生产环境没有可用的 Omkar 密钥，已拒绝示例价格" : copy.priceNote,
          liveApi: live,
        });
    }
    return json({
      email: "local",
      scopes: ["local"],
      mode: "local",
      sourceLabel: copy.sourceLabel,
      storeId: COLES_MARRICKVILLE_STORE_ID,
      storeName: STORE_NAME,
      priceNote: copy.priceNote,
      liveApi: live,
    });
  }

  if (method === "GET" && path === "/api/v1/watchlists/items") {
    return json({ items: await listItems(env) });
  }

  if (method === "GET" && path === "/api/v1/products/search") {
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query.length < 2 || query.length > 80) {
      throw new HttpError(400, "请输入 2 到 80 个字符");
    }
    const products = await searchReported(env, query);
    return json({
      items: products.map((product) => ({
        retailerProductId: product.retailerProductId,
        name: product.name,
        ...(product.brand ? { brand: product.brand } : {}),
        ...(product.size ? { size: product.size } : {}),
        productUrl: product.productUrl,
        ...(typeof product.currentPrice === "number" ? { currentPrice: product.currentPrice } : {}),
        ...(typeof product.regularPrice === "number" ? { regularPrice: product.regularPrice } : {}),
        ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
      })),
    });
  }

  if (method === "POST" && path === "/api/v1/products/import") {
    const body = await readJson(request);
    const rawUrl = typeof body["url"] === "string" ? body["url"] : "";
    const productId = parseColesProductId(rawUrl);
    if (!productId) {
      throw new HttpError(400, "请粘贴 coles.com.au 商品链接");
    }
    const target = typeof body["targetPrice"] === "number" ? body["targetPrice"] : undefined;
    const { product, live: fetchedLive } = await detailsReported(env, productId);
    const id = await saveProduct(env, product, sourceCopy(fetchedLive), target);
    return json({ ok: true, watchlistItemId: id });
  }

  const refreshId = itemId(path, "/refresh");
  if (method === "POST" && refreshId) {
    const current = await env.DB.prepare(
      "SELECT retailer_product_id FROM watched_products WHERE id = ?",
    )
      .bind(refreshId)
      .first<{ retailer_product_id: string }>();
    if (!current) {
      throw new HttpError(404, "收藏里没有这个商品");
    }
    const { product, live: fetchedLive } = await detailsReported(env, current.retailer_product_id);
    await saveProduct(env, product, sourceCopy(fetchedLive));
    return json({ ok: true });
  }

  const statusId = itemId(path, "/status");
  if (method === "PATCH" && statusId) {
    const body = await readJson(request);
    const status = body["status"];
    if (status !== "active" && status !== "paused") {
      throw new HttpError(400, "状态不正确");
    }
    const updated = await setStatus(env, statusId, status);
    if (!updated) {
      throw new HttpError(404, "收藏里没有这个商品");
    }
    return json({ ok: true });
  }

  const targetId = itemId(path, "/target-price");
  if (method === "PATCH" && targetId) {
    const body = await readJson(request);
    const target = body["targetPrice"];
    if (typeof target !== "number" || !Number.isFinite(target) || target < 0) {
      throw new HttpError(400, "目标价必须是数字");
    }
    const updated = await setTarget(env, targetId, target);
    if (!updated) {
      throw new HttpError(404, "收藏里没有这个商品");
    }
    return json({ ok: true });
  }

  const deleteId = itemId(path, "");
  if (method === "DELETE" && deleteId) {
    const removed = await removeItem(env, deleteId);
    if (!removed) {
      throw new HttpError(404, "收藏里没有这个商品");
    }
    return json({ ok: true });
  }

  const historyMatch = path.match(/^\/api\/v1\/prices\/listings\/([^/]+)\/history$/);
  if (method === "GET" && historyMatch?.[1]) {
    const id = decodeURIComponent(historyMatch[1]);
    const summary = await getItem(env, id);
    if (!summary) {
      throw new HttpError(404, "收藏里没有这个商品");
    }
    return json({ points: await history(env, id), summary });
  }

  return json({ message: "没有这个接口" }, 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (isProduction(env) && !accessEmail(request)) {
      return json({ message: "需要 Cloudflare Access 登录" }, 401);
    }
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await route(request, env, url);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ message: error.message }, error.status);
      }
      return json({ message: "本地服务暂时失败" }, 500);
    }
  },
  async scheduled(_controller, env): Promise<void> {
    await runMonitor(env);
  },
} satisfies ExportedHandler<Env>;
