import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deliverOwnerAlert } from "../../telegram/src/alerts.js";
import type { TelegramEnv } from "../../telegram/src/index.js";
import { DISPATCH_LIMIT, dispatchOutbox, setTelegramAlerts } from "./alerts.js";
import type { TelegramAlert } from "./alert-types.js";
import type { Env } from "./catalogue.js";
import { commitWatchedPrice, type CommitInput } from "./commit.js";
import app from "./index.js";
import { reportedPrice, runScheduled } from "./monitor.js";
import { saveProduct } from "./watch.js";

const require = createRequire(import.meta.url);
const { getPlatformProxy } = require("wrangler") as {
  getPlatformProxy: (options: {
    configPath: string;
    persist: { path: string };
  }) => Promise<{ env: { DB: D1Database }; dispose: () => Promise<void> }>;
};

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = "123456:THIS_IS_A_FAKE_LOCAL_TEST_TOKEN_abcdef";
const SECRET = "this_is_a_local_test_secret_1234567890";
const OWNER = "123456789";
const MILK_URL = "https://www.coles.com.au/product/coles-full-cream-milk-8150288";

function ctx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

async function localD1(name: string, migrationDir: string, files: string[]) {
  const root = await mkdtemp(resolve(tmpdir(), `easypws-${name}-`));
  await writeFile(
    resolve(root, "worker.ts"),
    "export default { fetch() { return new Response('ok'); } };\n",
  );
  await writeFile(resolve(root, "wrangler.json"), JSON.stringify({
    name: `easypws-${name}`,
    main: "./worker.ts",
    compatibility_date: "2026-11-24",
    d1_databases: [{
      binding: "DB",
      database_name: name,
      database_id: name === "price" ? "00000000-0000-0000-0000-0000000000a1" : "00000000-0000-0000-0000-0000000000a2",
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
      await proxy.dispose();
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
    sourceTimestamp: "2026-11-28T01:00:00.000Z",
    targetPrice: 4,
    live: true,
    at: "2026-11-28T02:00:00.000Z",
    observationKey: crypto.randomUUID(),
    day: "2026-11-28",
    expectedRevision: 0,
    ...overrides,
  };
}

async function seed(
  db: D1Database,
  id: string,
  price: number | null,
  status = "active",
  target: number | null = 4,
): Promise<void> {
  await db.prepare(
    `INSERT INTO watched_products (
      id, retailer_product_id, store_id, name, product_url, current_price, target_price,
      promotion_type, promotion_kind, in_stock, availability_known, source_label, price_note,
      monitoring_status, notification_eligible, created_at
    ) VALUES (?, ?, '4166', 'Coles Full Cream Milk', ?, ?, ?, 'unknown', 'unknown', 1, 1,
      'Omkar Hosted API', 'note', ?, 0, '2026-11-01T00:00:00.000Z')`,
  ).bind(id, id, MILK_URL, price, target, status).run();
}

async function count(db: D1Database, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ n: number }>();
  return row?.n ?? 0;
}

test("local D1 commits transitions atomically and delivers once", { timeout: 180000 }, async () => {
  const price = await localD1("price", resolve(here, "../migrations"), [
    "0001_watch.sql",
    "0002_monitor.sql",
    "0003_alert_outbox.sql",
    "0004_alert_consistency.sql",
  ]);
  const telegram = await localD1("telegram", resolve(here, "../../telegram/migrations"), [
    "0001_webhook_receipts.sql",
    "0002_alert_deliveries.sql",
    "0003_alert_lease.sql",
  ]);
  const db = price.db;
  const telegramEnv: TelegramEnv = {
    DB: telegram.db,
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_OWNER_USER_ID: OWNER,
    TELEGRAM_OWNER_CHAT_ID: OWNER,
  };
  const sends: string[] = [];
  const binding = {
    async deliver(alert: TelegramAlert) {
      return deliverOwnerAlert(telegramEnv, alert, async (text) => {
        sends.push(text);
        return "sent";
      });
    },
  };
  const env = { DB: db, TELEGRAM_ALERTS: binding } as Env;
  try {
    const preference = await db.prepare("SELECT enabled FROM owner_alert_preference WHERE id = 1")
      .first<{ enabled: number }>();
    assert.equal(preference?.enabled, 0);

    await db.prepare(
      `INSERT INTO alert_events (
        id, product_id, kind, previous_price, price, target_price, dedupe_key, created_at
      ) VALUES ('old', 'milk', 'price_drop', 5, 3, 4, 'milk|price_drop|5.00|3.00|4.00', '2026-01-01T00:00:00.000Z')`,
    ).run();

    await seed(db, "rollback", 5);
    await assert.rejects(() => db.batch([
      db.prepare("UPDATE watched_products SET current_price = 1 WHERE id = 'rollback'"),
      db.prepare(
        "INSERT INTO price_observations (product_id, observed_at, price, promotion_type, observation_key) VALUES ('rollback', 't1', 1, 'unknown', 'same-key')",
      ),
      db.prepare(
        "INSERT INTO price_observations (product_id, observed_at, price, promotion_type, observation_key) VALUES ('rollback', 't2', 1, 'unknown', 'same-key')",
      ),
    ]));
    const rolled = await db.prepare("SELECT current_price AS price FROM watched_products WHERE id = 'rollback'")
      .first<{ price: number }>();
    assert.equal(rolled?.price, 5);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = 'rollback'"), 0);

    await seed(db, "milk", 5);
    const first = input({ observationKey: "11111111-1111-4111-8111-111111111111", at: "2026-11-28T02:00:00.000Z" });
    assert.equal(await commitWatchedPrice(env, first), "committed");
    assert.equal(await commitWatchedPrice(env, first), "stale");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions"), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM alert_events WHERE dedupe_key = 'milk|price_drop|5.00|3.00|4.00'"), 1);
    const suppressed = await db.prepare("SELECT status FROM notification_outbox WHERE transition_id = ?")
      .bind(first.observationKey)
      .first<{ status: string }>();
    assert.equal(suppressed?.status, "suppressed");

    await setTelegramAlerts(env, true, "2026-11-28T03:00:00.000Z");
    const stillSuppressed = await db.prepare("SELECT status FROM notification_outbox WHERE transition_id = ?")
      .bind(first.observationKey)
      .first<{ status: string }>();
    assert.equal(stillSuppressed?.status, "suppressed");

    assert.equal(await commitWatchedPrice(env, input({
      previousPrice: 3,
      price: 5,
      at: "2026-11-28T04:00:00.000Z",
      observationKey: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 1,
    })), "committed");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions"), 1);

    const second = input({
      previousPrice: 5,
      price: 3,
      at: "2026-11-28T05:00:00.000Z",
      observationKey: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 2,
    });
    assert.equal(await commitWatchedPrice(env, second), "committed");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions"), 2);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM alert_events WHERE product_id = 'milk' AND kind = 'price_drop'"), 3);
    const queued = await db.prepare("SELECT status FROM notification_outbox WHERE transition_id = ?")
      .bind(second.observationKey)
      .first<{ status: string }>();
    assert.equal(queued?.status, "queued");
    const merged = await db.prepare("SELECT price_drop, target_crossed FROM price_transitions WHERE id = ?")
      .bind(second.observationKey)
      .first<{ price_drop: number; target_crossed: number }>();
    assert.equal(merged?.price_drop, 1);
    assert.equal(merged?.target_crossed, 1);
    assert.equal(await commitWatchedPrice(env, input({
      previousPrice: 3,
      price: 3,
      at: "2026-11-28T05:05:00.000Z",
      observationKey: "abababab-abab-4bab-8bab-abababababab",
      expectedRevision: 3,
    })), "committed");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions"), 2);

    await seed(db, "fresh", null);
    assert.equal(await commitWatchedPrice(env, input({
      productId: "fresh",
      previousPrice: null,
      price: 4.95,
      at: "2026-11-28T05:10:00.000Z",
      observationKey: "44444444-4444-4444-8444-444444444444",
    })), "committed");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions WHERE product_id = 'fresh'"), 0);

    await seed(db, "fixture", 6.5, "active", 5);
    assert.equal(await commitWatchedPrice(env, input({
      productId: "fixture",
      previousPrice: 6.5,
      price: 4.95,
      targetPrice: 5,
      live: false,
      sourceLabel: "本地示例",
      at: "2026-11-28T05:20:00.000Z",
      observationKey: "55555555-5555-4555-8555-555555555555",
    })), "committed");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions WHERE product_id = 'fixture'"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM alert_events WHERE product_id = 'fixture'"), 2);

    await seed(db, "paused", 9, "paused");
    assert.equal(await commitWatchedPrice(env, input({
      productId: "paused",
      previousPrice: 9,
      at: "2026-11-28T05:30:00.000Z",
      observationKey: "66666666-6666-4666-8666-666666666666",
    })), "stale");
    const pausedPrice = await db.prepare("SELECT current_price AS price FROM watched_products WHERE id = 'paused'")
      .first<{ price: number }>();
    assert.equal(pausedPrice?.price, 9);

    await seed(db, "retarget", 5, "active", 10);
    assert.equal(await commitWatchedPrice(env, input({
      productId: "retarget",
      previousPrice: 5,
      price: 3,
      targetPrice: 4,
      at: "2026-11-28T05:31:00.000Z",
      observationKey: "12121212-1212-4121-8121-121212121212",
    })), "stale");
    const retarget = await db.prepare("SELECT current_price AS price FROM watched_products WHERE id = 'retarget'")
      .first<{ price: number }>();
    assert.equal(retarget?.price, 5);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions WHERE product_id = 'retarget'"), 0);

    await seed(db, "sametime", 5, "active", 4);
    const sameAt = "2026-11-28T05:32:00.000Z";
    const same = await Promise.all([
      commitWatchedPrice(env, input({
        productId: "sametime",
        previousPrice: 5,
        price: 3,
        at: sameAt,
        observationKey: "13131313-1313-4131-8131-131313131313",
      })),
      commitWatchedPrice(env, input({
        productId: "sametime",
        previousPrice: 5,
        price: 3,
        at: sameAt,
        observationKey: "14141414-1414-4141-8141-141414141414",
      })),
    ]);
    assert.equal(same.filter((item) => item === "committed").length, 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions WHERE product_id = 'sametime'"), 1);

    const raced = await Promise.all([
      commitWatchedPrice(env, input({
        productId: "fresh",
        previousPrice: 4.95,
        price: 4,
        live: false,
        at: "2026-11-28T05:40:00.000Z",
        observationKey: "77777777-7777-4777-8777-777777777777",
        expectedRevision: 1,
      })),
      commitWatchedPrice(env, input({
        productId: "fresh",
        previousPrice: 4.95,
        price: 2,
        live: false,
        at: "2026-11-28T05:41:00.000Z",
        observationKey: "88888888-8888-4888-8888-888888888888",
        expectedRevision: 1,
      })),
    ]);
    assert.equal(raced.filter((item) => item === "committed").length, 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions WHERE product_id = 'fresh'"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = 'fresh'"), 2);

    assert.equal(sends.length, 0);
    const dispatched = await dispatchOutbox(env);
    assert.equal(dispatched.inspected, 2);
    assert.equal(sends.length, 2);
    assert.match(sends[0] ?? "", /A\$5\.00 → A\$3\.00/);
    assert.match(sends[0] ?? "", /已达到目标价 A\$4\.00/);
    assert.equal((sends[0] ?? "").includes(OWNER), false);
    assert.equal(await count(telegram.db, "SELECT COUNT(*) AS n FROM telegram_alert_deliveries WHERE status = 'sent'"), 2);
    await dispatchOutbox(env);
    assert.equal(sends.length, 2);

    await setTelegramAlerts(env, false, "2026-11-28T06:00:00.000Z");
    await db.prepare(
      `INSERT INTO price_transitions (
        id, observation_key, product_id, store_id, product_name, product_url,
        previous_price, price, target_price, price_drop, target_crossed, observed_at, created_at
      ) VALUES ('99999999-9999-4999-8999-999999999999', '99999999-9999-4999-8999-999999999999', 'milk', '4166',
        'Coles Full Cream Milk', ?, 8, 6, NULL, 1, 0, '2026-11-28T06:01:00.000Z', '2026-11-28T06:01:00.000Z')`,
    ).bind(MILK_URL).run();
    await db.prepare(
      `INSERT INTO notification_outbox (transition_id, status, created_at, updated_at)
       VALUES ('99999999-9999-4999-8999-999999999999', 'queued', '2026-11-28T06:01:00.000Z', '2026-11-28T06:01:00.000Z')`,
    ).run();
    await dispatchOutbox(env);
    assert.equal(sends.length, 2);
    const optedOut = await db.prepare("SELECT status FROM notification_outbox WHERE transition_id = '99999999-9999-4999-8999-999999999999'")
      .first<{ status: string }>();
    assert.equal(optedOut?.status, "suppressed");
    const attemptsBeforeRefresh = await count(db, "SELECT COUNT(*) AS n FROM monitor_attempts");
    await saveProduct(env, {
      retailerProductId: "sametime",
      name: "Coles Full Cream Milk",
      brand: null,
      size: null,
      productUrl: MILK_URL,
      imageUrl: null,
      currentPrice: 2,
      regularPrice: 5,
      promotionType: "unknown",
      promotionKind: "unknown",
      inStock: true,
      availabilityKnown: true,
      sourceTimestamp: null,
      echoedStoreId: "4166",
      notificationEligible: false,
      quoteUse: "review_only",
      storePrice: "store_price_unverified",
    }, { sourceLabel: "Omkar Hosted API", priceNote: "API 报告价，不是 Coles 官方核验价。" }, undefined, true);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions WHERE product_id = 'sametime'"), 2);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM monitor_attempts"), attemptsBeforeRefresh);
    const refreshed = await db.prepare(
      `SELECT o.status FROM notification_outbox o
       JOIN price_transitions t ON t.id = o.transition_id
       WHERE t.product_id = 'sametime'
       ORDER BY o.created_at DESC LIMIT 1`,
    ).first<{ status: string }>();
    assert.equal(refreshed?.status, "suppressed");

    const lostId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let lostSends = 0;
    const lost = await deliverOwnerAlert(telegramEnv, {
      transitionId: lostId,
      productName: "Coles Full Cream Milk",
      storeId: "4166",
      previousPrice: 5,
      currentPrice: 3,
      targetPrice: null,
      priceDrop: true,
      targetCrossed: false,
      observedAt: "2026-11-28T07:00:00.000Z",
      productUrl: MILK_URL,
    }, async () => {
      lostSends += 1;
      throw new Error("response lost");
    });
    assert.equal(lost.state, "unknown");
    assert.equal(lost.claimed, true);
    const replay = await deliverOwnerAlert(telegramEnv, {
      transitionId: lostId,
      productName: "Coles Full Cream Milk",
      storeId: "4166",
      previousPrice: 5,
      currentPrice: 3,
      targetPrice: null,
      priceDrop: true,
      targetCrossed: false,
      observedAt: "2026-11-28T07:00:00.000Z",
      productUrl: MILK_URL,
    }, async () => {
      lostSends += 1;
      return "sent";
    });
    assert.equal(replay.state, "unknown");
    assert.equal(lostSends, 1);

    const failedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let failedSends = 0;
    const failed = await deliverOwnerAlert(telegramEnv, {
      transitionId: failedId,
      productName: "Coles Full Cream Milk",
      storeId: "4166",
      previousPrice: 5,
      currentPrice: 3,
      targetPrice: null,
      priceDrop: true,
      targetCrossed: false,
      observedAt: "2026-11-28T07:10:00.000Z",
      productUrl: MILK_URL,
    }, async () => {
      failedSends += 1;
      return "failed";
    });
    assert.equal(failed.state, "failed");
    await deliverOwnerAlert(telegramEnv, {
      transitionId: failedId,
      productName: "Coles Full Cream Milk",
      storeId: "4166",
      previousPrice: 5,
      currentPrice: 3,
      targetPrice: null,
      priceDrop: true,
      targetCrossed: false,
      observedAt: "2026-11-28T07:10:00.000Z",
      productUrl: MILK_URL,
    }, async () => {
      failedSends += 1;
      return "sent";
    });
    assert.equal(failedSends, 1);
    const timeoutId = "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc";
    let timeoutSends = 0;
    const timedOut = await deliverOwnerAlert(telegramEnv, {
      transitionId: timeoutId,
      productName: "Coles Full Cream Milk",
      storeId: "4166",
      previousPrice: 5,
      currentPrice: 3,
      targetPrice: null,
      priceDrop: true,
      targetCrossed: false,
      observedAt: "2026-11-28T07:12:00.000Z",
      productUrl: MILK_URL,
    }, async () => {
      timeoutSends += 1;
      return "unknown";
    });
    assert.equal(timedOut.state, "unknown");
    assert.equal(timedOut.claimed, true);
    await deliverOwnerAlert(telegramEnv, {
      transitionId: timeoutId,
      productName: "Coles Full Cream Milk",
      storeId: "4166",
      previousPrice: 5,
      currentPrice: 3,
      targetPrice: null,
      priceDrop: true,
      targetCrossed: false,
      observedAt: "2026-11-28T07:12:00.000Z",
      productUrl: MILK_URL,
    }, async () => {
      timeoutSends += 1;
      return "sent";
    });
    assert.equal(timeoutSends, 1);

    const invalid = await deliverOwnerAlert(telegramEnv, { ...{
      transitionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      productName: "Coles Full Cream Milk",
      storeId: "4166",
      previousPrice: 5,
      currentPrice: 3,
      targetPrice: null,
      priceDrop: true,
      targetCrossed: false,
      observedAt: "2026-11-28T07:20:00.000Z",
      productUrl: MILK_URL,
    }, chatId: OWNER }, async () => {
      throw new Error("invalid DTO must not send");
    });
    assert.equal(invalid.state, "failed");
    assert.equal(invalid.claimed, false);

    let concurrentSends = 0;
    const concurrentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const concurrentAlert = {
      transitionId: concurrentId,
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
    await Promise.all([
      deliverOwnerAlert(telegramEnv, concurrentAlert, async () => {
        concurrentSends += 1;
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 20));
        return "sent";
      }),
      deliverOwnerAlert(telegramEnv, concurrentAlert, async () => {
        concurrentSends += 1;
        return "sent";
      }),
    ]);
    assert.equal(concurrentSends, 1);

    const missing = { DB: db } as Env;
    await setTelegramAlerts(missing, true, "2026-11-28T08:00:00.000Z");
    const currentEpoch = await db.prepare("SELECT epoch FROM owner_alert_preference WHERE id = 1")
      .first<{ epoch: number }>();
    await db.prepare(
      `UPDATE notification_outbox
       SET status = 'queued', consent_epoch = ?, updated_at = '2026-11-28T08:00:00.000Z'
       WHERE transition_id = ?`,
    ).bind(currentEpoch?.epoch ?? 0, second.observationKey).run();
    await dispatchOutbox(missing);
    const leftQueued = await db.prepare("SELECT status FROM notification_outbox WHERE transition_id = ?")
      .bind(second.observationKey)
      .first<{ status: string }>();
    assert.equal(leftQueued?.status, "queued");

    for (let index = 0; index < DISPATCH_LIMIT + 1; index += 1) {
      const key = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO price_transitions (
          id, observation_key, product_id, store_id, product_name, product_url,
          previous_price, price, target_price, price_drop, target_crossed, observed_at, created_at
        ) VALUES (?, ?, 'milk', '4166', 'Coles Full Cream Milk', ?, 9, 8, NULL, 1, 0, ?, ?)`,
      ).bind(key, key, MILK_URL, `2026-11-28T09:00:0${index}.000Z`, `2026-11-28T09:00:0${index}.000Z`).run();
      await db.prepare(
        `INSERT INTO notification_outbox (transition_id, status, consent_epoch, created_at, updated_at)
         VALUES (?, 'queued', ?, ?, ?)`,
      ).bind(key, currentEpoch?.epoch ?? 0, `2026-11-28T09:00:0${index}.000Z`, `2026-11-28T09:00:0${index}.000Z`).run();
    }
    const bounded = await dispatchOutbox(env);
    assert.equal(bounded.inspected, DISPATCH_LIMIT);

    const httpEnv = { DB: db, ASSETS: { fetch: async () => new Response("asset") } } as unknown as Env;
    const denied = await app.fetch(new Request("http://127.0.0.1/api/v1/notifications/telegram/send", { method: "POST" }), httpEnv, ctx());
    assert.equal(denied.status, 404);
    const unacked = await app.fetch(new Request("http://127.0.0.1/api/v1/notifications/telegram", {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    }), httpEnv, ctx());
    assert.equal(unacked.status, 400);
    const enabled = await app.fetch(new Request("http://127.0.0.1/api/v1/notifications/telegram", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, acknowledged: true }),
    }), httpEnv, ctx());
    assert.equal(enabled.status, 200);
    assert.equal((await enabled.json() as { enabled: boolean }).enabled, true);
    const status = await app.fetch(new Request("http://127.0.0.1/api/v1/notifications/telegram"), httpEnv, ctx());
    assert.equal((await status.json() as { enabled: boolean }).enabled, true);

    let sawOutbox = false;
    const failingDb = {
      prepare(sql: string) {
        if (sql.includes("notification_outbox")) {
          sawOutbox = true;
        }
        if (sql.includes("monitor_attempts WHERE day")) {
          throw new Error("monitor unavailable");
        }
        return db.prepare(sql);
      },
      batch: db.batch.bind(db),
      exec: db.exec.bind(db),
    } as D1Database;
    await assert.rejects(() => runScheduled({ DB: failingDb } as Env));
    assert.equal(sawOutbox, true);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM provider_calls"), 0);
  } finally {
    await Promise.race([
      Promise.all([price.dispose(), telegram.dispose()]),
      new Promise((resolveSleep) => setTimeout(resolveSleep, 4000)),
    ]);
  }
});

test("invalid or unpriced reports do not become alert prices", () => {
  const product = {
    retailerProductId: "8150288",
    name: "Milk",
    brand: null,
    size: null,
    productUrl: MILK_URL,
    imageUrl: null,
    currentPrice: 4.95,
    regularPrice: null,
    promotionType: "unknown",
    promotionKind: "unknown",
    inStock: true,
    availabilityKnown: false,
    sourceTimestamp: null,
    echoedStoreId: "4166",
    notificationEligible: false as const,
    quoteUse: "review_only" as const,
    storePrice: "store_price_unverified" as const,
  };
  assert.equal(reportedPrice(product), 4.95);
  assert.equal(reportedPrice({ ...product, quoteUse: "unpriced", storePrice: "not_a_quote", currentPrice: null }), null);
  assert.equal(reportedPrice({ ...product, currentPrice: Number.NaN }), null);
  assert.equal(reportedPrice({ ...product, currentPrice: -1 }), null);
});

test("staged config keeps one Cron and a private Telegram entrypoint", async () => {
  const lite = await readFile(resolve(here, "../wrangler.jsonc"), "utf8");
  const telegramConfig = await readFile(resolve(here, "../../telegram/wrangler.jsonc"), "utf8");
  const worker = await readFile(resolve(here, "../../telegram/src/worker.ts"), "utf8");
  assert.match(lite, /"crons": \["0 22 \* \* \*"\]/);
  assert.equal(lite.includes("AlertDelivery"), true);
  assert.equal(lite.slice(0, lite.indexOf("\"env\"")).includes("\"services\""), false);
  assert.equal(telegramConfig.includes("crons"), false);
  assert.equal(telegramConfig.includes("OMKAR_API_KEY"), false);
  assert.equal(telegramConfig.includes("cf8c92cf-939f-4535-b47b-95e687a8a99a"), false);
  assert.match(worker, /export class AlertDelivery/);
  assert.equal(worker.includes("api.telegram.org"), false);
});
