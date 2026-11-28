import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Env } from "./catalogue.js";
import { sydneyDay } from "./monitor.js";
import { runPriceQuery, TELEGRAM_QUERY_BUDGET } from "./query.js";

const require = createRequire(import.meta.url);
const { getPlatformProxy, createTestHarness } = require("wrangler") as {
  getPlatformProxy: (options: {
    configPath: string;
    persist: { path: string };
  }) => Promise<{ env: { DB: D1Database }; dispose: () => Promise<void> }>;
  createTestHarness: (options: {
    root?: string;
    workers: Array<{ config: Record<string, unknown> }>;
  }) => {
    listen(): Promise<unknown>;
    close(): Promise<void>;
    getWorker(name?: string): {
      fetch(input: string, init?: RequestInit): Promise<Response>;
      getEnv(): Promise<Record<string, unknown>>;
      applyD1Migrations(binding: string): Promise<void>;
    };
  };
};

const here = dirname(fileURLToPath(import.meta.url));
const liteRoot = resolve(here, "..");
const repoRoot = resolve(here, "../../..");
const telegramRoot = resolve(here, "../../telegram");
const migrations = ["0001_watch.sql", "0002_monitor.sql", "0003_alert_outbox.sql", "0004_alert_consistency.sql", "0005_telegram_queries.sql"];
const MILK = {
  id: 1251527,
  name: "Test Milk",
  brand: "Coles",
  size: "3L",
  link: "https://www.coles.com.au/product/test-milk-1251527",
  is_available: true,
  store_id: "4166",
  last_updated: "2026-11-28T00:00:00Z",
  pricing: { currency: "AUD", price: 3.3, was_price: 5.5, is_on_special: true, promotion_type: "special" },
};

function envOf(db: D1Database, extra: Partial<Env> = {}): Env {
  return {
    DB: db,
    ASSETS: {} as Fetcher,
    OMKAR_API_KEY: "local-test-key",
    EASYPWS_OMKAR_MODE: "live",
    ...extra,
  };
}

async function localD1(name: string) {
  const root = await mkdtemp(resolve(tmpdir(), `easypws-query-${name}-`));
  await writeFile(resolve(root, "worker.ts"), "export default { fetch() { return new Response('ok'); } };\n");
  await writeFile(resolve(root, "wrangler.json"), JSON.stringify({
    name: `easypws-query-${name}`,
    main: "./worker.ts",
    compatibility_date: "2026-11-17",
    d1_databases: [{ binding: "DB", database_name: name, database_id: crypto.randomUUID() }],
  }));
  const proxy = await getPlatformProxy({
    configPath: resolve(root, "wrangler.json"),
    persist: { path: resolve(root, "persist") },
  });
  for (const file of migrations) {
    const sql = (await readFile(resolve(here, "../migrations", file), "utf8")).replaceAll("\r", "");
    const parts = sql.split(";").map((part) => part.trim()).filter((part) => {
      const code = part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim();
      return code.length > 0;
    });
    for (const part of parts) {
      const statement = part.split("\n").filter((line) => !line.trim().startsWith("--")).join(" ");
      await proxy.env.DB.exec(statement);
    }
  }
  return {
    db: proxy.env.DB as D1Database,
    async dispose() {
      await Promise.race([proxy.dispose(), new Promise((done) => setTimeout(done, 4000))]);
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function count(db: D1Database, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ n: number }>();
  return row?.n ?? 0;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

async function readOutboundBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === "string") {
    return init.body;
  }
  if (init?.body instanceof Uint8Array) {
    return new TextDecoder().decode(init.body);
  }
  const candidates = [init, input].filter((value): value is Request => {
    return typeof value === "object" && value !== null && "text" in value && typeof value.text === "function";
  });
  for (const source of candidates) {
    try {
      return await source.clone().text();
    } catch {
      try {
        return await source.text();
      } catch {
        continue;
      }
    }
  }
  return "";
}

async function key(label: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(label));
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function mockOmkar(handler: (url: URL) => { status: number; body: unknown }): { calls: () => number; restore: () => void } {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw);
    if (url.hostname.endsWith("rapidapi.com")) {
      calls += 1;
      const result = handler(url);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json" },
      });
    }
    return original(input, init);
  };
  return { calls: () => calls, restore: () => { globalThis.fetch = original; } };
}

test("telegram quota, cache, replay and stored reads use a real local D1", { timeout: 180000 }, async () => {
  const local = await localD1("quota");
  const fetchMock = mockOmkar((url) => {
    if (url.pathname.endsWith("/products/details") && url.searchParams.get("product") === "1001") {
      return {
        status: 200,
        body: { id: 1001, name: "Unpriced sample", store_id: "4166", is_available: true },
      };
    }
    if (url.pathname.endsWith("/products/details") && url.searchParams.get("product") === "9999") {
      return { status: 200, body: { ...MILK, id: 9999, store_id: "9999" } };
    }
    if (url.searchParams.get("product") === "404") {
      return { status: 404, body: null };
    }
    return { status: 200, body: url.pathname.endsWith("/products/search") ? { products: [MILK] } : MILK };
  });
  try {
    const env = envOf(local.db);
    const now = new Date("2026-11-27T12:30:00.000Z");
    const firstKey = await key("milk-1");
    const first = await runPriceQuery(env, { operation: "search", argument: "Milk", requestKey: firstKey }, now);
    assert.equal(first.status, "ok");
    assert.match(first.text, /AUD 3\.30/);
    assert.match(first.text, /不是 Coles 官方核验价/);
    assert.match(first.text, /1251527/);
    assert.match(first.text, /https:\/\/www\.coles\.com\.au\/product\/1251527/);
    assert.equal(fetchMock.calls(), 1);

    const cached = await runPriceQuery(env, {
      operation: "search",
      argument: " milk ",
      requestKey: await key("milk-2"),
    }, new Date(now.getTime() + 60_000));
    assert.match(cached.text, /缓存/);
    assert.match(cached.text, /AUD 3\.30/);
    assert.equal(fetchMock.calls(), 1);

    const replay = await runPriceQuery(env, {
      operation: "search",
      argument: "other",
      requestKey: firstKey,
    }, new Date("2026-11-27T13:30:00.000Z"));
    assert.match(replay.text, /已经处理过/);
    assert.equal(fetchMock.calls(), 1);
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM telegram_query_reservations WHERE sydney_day = '2026-11-28'"), 0);

    const unpriced = await runPriceQuery(env, {
      operation: "price",
      argument: "1001",
      requestKey: await key("unpriced"),
    }, now);
    assert.equal(unpriced.status, "unavailable");
    assert.equal(unpriced.text.includes("AUD"), false);

    const wrongStore = await runPriceQuery(env, {
      operation: "price",
      argument: "9999",
      requestKey: await key("wrong-store"),
    }, now);
    assert.equal(wrongStore.status, "rejected");
    assert.match(wrongStore.text, /4166/);
    assert.equal(wrongStore.text.includes("AUD 3.30"), false);

    const missing = await runPriceQuery(env, {
      operation: "price",
      argument: "404",
      requestKey: await key("missing"),
    }, now);
    assert.equal(missing.status, "not_found");
    assert.equal(fetchMock.calls(), 4);

    const fixture = await runPriceQuery(envOf(local.db, { OMKAR_API_KEY: "", EASYPWS_OMKAR_MODE: "fixture" }), {
      operation: "search",
      argument: "milk",
      requestKey: await key("fixture"),
    }, now);
    assert.equal(fixture.status, "rejected");
    assert.match(fixture.text, /示例价格/);
    assert.equal(fixture.text.includes("4.95"), false);

    const productionFixture = await runPriceQuery(envOf(local.db, {
      EASYPWS_RUNTIME: "production",
      EASYPWS_OMKAR_MODE: "fixture",
    }), {
      operation: "price",
      argument: "1251527",
      requestKey: await key("prod-fixture"),
    }, now);
    assert.equal(productionFixture.status, "rejected");
    assert.equal(fetchMock.calls(), 4);

    await local.db.prepare(
      `INSERT INTO watched_products (
        id, retailer_product_id, store_id, name, product_url, current_price, regular_price,
        promotion_type, promotion_kind, in_stock, availability_known, source_label, price_note,
        retrieved_at, monitoring_status, notification_eligible, created_at
      ) VALUES (?, ?, '4166', ?, ?, 3.3, 5.5, 'special', 'percent_off', 1, 1, ?, ?, ?, 'active', 0, ?)`,
    ).bind(
      "watch-1",
      "1251527",
      "Test Milk",
      "https://www.coles.com.au/product/test-milk-1251527",
      "Omkar Hosted API",
      "API 报告价，不是 Coles 官方核验价。",
      "2026-11-28T01:00:00.000Z",
      "2026-11-28T01:00:00.000Z",
    ).run();
    await local.db.prepare(
      "INSERT INTO price_observations (product_id, observed_at, price, promotion_type) VALUES (?, ?, ?, 'special')",
    ).bind("watch-1", "2026-11-28T01:00:00.000Z", 3.3).run();
    const before = await count(local.db, "SELECT COUNT(*) AS n FROM provider_calls");
    const productsBefore = await count(local.db, "SELECT COUNT(*) AS n FROM watched_products");
    const listed = await runPriceQuery(env, { operation: "watchlist" }, now);
    const past = await runPriceQuery(env, { operation: "history", argument: "1251527" }, now);
    const deal = await runPriceQuery(env, { operation: "deals" }, now);
    const absent = await runPriceQuery(env, { operation: "history", argument: "42" }, now);
    assert.match(listed.text, /没有请求价格源/);
    assert.match(listed.text, /AUD 3\.30/);
    assert.match(past.text, /AUD 3\.30/);
    assert.match(deal.text, /记录折扣/);
    assert.match(deal.text, /不是 Coles 官方核验特价/);
    assert.equal(absent.status, "not_found");
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM provider_calls"), before);
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM watched_products"), productsBefore);
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM price_observations"), 1);

    const used = await count(local.db, "SELECT COUNT(*) AS n FROM telegram_query_reservations WHERE sydney_day = '2026-11-27'");
    for (let index = used; index < TELEGRAM_QUERY_BUDGET; index += 1) {
      await local.db.prepare(
        "INSERT INTO telegram_query_reservations (request_key, sydney_day, operation, created_at) VALUES (?, '2026-11-27', 'search', ?)",
      ).bind(await key(`pad-${index}`), now.toISOString()).run();
    }
    await local.db.prepare(
      "UPDATE telegram_query_cache SET stored_at = ? WHERE cache_key IS NOT NULL",
    ).bind("2026-11-27T10:00:00.000Z").run();
    const blocked = await runPriceQuery(env, {
      operation: "search",
      argument: "milk",
      requestKey: await key("after-expiry"),
    }, now);
    assert.equal(blocked.status, "stale");
    assert.equal(blocked.text.includes("AUD 3.30"), false);
    assert.equal(fetchMock.calls(), 4);

    const callsBeforeBurst = fetchMock.calls();
    await local.db.prepare("DELETE FROM telegram_query_reservations").run();
    await local.db.prepare("DELETE FROM telegram_query_cache").run();
    const burstNow = new Date("2026-11-28T02:00:00.000Z");
    const burst = await Promise.all(Array.from({ length: 8 }, async (_unused, index) => runPriceQuery(env, {
      operation: "search",
      argument: `item${index}`,
      requestKey: await key(`burst-${index}`),
    }, burstNow)));
    const reserved = burst.filter((item) => item.status === "ok").length;
    const blockedBurst = burst.filter((item) => item.status === "quota").length;
    assert.equal(reserved, TELEGRAM_QUERY_BUDGET);
    assert.equal(blockedBurst, 3);
    assert.equal(fetchMock.calls() - callsBeforeBurst, TELEGRAM_QUERY_BUDGET);
    await local.db.prepare("DELETE FROM telegram_query_reservations").run();
    await local.db.prepare("DELETE FROM telegram_query_cache").run();
    for (let index = 0; index < 40; index += 1) {
      await local.db.prepare(
        "INSERT INTO telegram_query_cache (cache_key, payload, stored_at) VALUES (?, ?, ?)",
      ).bind(
        `pad-${index}`,
        JSON.stringify({ items: [{ sku: "1251527", name: "Pad", price: 1, regular: null, sourceTimestamp: null }] }),
        burstNow.toISOString(),
      ).run();
    }
    const pruned = await runPriceQuery(env, {
      operation: "search",
      argument: "retention",
      requestKey: await key("retention"),
    }, burstNow);
    assert.equal(pruned.status, "ok");
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM telegram_query_cache"), 32);
  } finally {
    fetchMock.restore();
    await local.dispose();
  }
});

function runTsc(args: string[]): Promise<{ code: number; output: string }> {
  const tsc = require.resolve("typescript/bin/tsc");
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [tsc, ...args], { cwd: repoRoot, windowsHide: true });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

async function ensureAdapterDist(): Promise<void> {
  const entry = resolve(repoRoot, "packages/adapters/dist/provider/omkar-map.js");
  const project = resolve(repoRoot, "packages/adapters");
  try {
    await access(entry);
    return;
  } catch {
    // Fresh CI typechecks without the workspace build. The Worker bundle resolves dist.
  }
  const built = await runTsc(["-b", project]);
  assert.equal(built.code, 0, built.output.slice(-1500));
  try {
    await access(entry);
  } catch {
    const forced = await runTsc(["-b", project, "--force"]);
    assert.equal(forced.code, 0, forced.output.slice(-1500));
  }
}

test("both private RPC directions work across two local workers", { timeout: 180000 }, async () => {
  await ensureAdapterDist();
  const root = await mkdtemp(resolve(tmpdir(), "easypws-query-rpc-"));
  const server = createTestHarness({
    root,
    workers: [
      {
        config: {
          name: "easypws",
          main: resolve(liteRoot, "src/worker.ts"),
          compatibility_date: "2026-11-17",
          d1_databases: [{
            binding: "DB",
            database_name: "easypws-query-price",
            database_id: crypto.randomUUID(),
            migrations_dir: resolve(liteRoot, "migrations"),
          }],
          vars: { OMKAR_API_KEY: "local-test-key", EASYPWS_OMKAR_MODE: "live" },
          services: [{ binding: "TELEGRAM_ALERTS", service: "easypws-telegram", entrypoint: "AlertDelivery" }],
        },
      },
      {
        config: {
          name: "easypws-telegram",
          main: resolve(telegramRoot, "src/worker.ts"),
          compatibility_date: "2026-11-17",
          d1_databases: [{
            binding: "DB",
            database_name: "easypws-query-telegram",
            database_id: crypto.randomUUID(),
            migrations_dir: resolve(telegramRoot, "migrations"),
          }],
          vars: {
            TELEGRAM_BOT_TOKEN: "123456:THIS_IS_A_FAKE_LOCAL_TEST_TOKEN_abcdef",
            TELEGRAM_WEBHOOK_SECRET: "this_is_a_local_test_secret_1234567890",
            TELEGRAM_OWNER_USER_ID: "123456789",
            TELEGRAM_OWNER_CHAT_ID: "123456789",
          },
          services: [{ binding: "PRICE_QUERY", service: "easypws", entrypoint: "PriceQuery" }],
        },
      },
    ],
  });
  const original = globalThis.fetch;
  const sent: string[] = [];
  const hosts: string[] = [];
  let providerCalls = 0;
  try {
    await server.listen();
    const price = server.getWorker("easypws");
    const telegram = server.getWorker("easypws-telegram");
    await price.applyD1Migrations("DB");
    await telegram.applyD1Migrations("DB");
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = requestUrl(input);
      let host: string;
      try {
        host = new URL(raw).hostname;
      } catch {
        return original(input, init);
      }
      hosts.push(host);
      if (host.endsWith("rapidapi.com")) {
        providerCalls += 1;
        return new Response(JSON.stringify({ products: [MILK] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (host === "api.telegram.org") {
        // The harness passes the workerd Request as the fetch init. clone().text()
        // reads that buffered body; consuming init.body directly waits until the
        // caller aborts and the delivery is stored as unknown.
        sent.push(await readOutboundBody(input, init));
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return original(input, init);
    };
    const denied = await telegram.fetch("https://easypws-telegram.yanze.me/query", { method: "POST" });
    assert.equal(denied.status, 404);
    const response = await telegram.fetch("https://easypws-telegram.yanze.me/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": "this_is_a_local_test_secret_1234567890",
      },
      body: JSON.stringify({
        update_id: 501,
        message: {
          message_id: 1,
          date: 1,
          from: { id: 123456789, is_bot: false, first_name: "Owner" },
          chat: { id: 123456789, type: "private" },
          text: "/search milk",
        },
      }),
    });
    assert.equal(response.status, 200);
    const priceDb = (await price.getEnv())["DB"] as D1Database;
    const recorded = await priceDb.prepare("SELECT COUNT(*) AS n FROM provider_calls").first<{ n: number }>();
    const detail = `hosts=${hosts.join(",")} db=${recorded?.n ?? "none"} sent=${JSON.stringify(sent).slice(0, 400)}`;
    assert.equal(providerCalls, 1, detail);
    assert.equal(sent.length, 1, detail);
    assert.match(sent[0] ?? "", /AUD 3\.30/, detail);
    assert.match(sent[0] ?? "", /不是 Coles 官方核验价/);
    const priceEnv = await price.getEnv();
    assert.ok(priceEnv["TELEGRAM_ALERTS"], "reciprocal AlertDelivery binding is missing");
    const transitionId = crypto.randomUUID();
    const at = "2026-11-28T01:00:00.000Z";
    const day = sydneyDay();
    await priceDb.prepare(
      "UPDATE owner_alert_preference SET enabled = 1, epoch = 1, updated_at = ? WHERE id = 1",
    ).bind(at).run();
    await priceDb.prepare(
      `INSERT INTO watched_products (
        id, retailer_product_id, store_id, name, product_url, current_price, regular_price,
        promotion_type, promotion_kind, in_stock, availability_known, source_label, price_note,
        monitoring_status, notification_eligible, created_at
      ) VALUES ('watch-rpc', '1251527', '4166', 'Test Milk', ?, 3.3, 5.5, 'special', 'percent_off', 1, 1, ?, ?, 'active', 0, ?)`,
    ).bind(
      "https://www.coles.com.au/product/1251527",
      "Omkar Hosted API",
      "API 报告价，不是 Coles 官方核验价。",
      at,
    ).run();
    await priceDb.prepare(
      `INSERT INTO price_transitions (
        id, observation_key, product_id, store_id, product_name, product_url,
        previous_price, price, target_price, price_drop, target_crossed, observed_at, created_at
      ) VALUES (?, ?, 'watch-rpc', '4166', 'Test Milk', ?, 5.5, 3.3, NULL, 1, 0, ?, ?)`,
    ).bind(transitionId, transitionId, "https://www.coles.com.au/product/1251527", at, at).run();
    await priceDb.prepare(
      `INSERT INTO notification_outbox (transition_id, status, consent_epoch, created_at, updated_at)
       VALUES (?, 'queued', 1, ?, ?)`,
    ).bind(transitionId, at, at).run();
    for (let index = 0; index < 15; index += 1) {
      await priceDb.prepare(
        "INSERT INTO monitor_attempts (day, product_id, outcome, created_at) VALUES (?, 'watch-rpc', 'preserved', ?)",
      ).bind(day, at).run();
    }
    // Calling the binding from the Node test deadlocks the outbound response until
    // the 5s abort. The scheduled handler is the production caller and runs inside
    // the price worker, with the monitor budget already exhausted.
    const scheduled = price as typeof price & {
      scheduled(options?: { cron?: string }): Promise<unknown>;
    };
    await scheduled.scheduled({ cron: "0 22 * * *" });
    const outbox = await priceDb.prepare(
      "SELECT status FROM notification_outbox WHERE transition_id = ?",
    ).bind(transitionId).first<{ status: string }>();
    const telegramDb = (await telegram.getEnv())["DB"] as D1Database;
    const receipt = await telegramDb.prepare(
      "SELECT status FROM telegram_update_receipts WHERE update_id = 501",
    ).first<{ status: string }>();
    const deliveryRow = await telegramDb.prepare(
      "SELECT status FROM telegram_alert_deliveries WHERE transition_id = ?",
    ).bind(transitionId).first<{ status: string }>();
    assert.equal(outbox?.status, "sent", `outbox=${outbox?.status ?? "none"} delivery=${deliveryRow?.status ?? "none"} second=${(sent[1] ?? "").slice(0, 180)}`);
    assert.equal(deliveryRow?.status, "sent");
    assert.equal(receipt?.status, "sent");
    assert.equal(sent.length, 2);
    assert.match(sent[1] ?? "", /价格提醒/);
    assert.match(sent[1] ?? "", /报告价/);
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = original;
    await server.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
