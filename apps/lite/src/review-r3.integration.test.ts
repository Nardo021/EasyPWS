import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { MappedOmkarProduct } from "@easypws/adapters/omkar";
import { setTelegramAlerts } from "./alerts.js";
import type { Env } from "./catalogue.js";
import { commitWatchedPrice, type CommitInput } from "./commit.js";
import { removeItem, saveProduct, setStatus } from "./watch.js";

const require = createRequire(import.meta.url);
const { getPlatformProxy } = require("wrangler") as {
  getPlatformProxy: (options: {
    configPath: string;
    persist: { path: string };
  }) => Promise<{ env: { DB: D1Database }; dispose: () => Promise<void> }>;
};

const here = dirname(fileURLToPath(import.meta.url));
const MILK_URL = "https://www.coles.com.au/product/coles-full-cream-milk-8150288";
const copy = { sourceLabel: "Omkar Hosted API", priceNote: "API 报告价，不是 Coles 官方核验价。" };
const priceMigrations = ["0001_watch.sql", "0002_monitor.sql", "0003_alert_outbox.sql", "0004_alert_consistency.sql"];

function quote(sku: string, price: number | null): MappedOmkarProduct {
  const priced = price !== null;
  return {
    retailerProductId: sku,
    name: "Coles Full Cream Milk",
    brand: "Coles",
    size: "3L",
    productUrl: MILK_URL,
    imageUrl: null,
    currentPrice: price,
    regularPrice: priced ? 5 : null,
    promotionType: "unknown",
    promotionKind: "unknown",
    inStock: true,
    availabilityKnown: true,
    sourceTimestamp: null,
    echoedStoreId: "4166",
    notificationEligible: false,
    quoteUse: priced ? "review_only" : "unpriced",
    storePrice: priced ? "store_price_unverified" : "not_a_quote",
  };
}

async function localD1(name: string) {
  const root = await mkdtemp(resolve(tmpdir(), `easypws-r3-${name}-`));
  await writeFile(resolve(root, "worker.ts"), "export default { fetch() { return new Response('ok'); } };\n");
  await writeFile(resolve(root, "wrangler.json"), JSON.stringify({
    name: `easypws-r3-${name}`,
    main: "./worker.ts",
    compatibility_date: "2026-11-24",
    d1_databases: [{
      binding: "DB",
      database_name: name,
      database_id: crypto.randomUUID(),
    }],
  }));
  const proxy = await getPlatformProxy({
    configPath: resolve(root, "wrangler.json"),
    persist: { path: resolve(root, "persist") },
  });
  for (const file of priceMigrations) {
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

async function count(db: D1Database, sql: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...values).first<{ n: number }>();
  return row?.n ?? 0;
}

async function seed(db: D1Database, id: string, price: number): Promise<void> {
  await db.prepare(
    `INSERT INTO watched_products (
      id, retailer_product_id, store_id, name, product_url, current_price, target_price,
      promotion_type, promotion_kind, in_stock, availability_known, source_label, price_note,
      monitoring_status, notification_eligible, created_at
    ) VALUES (?, ?, '4166', 'Coles Full Cream Milk', ?, ?, 4, 'unknown', 'unknown', 1, 1,
      'Omkar Hosted API', 'note', 'active', 0, '2026-11-01T00:00:00.000Z')`,
  ).bind(id, id, MILK_URL, price).run();
}

async function ledger(db: D1Database, id: string, productId: string, status: "queued" | "sent"): Promise<void> {
  await db.prepare(
    `INSERT INTO price_transitions (
      id, observation_key, product_id, store_id, product_name, product_url,
      previous_price, price, target_price, price_drop, target_crossed, observed_at, created_at
    ) VALUES (?, ?, ?, '4166', 'Coles Full Cream Milk', ?, 5, 3, 4, 1, 1, '2026-11-28T00:00:00.000Z', '2026-11-28T00:00:00.000Z')`,
  ).bind(id, id, productId, MILK_URL).run();
  await db.prepare(
    "INSERT INTO notification_outbox (transition_id, status, created_at, updated_at) VALUES (?, ?, '2026-11-28T00:00:00.000Z', '2026-11-28T00:00:00.000Z')",
  ).bind(id, status).run();
}

async function statusOf(db: D1Database, id: string): Promise<string | null> {
  const row = await db.prepare("SELECT status FROM notification_outbox WHERE transition_id = ?")
    .bind(id)
    .first<{ status: string }>();
  return row?.status ?? null;
}

function commitInput(productId: string, observationKey: string): CommitInput {
  return {
    productId,
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
    sourceLabel: copy.sourceLabel,
    priceNote: copy.priceNote,
    sourceTimestamp: null,
    targetPrice: 4,
    expectedRevision: 0,
    live: true,
    at: "2026-11-28T02:00:00.000Z",
    observationKey,
    day: "2026-11-28",
  };
}

function traceDb(db: D1Database, match: string, after: () => Promise<void>): D1Database {
  const inner = new WeakMap<object, D1PreparedStatement>();
  let armed = true;
  const wrap = (sql: string, statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, prop, receiver) {
        if (prop === "bind") {
          return (...args: unknown[]) => wrap(sql, target.bind(...(args as never[])));
        }
        if (prop === "run") {
          return async () => {
            const result = await target.run();
            if (armed && sql.includes(match)) {
              armed = false;
              await after();
            }
            return result;
          };
        }
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    inner.set(proxy, statement);
    return proxy as D1PreparedStatement;
  };
  return {
    prepare(sql: string) {
      return wrap(sql, db.prepare(sql));
    },
    batch(statements: D1PreparedStatement[]) {
      return db.batch(statements.map((statement) => inner.get(statement) ?? statement));
    },
    exec(sql: string) {
      return db.exec(sql);
    },
  } as D1Database;
}

test("first priced import keeps the watch row and its first observation together", { timeout: 180000 }, async () => {
  const local = await localD1("import");
  const env = { DB: local.db } as Env;
  try {
    const priced = await saveProduct(env, quote("priced-sku", 4.95), copy, undefined, false, null);
    assert.equal(priced.outcome, "committed");
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = ?", priced.id), 1);
    assert.equal(
      await count(
        local.db,
        `SELECT COUNT(*) AS n FROM watched_products w
         WHERE w.current_price IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM price_observations o WHERE o.product_id = w.id)`,
      ),
      0,
    );

    const unpriced = await saveProduct(env, quote("unpriced-sku", null), copy, undefined, false, null);
    assert.equal(unpriced.outcome, "committed");
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = ?", unpriced.id), 0);

    await local.db.prepare("UPDATE watched_products SET current_price = 6, revision = 1 WHERE id = ?").bind(priced.id).run();
    const loser = await saveProduct(env, quote("priced-sku", 4.95), copy, undefined, false, null);
    assert.equal(loser.outcome, "stale");
    assert.equal(loser.id, priced.id);
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id != ?", priced.id), 0);
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = ?", priced.id), 1);

    await local.db.exec(
      "CREATE TRIGGER abort_initial BEFORE INSERT ON price_observations BEGIN SELECT RAISE(ABORT, 'forced'); END",
    );
    await assert.rejects(() => saveProduct(env, quote("abort-sku", 4.95), copy, undefined, false, null));
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM watched_products WHERE retailer_product_id = 'abort-sku'"), 0);
    assert.equal(
      await count(
        local.db,
        "SELECT COUNT(*) AS n FROM price_observations o LEFT JOIN watched_products p ON p.id = o.product_id WHERE p.id IS NULL",
      ),
      0,
    );
    const stillUnpriced = await saveProduct(env, quote("abort-unpriced-sku", null), copy, undefined, false, null);
    assert.equal(stillUnpriced.outcome, "committed");
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM watched_products WHERE retailer_product_id = 'abort-unpriced-sku'"), 1);
    assert.equal(await count(local.db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = ?", stillUnpriced.id), 0);
  } finally {
    await local.dispose();
  }
});

test("a watch insert cannot be deleted or updated before its first observation", { timeout: 180000 }, async () => {
  const local = await localD1("split-import");
  const db = local.db;
  try {
    const deleting = traceDb(db, "INSERT INTO watched_products", async () => {
      await db.prepare("DELETE FROM watched_products WHERE retailer_product_id = 'split-delete-sku'").run();
    });
    await saveProduct({ DB: deleting } as Env, quote("split-delete-sku", 4.95), copy, undefined, false, null);
    assert.equal(
      await count(db, "SELECT COUNT(*) AS n FROM price_observations o LEFT JOIN watched_products p ON p.id = o.product_id WHERE p.id IS NULL"),
      0,
    );
    const deleted = await db.prepare("SELECT id, current_price AS price, revision FROM watched_products WHERE retailer_product_id = 'split-delete-sku'")
      .first<{ id: string; price: number; revision: number }>();
    assert.ok(deleted);
    assert.equal(deleted.price, 4.95);
    assert.equal(deleted.revision, 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = ?", deleted.id), 1);

    const updating = traceDb(db, "INSERT INTO watched_products", async () => {
      await db.prepare("UPDATE watched_products SET current_price = 9, revision = 1 WHERE retailer_product_id = 'split-update-sku'").run();
    });
    await saveProduct({ DB: updating } as Env, quote("split-update-sku", 4.95), copy, undefined, false, null);
    const updated = await db.prepare("SELECT id, current_price AS price, revision FROM watched_products WHERE retailer_product_id = 'split-update-sku'")
      .first<{ id: string; price: number; revision: number }>();
    assert.ok(updated);
    assert.equal(updated.price, 4.95);
    assert.equal(updated.revision, 0);
    const observed = await db.prepare("SELECT price FROM price_observations WHERE product_id = ?").bind(updated.id).first<{ price: number }>();
    assert.equal(observed?.price, 4.95);
  } finally {
    await local.dispose();
  }
});

test("delete removes history and queued alerts without dropping the delivery audit", { timeout: 180000 }, async () => {
  const local = await localD1("remove");
  const db = local.db;
  const env = { DB: db } as Env;
  try {
    await seed(db, "bread", 2);
    await db.prepare(
      "INSERT INTO price_observations (product_id, observed_at, price, regular_price, promotion_type) VALUES ('bread', '2026-11-28T00:00:00.000Z', 2, 2, 'unknown')",
    ).run();
    await seed(db, "milk", 5);
    await db.prepare(
      "INSERT INTO price_observations (product_id, observed_at, price, regular_price, promotion_type) VALUES ('milk', '2026-11-28T00:00:00.000Z', 5, 5, 'unknown')",
    ).run();
    await db.prepare(
      "INSERT INTO alert_events (id, product_id, kind, previous_price, price, target_price, dedupe_key, created_at) VALUES ('event-milk', 'milk', 'price_drop', 5, 3, 4, 'event-milk', '2026-11-28T00:00:00.000Z')",
    ).run();
    await db.prepare(
      "INSERT INTO alert_events (id, product_id, kind, previous_price, price, target_price, dedupe_key, created_at) VALUES ('event-bread', 'bread', 'price_drop', 3, 2, 4, 'event-bread', '2026-11-28T00:00:00.000Z')",
    ).run();
    await ledger(db, "queued-milk", "milk", "queued");
    await ledger(db, "sent-milk", "milk", "sent");
    await setTelegramAlerts(env, true, "2026-11-28T01:00:00.000Z");

    const splitting = traceDb(db, "DELETE FROM price_observations", async () => {
      await commitWatchedPrice(env, commitInput("milk", "commit-during-remove"));
    });
    assert.equal(await removeItem({ DB: splitting } as Env, "milk"), true);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM watched_products WHERE id = 'milk'"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = 'milk'"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM alert_events WHERE product_id = 'milk'"), 0);
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS n FROM notification_outbox o
         JOIN price_transitions t ON t.id = o.transition_id
         WHERE t.product_id = 'milk' AND o.status = 'queued'`,
      ),
      0,
    );
    assert.equal(await statusOf(db, "queued-milk"), "suppressed");
    assert.equal(await statusOf(db, "sent-milk"), "sent");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_transitions WHERE id = 'queued-milk'"), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = 'bread'"), 1);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM alert_events WHERE product_id = 'bread'"), 1);
    assert.equal(await removeItem(env, "missing"), false);

    await seed(db, "race", 5);
    await Promise.all([
      removeItem(env, "race"),
      commitWatchedPrice(env, commitInput("race", "race-during-remove")),
    ]);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM watched_products WHERE id = 'race'"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM price_observations WHERE product_id = 'race'"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM alert_events WHERE product_id = 'race'"), 0);
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS n FROM notification_outbox o
         JOIN price_transitions t ON t.id = o.transition_id
         WHERE t.product_id = 'race' AND o.status = 'queued'`,
      ),
      0,
    );
  } finally {
    await local.dispose();
  }
});

test("pause suppresses queued alerts in the same batch and resume leaves them suppressed", { timeout: 180000 }, async () => {
  const local = await localD1("pause");
  const db = local.db;
  const env = { DB: db } as Env;
  try {
    await seed(db, "milk", 5);
    await ledger(db, "queued-before", "milk", "queued");
    await ledger(db, "sent-before", "milk", "sent");
    const splitting = traceDb(db, "SET monitoring_status", async () => {
      await db.prepare("UPDATE watched_products SET monitoring_status = 'active' WHERE id = 'milk'").run();
      await ledger(db, "queued-during-resume", "milk", "queued");
    });
    assert.equal(await setStatus({ DB: splitting } as Env, "milk", "paused"), true);
    const paused = await db.prepare("SELECT monitoring_status AS status, revision FROM watched_products WHERE id = 'milk'")
      .first<{ status: string; revision: number }>();
    assert.equal(paused?.status, "paused");
    assert.equal(paused?.revision, 1);
    assert.equal(await statusOf(db, "queued-before"), "suppressed");
    assert.equal(await statusOf(db, "sent-before"), "sent");
    assert.equal(await statusOf(db, "queued-during-resume"), null);

    assert.equal(await setStatus(env, "milk", "active"), true);
    const resumed = await db.prepare("SELECT monitoring_status AS status, revision FROM watched_products WHERE id = 'milk'")
      .first<{ status: string; revision: number }>();
    assert.equal(resumed?.status, "active");
    assert.equal(resumed?.revision, 2);
    assert.equal(await statusOf(db, "queued-before"), "suppressed");
    await ledger(db, "queued-after-resume", "milk", "queued");
    assert.equal(await statusOf(db, "queued-after-resume"), "queued");
    assert.equal(await setStatus(env, "missing", "paused"), false);
  } finally {
    await local.dispose();
  }
});
