import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deliverOwnerAlert } from "../../telegram/src/alerts.js";
import type { TelegramEnv } from "../../telegram/src/index.js";
import { dispatchOutbox, setTelegramAlerts } from "./alerts.js";
import type { Env } from "./catalogue.js";
import { commitWatchedPrice, type CommitInput } from "./commit.js";
import app from "./index.js";
import { saveProduct } from "./watch.js";

const require = createRequire(import.meta.url);
const { getPlatformProxy } = require("wrangler") as {
  getPlatformProxy: (options: {
    configPath: string;
    persist: { path: string };
  }) => Promise<{ env: { DB: D1Database }; dispose: () => Promise<void> }>;
};

const here = dirname(fileURLToPath(import.meta.url));
const MILK_URL = "https://www.coles.com.au/product/coles-full-cream-milk-8150288";
const KEY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const KEY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const KEY_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

function ctx(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
}

const databaseIds = new Map<string, string>();

async function localD1(name: string, migrationDir: string, files: string[]) {
  const root = await mkdtemp(resolve(tmpdir(), `easypws-r2-${name}-`));
  const databaseId = databaseIds.get(name) ?? crypto.randomUUID();
  databaseIds.set(name, databaseId);
  await writeFile(resolve(root, "worker.ts"), "export default { fetch() { return new Response('ok'); } };\n");
  await writeFile(resolve(root, "wrangler.json"), JSON.stringify({
    name: `easypws-r2-${name}`,
    main: "./worker.ts",
    compatibility_date: "2026-11-24",
    d1_databases: [{
      binding: "DB",
      database_name: name,
      database_id: databaseId,
    }],
  }));
  const proxy = await getPlatformProxy({
    configPath: resolve(root, "wrangler.json"),
    persist: { path: resolve(root, "persist") },
  });
  for (const file of files) {
    const sql = (await readFile(resolve(migrationDir, file), "utf8")).replaceAll("\r", "");
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
    db: proxy.env.DB,
    async dispose() {
      await Promise.race([
        proxy.dispose(),
        new Promise((done) => setTimeout(done, 4000)),
      ]);
      await rm(root, { recursive: true, force: true });
    },
  };
}

function input(overrides: Partial<CommitInput> = {}): CommitInput {
  return {
    productId: "milk",
    storeId: "4166",
    name: "Coles Full Cream Milk",
    brand: "Coles",
    size: "3L",
    productUrl: MILK_URL,
    imageUrl: null,
    previousPrice: 5,
    price: 3,
    regularPrice: 5,
    promotionType: "unknown",
    promotionKind: "unknown",
    inStock: true,
    availabilityKnown: true,
    sourceLabel: "Omkar Hosted API",
    priceNote: "API 报告价，不是 Coles 官方核验价。",
    sourceTimestamp: null,
    targetPrice: 4,
    live: true,
    at: "2026-11-28T02:00:00.000Z",
    observationKey: KEY_A,
    day: "2026-11-28",
    expectedRevision: 0,
    ...overrides,
  };
}

async function seed(db: D1Database, id: string, price: number | null, sku = id): Promise<void> {
  await db.prepare(
    `INSERT INTO watched_products (
      id, retailer_product_id, store_id, name, product_url, current_price, target_price,
      promotion_type, promotion_kind, in_stock, availability_known, source_label, price_note,
      monitoring_status, notification_eligible, created_at
    ) VALUES (?, ?, '4166', 'Coles Full Cream Milk', ?, ?, 4, 'unknown', 'unknown', 1, 1,
      'Omkar Hosted API', 'note', 'active', 0, '2026-11-01T00:00:00.000Z')`,
  ).bind(id, sku, MILK_URL, price).run();
}

async function count(db: D1Database, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ n: number }>();
  return row?.n ?? 0;
}

async function priceOf(db: D1Database, id: string): Promise<number | null> {
  const row = await db.prepare("SELECT current_price AS price FROM watched_products WHERE id = ?")
    .bind(id)
    .first<{ price: number | null }>();
  return row?.price ?? null;
}

const priceMigrations = ["0001_watch.sql", "0002_monitor.sql", "0003_alert_outbox.sql", "0004_alert_consistency.sql"];
const telegramMigrations = ["0001_webhook_receipts.sql", "0002_alert_deliveries.sql", "0003_alert_lease.sql"];

test("observation replay and ABA do not rewrite price or attempts", { timeout: 180000 }, async () => {
  const price = await localD1("aba", resolve(here, "../migrations"), priceMigrations);
  const db = price.db;
  const env = { DB: db } as Env;
  try {
    await seed(db, "milk", 5);
    const attempts = () => count(db, "SELECT COUNT(*) AS n FROM monitor_attempts WHERE product_id = 'milk'");
    const transitions = () => count(db, "SELECT COUNT(*) AS n FROM price_transitions WHERE product_id = 'milk'");
    const alerts = () => count(db, "SELECT COUNT(*) AS n FROM alert_events WHERE product_id = 'milk'");
    assert.equal(await commitWatchedPrice(env, input()), "committed");
    const afterFirstAttempts = await attempts();
    const afterFirstAlerts = await alerts();
    assert.equal(await commitWatchedPrice(env, input()), "stale");
    assert.equal(await priceOf(db, "milk"), 3);
    assert.equal(await attempts(), afterFirstAttempts);
    assert.equal(await alerts(), afterFirstAlerts);
    assert.equal(await transitions(), 1);

    assert.equal(await commitWatchedPrice(env, input({
      previousPrice: 3,
      price: 5,
      at: "2026-11-28T03:00:00.000Z",
      observationKey: KEY_B,
      expectedRevision: 1,
    })), "committed");
    assert.equal(await priceOf(db, "milk"), 5);
    const beforeReplay = {
      attempts: await attempts(),
      alerts: await alerts(),
      transitions: await transitions(),
      observations: await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = 'milk'"),
    };
    assert.equal(await commitWatchedPrice(env, input({
      previousPrice: 5,
      price: 3,
      at: "2026-11-28T02:00:00.000Z",
      observationKey: KEY_A,
    })), "stale");
    assert.equal(await priceOf(db, "milk"), 5);
    assert.equal(await attempts(), beforeReplay.attempts);
    assert.equal(await alerts(), beforeReplay.alerts);
    assert.equal(await transitions(), beforeReplay.transitions);
    assert.equal(
      await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = 'milk'"),
      beforeReplay.observations,
    );

    assert.equal(await commitWatchedPrice(env, input({
      previousPrice: 5,
      price: 3,
      at: "2026-11-28T04:00:00.000Z",
      observationKey: KEY_C,
      expectedRevision: 0,
    })), "stale");
    assert.equal(await priceOf(db, "milk"), 5);
    assert.equal(await transitions(), beforeReplay.transitions);
    assert.equal(
      await count(db, "SELECT COUNT(*) AS n FROM monitor_attempts WHERE product_id = 'milk' AND outcome = 'updated'"),
      2,
    );

    await seed(db, "rollback-path", 5);
    await db.exec(
      "CREATE TRIGGER abort_commit BEFORE INSERT ON price_transitions WHEN NEW.product_id = 'rollback-path' BEGIN SELECT RAISE(ABORT, 'forced'); END",
    );
    await assert.rejects(() => commitWatchedPrice(env, input({
      productId: "rollback-path",
      observationKey: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      at: "2026-11-28T06:00:00.000Z",
    })));
    assert.equal(await priceOf(db, "rollback-path"), 5);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = 'rollback-path'"), 0);
    const revision = await db.prepare("SELECT revision FROM watched_products WHERE id = 'rollback-path'")
      .first<{ revision: number }>();
    assert.equal(revision?.revision, 0);
  } finally {
    await price.dispose();
  }
});

test("opt-out then re-enable does not send an in-flight disabled alert", { timeout: 180000 }, async () => {
  const price = await localD1("consent", resolve(here, "../migrations"), priceMigrations);
  const db = price.db;
  const real = { DB: db } as Env;
  let armed = true;
  const proxied = {
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      if (armed) {
        armed = false;
        await setTelegramAlerts(real, false, "2026-11-28T02:00:01.000Z");
      }
      return db.batch(statements);
    },
  } as D1Database;
  const env = { DB: proxied } as Env;
  try {
    await seed(db, "milk", 5);
    await setTelegramAlerts(real, true, "2026-11-28T01:00:00.000Z");
    assert.equal(await commitWatchedPrice(env, input()), "committed");
    await setTelegramAlerts(real, true, "2026-11-28T02:00:02.000Z");
    const sends: string[] = [];
    await dispatchOutbox({
      DB: db,
      TELEGRAM_ALERTS: {
        async deliver() {
          sends.push("sent");
          return { state: "sent", claimed: true };
        },
      },
    } as unknown as Env);
    assert.equal(sends.length, 0);
    const status = await db.prepare("SELECT status FROM notification_outbox").first<{ status: string }>();
    assert.notEqual(status?.status, "queued");
  } finally {
    await price.dispose();
  }
});

test("unavailable requeue cannot revive an old consent epoch", { timeout: 180000 }, async () => {
  const price = await localD1("requeue", resolve(here, "../migrations"), priceMigrations);
  const db = price.db;
  const real = { DB: db } as Env;
  try {
    await seed(db, "milk", 5);
    await setTelegramAlerts(real, true, "2026-11-28T01:00:00.000Z");
    assert.equal(await commitWatchedPrice(real, input()), "committed");
    await dispatchOutbox({
      DB: db,
      TELEGRAM_ALERTS: {
        async deliver() {
          await setTelegramAlerts(real, false, "2026-11-28T02:00:01.000Z");
          await setTelegramAlerts(real, true, "2026-11-28T02:00:02.000Z");
          return { state: "unavailable", claimed: false };
        },
      },
    } as unknown as Env);
    const sends: string[] = [];
    await dispatchOutbox({
      DB: db,
      TELEGRAM_ALERTS: {
        async deliver() {
          sends.push("sent");
          return { state: "sent", claimed: true };
        },
      },
    } as unknown as Env);
    assert.equal(sends.length, 0);
  } finally {
    await price.dispose();
  }
});

test("refresh and import do not recreate or attach history to the wrong item", { timeout: 180000 }, async () => {
  const price = await localD1("manual", resolve(here, "../migrations"), priceMigrations);
  const db = price.db;
  try {
    async function refreshAfter(action: () => Promise<void>): Promise<Response> {
      let armed = true;
      const proxied = {
        prepare(sql: string) {
          const statement = db.prepare(sql);
          const wrap = (bound: D1PreparedStatement): D1PreparedStatement => new Proxy(bound, {
            get(target, prop, receiver) {
              if (prop === "bind") {
                return (...args: unknown[]) => wrap(target.bind(...(args as [])));
              }
              if (prop === "first" || prop === "run" || prop === "all") {
                return async (...args: unknown[]) => {
                  const result = await Reflect.apply(target[prop] as (...values: unknown[]) => Promise<unknown>, target, args);
                  if (armed && sql.includes("FROM watched_products WHERE id")) {
                    armed = false;
                    await action();
                  }
                  return result;
                };
              }
              return Reflect.get(target, prop, receiver);
            },
          });
          return wrap(statement);
        },
        batch: (statements: D1PreparedStatement[]) => db.batch(statements),
        exec: (sql: string) => db.exec(sql),
      } as D1Database;
      return app.fetch(
        new Request("http://127.0.0.1/api/v1/watchlists/items/8150288/refresh", { method: "POST" }),
        { DB: proxied, EASYPWS_OMKAR_MODE: "fixture", ASSETS: { fetch: async () => new Response("asset") } } as unknown as Env,
        ctx(),
      );
    }

    await seed(db, "8150288", 5, "8150288");
    await refreshAfter(async () => {
      await db.prepare("DELETE FROM watched_products WHERE id = '8150288'").run();
    });
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM watched_products WHERE retailer_product_id = '8150288'"), 0);

    await seed(db, "8150288", 5, "8150288");
    await refreshAfter(async () => {
      await db.prepare("UPDATE watched_products SET monitoring_status = 'paused' WHERE id = '8150288'").run();
    });
    assert.equal(await priceOf(db, "8150288"), 5);
    const paused = await db.prepare("SELECT monitoring_status AS status FROM watched_products WHERE id = '8150288'")
      .first<{ status: string }>();
    assert.equal(paused?.status, "paused");

    await db.prepare("DELETE FROM watched_products WHERE id = '8150288'").run();
    await seed(db, "8150288", 5, "8150288");
    await refreshAfter(async () => {
      await db.prepare("UPDATE watched_products SET target_price = 99 WHERE id = '8150288'").run();
    });
    assert.equal(await priceOf(db, "8150288"), 5);
    const target = await db.prepare("SELECT target_price AS target FROM watched_products WHERE id = '8150288'")
      .first<{ target: number }>();
    assert.equal(target?.target, 99);

    await db.prepare("DELETE FROM watched_products WHERE id = '8150288'").run();
    await seed(db, "8150288", 5, "8150288");
    await refreshAfter(async () => {
      await db.prepare("UPDATE watched_products SET current_price = 4 WHERE id = '8150288'").run();
    });
    assert.equal(await priceOf(db, "8150288"), 4);

    const product = {
      retailerProductId: "race-sku",
      name: "Coles Full Cream Milk",
      brand: null,
      size: null,
      productUrl: MILK_URL,
      imageUrl: null,
      currentPrice: 4.95,
      regularPrice: 5,
      promotionType: "unknown",
      promotionKind: "unknown",
      inStock: true,
      availabilityKnown: true,
      sourceTimestamp: null,
      echoedStoreId: "4166",
      notificationEligible: false as const,
      quoteUse: "review_only" as const,
      storePrice: "store_price_unverified" as const,
    };
    const copy = { sourceLabel: "Omkar Hosted API", priceNote: "API 报告价，不是 Coles 官方核验价。" };
    await Promise.all([
      saveProduct({ DB: db } as Env, product, copy, undefined, true),
      saveProduct({ DB: db } as Env, product, copy, undefined, true),
    ]);
    const rows = await db.prepare("SELECT id FROM watched_products WHERE retailer_product_id = 'race-sku'").all<{ id: string }>();
    assert.equal(rows.results.length, 1);
    const winner = rows.results[0]?.id;
    assert.equal(
      await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id != ?", winner),
      0,
    );
  } finally {
    await price.dispose();
  }
});

test("import keeps a newer price committed during the provider call", { timeout: 180000 }, async () => {
  const price = await localD1("import-stale", resolve(here, "../migrations"), priceMigrations);
  const db = price.db;
  const env = { DB: db } as Env;
  const original = globalThis.fetch;
  try {
    await seed(db, "milk", 5, "8150288");
    await setTelegramAlerts(env, true, "2026-11-28T01:00:00.000Z");
    let providerCalls = 0;
    globalThis.fetch = async (resource: RequestInfo | URL) => {
      const raw = typeof resource === "string" ? resource : resource instanceof URL ? resource.toString() : resource.url;
      const url = new URL(raw);
      if (url.hostname !== "best-coles-scraper-free-1000-calls.p.rapidapi.com") {
        throw new Error(`blocked outbound host ${url.hostname}`);
      }
      providerCalls += 1;
      assert.equal(await commitWatchedPrice(env, input({
        productId: "milk",
        price: 6,
        previousPrice: 5,
        expectedRevision: 0,
        observationKey: "dddddddd-dddd-4ddd-8ddd-ddddddddddd4",
        at: "2026-11-28T03:00:00.000Z",
        live: true,
      })), "committed");
      return new Response(JSON.stringify({
        id: 8150288,
        name: "Coles Full Cream Milk",
        brand: "Coles",
        size: "3L",
        link: MILK_URL,
        is_available: true,
        store_id: "4166",
        pricing: { currency: "AUD", price: 4.95, is_on_special: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const response = await app.fetch(new Request("http://127.0.0.1/api/v1/products/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: MILK_URL }),
    }), {
      DB: db,
      OMKAR_API_KEY: "not-a-real-omkar-key",
      ASSETS: { fetch: async () => new Response("asset") },
    } as unknown as Env, ctx());
    assert.equal(providerCalls, 1);
    assert.equal(response.status, 409);
    const body = await response.json() as { ok: boolean; outcome: string };
    assert.equal(body.ok, false);
    assert.equal(body.outcome, "stale");
    assert.equal(await priceOf(db, "milk"), 6);
    const revision = await db.prepare("SELECT revision FROM watched_products WHERE id = 'milk'")
      .first<{ revision: number }>();
    assert.equal(revision?.revision, 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions WHERE product_id = 'milk' AND price = 4.95"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM notification_outbox WHERE status = 'queued'"), 0);
  } finally {
    globalThis.fetch = original;
    await price.dispose();
  }
});

test("delivery ledger keeps an active claim and does not resend after a crash", { timeout: 180000 }, async () => {
  const telegram = await localD1("ledger", resolve(here, "../../telegram/migrations"), telegramMigrations);
  const price = await localD1("ledgerprice", resolve(here, "../migrations"), priceMigrations);
  const telegramEnv: TelegramEnv = {
    DB: telegram.db,
    TELEGRAM_BOT_TOKEN: "123456:THIS_IS_A_FAKE_LOCAL_TEST_TOKEN_abcdef",
    TELEGRAM_WEBHOOK_SECRET: "this_is_a_local_test_secret_1234567890",
    TELEGRAM_OWNER_USER_ID: "123456789",
    TELEGRAM_OWNER_CHAT_ID: "123456789",
  };
  const alert = {
    transitionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    productName: "Coles Full Cream Milk",
    storeId: "4166",
    previousPrice: 5,
    currentPrice: 3,
    targetPrice: null,
    priceDrop: true as const,
    targetCrossed: false,
    observedAt: "2026-11-28T07:30:00.000Z",
    productUrl: MILK_URL,
  };
  try {
    let release: () => void = () => {};
    const releaseSend = new Promise<void>((resolveSend) => {
      release = resolveSend;
    });
    let entered = false;
    const firstInside = new Promise<void>((resolveInside) => {
      const timer = setInterval(() => {
        if (entered) {
          clearInterval(timer);
          resolveInside();
        }
      }, 5);
    });
    let sends = 0;
    const first = deliverOwnerAlert(telegramEnv, alert, async () => {
      sends += 1;
      entered = true;
      await releaseSend;
      return "sent";
    });
    await firstInside;
    const duplicate = await deliverOwnerAlert(telegramEnv, alert, async () => {
      sends += 1;
      return "sent";
    });
    const during = await telegram.db.prepare("SELECT status FROM telegram_alert_deliveries WHERE transition_id = ?")
      .bind(alert.transitionId)
      .first<{ status: string }>();
    assert.equal(duplicate.state, "unknown");
    assert.equal(during?.status, "claimed");
    release();
    const winner = await first;
    const after = await telegram.db.prepare("SELECT status FROM telegram_alert_deliveries WHERE transition_id = ?")
      .bind(alert.transitionId)
      .first<{ status: string }>();
    assert.equal(sends, 1);
    assert.equal(winner.state, "sent");
    assert.equal(after?.status, "sent");

    await seed(price.db, "milk", 3);
    await setTelegramAlerts({ DB: price.db } as Env, true, "2026-11-28T01:00:00.000Z");
    await price.db.prepare(
      `INSERT INTO price_transitions (
        id, observation_key, product_id, store_id, product_name, product_url,
        previous_price, price, target_price, price_drop, target_crossed, observed_at, created_at
      ) VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'milk', '4166',
        'Coles Full Cream Milk', ?, 5, 3, NULL, 1, 0, '2026-11-28T08:00:00.000Z', '2026-11-28T08:00:00.000Z')`,
    ).bind(MILK_URL).run();
    await price.db.prepare(
      `INSERT INTO notification_outbox (transition_id, status, created_at, updated_at)
       VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'sending', '2026-11-28T08:00:00.000Z', '2026-11-28T08:00:00.000Z')`,
    ).run();
    const crashSends: string[] = [];
    await dispatchOutbox({
      DB: price.db,
      TELEGRAM_ALERTS: {
        async deliver() {
          crashSends.push("sent");
          return { state: "sent", claimed: true };
        },
      },
    } as unknown as Env);
    const crashed = await price.db.prepare("SELECT status FROM notification_outbox WHERE transition_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'")
      .first<{ status: string }>();
    assert.equal(crashSends.length, 0);
    assert.equal(crashed?.status, "unknown");

    const epoch = await price.db.prepare("SELECT epoch FROM owner_alert_preference WHERE id = 1")
      .first<{ epoch: number }>();
    await price.db.prepare(
      `INSERT INTO price_transitions (
        id, observation_key, product_id, store_id, product_name, product_url,
        previous_price, price, target_price, price_drop, target_crossed, observed_at, created_at
      ) VALUES ('ffffffff-ffff-4fff-8fff-fffffffffff1', 'ffffffff-ffff-4fff-8fff-fffffffffff1', 'milk', '4166',
        'Coles Full Cream Milk', ?, 5, 3, NULL, 1, 0, '2026-11-28T08:10:00.000Z', '2026-11-28T08:10:00.000Z')`,
    ).bind(MILK_URL).run();
    await price.db.prepare(
      `INSERT INTO notification_outbox (transition_id, status, consent_epoch, claim_token, lease_until, created_at, updated_at)
       VALUES ('ffffffff-ffff-4fff-8fff-fffffffffff1', 'sending', ?, 'active-token', '2099-01-01T00:00:00.000Z',
        '2026-11-28T08:10:00.000Z', '2026-11-28T08:10:00.000Z')`,
    ).bind(epoch?.epoch ?? 0).run();
    const activeSends: string[] = [];
    await dispatchOutbox({
      DB: price.db,
      TELEGRAM_ALERTS: {
        async deliver() {
          activeSends.push("sent");
          return { state: "sent", claimed: true };
        },
      },
    } as unknown as Env);
    const active = await price.db.prepare(
      "SELECT status FROM notification_outbox WHERE transition_id = 'ffffffff-ffff-4fff-8fff-fffffffffff1'",
    ).first<{ status: string }>();
    assert.equal(activeSends.length, 0);
    assert.equal(active?.status, "sending");

    const flakyId = "ffffffff-ffff-4fff-8fff-fffffffffff2";
    let terminalSends = 0;
    const flakyDb = {
      prepare(sql: string) {
        const statement = telegram.db.prepare(sql);
        if (sql.includes("AND claim_token = ?")) {
          return {
            bind() {
              return {
                async run() {
                  throw new Error("terminal write failed");
                },
              };
            },
          };
        }
        return statement;
      },
      batch: telegram.db.batch.bind(telegram.db),
      exec: telegram.db.exec.bind(telegram.db),
    } as D1Database;
    const flakyAlert = { ...alert, transitionId: flakyId };
    const failedWrite = await deliverOwnerAlert({ ...telegramEnv, DB: flakyDb }, flakyAlert, async () => {
      terminalSends += 1;
      return "sent";
    });
    assert.equal(failedWrite.state, "unknown");
    assert.equal(terminalSends, 1);
    const stuck = await telegram.db.prepare("SELECT status FROM telegram_alert_deliveries WHERE transition_id = ?")
      .bind(flakyId)
      .first<{ status: string }>();
    assert.equal(stuck?.status, "claimed");
    const replayed = await deliverOwnerAlert(telegramEnv, flakyAlert, async () => {
      terminalSends += 1;
      return "sent";
    });
    assert.equal(replayed.state, "unknown");
    assert.equal(terminalSends, 1);
    const reconciled = await deliverOwnerAlert(telegramEnv, flakyAlert, async () => {
      terminalSends += 1;
      return "sent";
    }, new Date("2099-01-01T00:00:00.000Z"));
    assert.equal(reconciled.state, "unknown");
    assert.equal(terminalSends, 1);
    const settled = await telegram.db.prepare("SELECT status FROM telegram_alert_deliveries WHERE transition_id = ?")
      .bind(flakyId)
      .first<{ status: string }>();
    assert.equal(settled?.status, "unknown");

    const inflight = "ffffffff-ffff-4fff-8fff-fffffffffff3";
    const liveEpoch = await price.db.prepare("SELECT epoch FROM owner_alert_preference WHERE id = 1")
      .first<{ epoch: number }>();
    await price.db.prepare(
      `INSERT INTO price_transitions (
        id, observation_key, product_id, store_id, product_name, product_url,
        previous_price, price, target_price, price_drop, target_crossed, observed_at, created_at
      ) VALUES (?, ?, 'milk', '4166', 'Coles Full Cream Milk', ?, 5, 3, NULL, 1, 0,
        '2026-11-28T08:20:00.000Z', '2026-11-28T08:20:00.000Z')`,
    ).bind(inflight, inflight, MILK_URL).run();
    await price.db.prepare(
      `INSERT INTO notification_outbox (transition_id, status, consent_epoch, created_at, updated_at)
       VALUES (?, 'queued', ?, '2026-11-28T08:20:00.000Z', '2026-11-28T08:20:00.000Z')`,
    ).bind(inflight, liveEpoch?.epoch ?? 0).run();
    const priceEnv = { DB: price.db } as Env;
    await dispatchOutbox({
      ...priceEnv,
      TELEGRAM_ALERTS: {
        async deliver() {
          await setTelegramAlerts(priceEnv, false, "2026-11-28T08:21:00.000Z");
          return { state: "sent", claimed: true };
        },
      },
    } as unknown as Env);
    const kept = await price.db.prepare("SELECT status FROM notification_outbox WHERE transition_id = ?")
      .bind(inflight)
      .first<{ status: string }>();
    assert.equal(kept?.status, "sent");
  } finally {
    await Promise.all([telegram.dispose(), price.dispose()]);
  }
});
