import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const persist = resolve(appDir, ".wrangler/monitor-smoke");
const base = "http://127.0.0.1:8788";
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

rmSync(persist, { recursive: true, force: true });
mkdirSync(persist, { recursive: true });
writeFileSync(resolve(appDir, ".dev.vars"), "EASYPWS_OMKAR_MODE=fixture\n", "utf8");

const migrated = spawnSync(
  "pnpm",
  ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", persist],
  { cwd: appDir, shell: true, stdio: "inherit" },
);
if (migrated.status !== 0) {
  process.exit(migrated.status ?? 1);
}

function start() {
  return spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--test-scheduled",
      "--port",
      "8788",
      "--ip",
      "127.0.0.1",
      "--persist-to",
      persist,
    ],
    { cwd: appDir, shell: true, stdio: "ignore" },
  );
}

function stop(child) {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function sql(statements) {
  const file = resolve(persist, "step.sql");
  writeFileSync(file, statements, "utf8");
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", persist, "--file", file],
    { cwd: appDir, shell: true, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "d1 execute failed").slice(0, 500));
  }
}

async function waitReady() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/v1/health`);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // Worker is still booting.
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
  }
  throw new Error("local worker did not become ready");
}

async function api(path, init) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { status: response.status, body };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function itemNamed(items, name) {
  return items.find((item) => item.productName.includes(name));
}

async function trigger() {
  const response = await fetch(`${base}/cdn-cgi/local/scheduled?format=json`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`scheduled trigger failed HTTP ${response.status} ${text.slice(0, 160)}`);
  }
  await response.text();
}

const child = start();
try {
  const health = await waitReady();
  assert(health.mode === "fixture", "expected fixture mode");
  assert(health.externalRequests === 0, "boot made an external request");
  assert(health.monitorBudget === 15, "budget was not 15");

  const missingRoute = await api("/api/v1/monitor");
  assert(missingRoute.status === 404, "monitor was exposed as an HTTP route");

  const milk = await api("/api/v1/products/import", {
    method: "POST",
    body: JSON.stringify({ url: "https://www.coles.com.au/product/coles-full-cream-milk-8150288" }),
  });
  assert(milk.status === 200, "milk import failed");
  const energy = await api("/api/v1/products/import", {
    method: "POST",
    body: JSON.stringify({ url: "https://www.coles.com.au/product/v-energy-drink-original-4x250ml-8737163" }),
  });
  assert(energy.status === 200, "energy import failed");

  sql(`
    UPDATE watched_products
      SET current_price = 6.5, target_price = 5, last_attempt_at = '2019-06-01T00:00:00.000Z'
      WHERE retailer_product_id = '8150288';
    UPDATE watched_products
      SET current_price = 12, monitoring_status = 'paused', last_attempt_at = '2019-01-01T00:00:00.000Z'
      WHERE retailer_product_id = '8737163';
    INSERT INTO watched_products (
      id, retailer_product_id, store_id, name, product_url, current_price,
      promotion_type, promotion_kind, in_stock, availability_known, source_label, price_note,
      retrieved_at, monitoring_status, notification_eligible, created_at, last_attempt_at
    ) VALUES
      ('fail-404', '999', '4166', 'Missing sample', 'https://www.coles.com.au/product/999', 3.5,
       'unknown', 'unknown', 1, 1, '本地示例', 'kept',
       '2019-01-01T00:00:00.000Z', 'active', 0, '2019-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z'),
      ('fail-blank', '1001', '4166', 'Unpriced sample', 'https://www.coles.com.au/product/1001', 8,
       'unknown', 'unknown', 1, 1, '本地示例', 'kept',
       '2019-02-01T00:00:00.000Z', 'active', 0, '2019-02-01T00:00:00.000Z', '2019-02-01T00:00:00.000Z');
  `);

  const before = await api("/api/v1/watchlists/items");
  const seededMilk = itemNamed(before.body.items, "Milk");
  const beforeHistory = await api(`/api/v1/prices/listings/${seededMilk.watchlistItemId}/history`);
  const beforePoints = beforeHistory.body.points.length;

  await trigger();
  let listed = await api("/api/v1/watchlists/items");
  const milkItem = itemNamed(listed.body.items, "Milk");
  const energyItem = itemNamed(listed.body.items, "Energy");
  const missingItem = itemNamed(listed.body.items, "Missing");
  const blankItem = itemNamed(listed.body.items, "Unpriced");
  assert(milkItem.currentPrice === 4.95, "successful refresh did not save the reported price");
  assert(milkItem.notificationEligible === false, "notification eligibility changed");
  assert(milkItem.alertCount === 2, "price drop and target crossing were not both stored");
  assert(milkItem.alerts.some((line) => line.includes("6.50") && line.includes("4.95")), "price drop text missing");
  assert(milkItem.alerts.some((line) => line.includes("目标价")), "target crossing text missing");
  assert(energyItem.currentPrice === 12 && energyItem.monitoringStatus === "paused", "paused item was checked");
  assert(missingItem.currentPrice === 3.5, "failed response replaced the last price");
  assert(missingItem.lastCheckedAt === "2019-01-01T00:00:00.000Z", "failed response replaced the last retrieval");
  assert(blankItem.currentPrice === 8, "invalid quote replaced the last price");
  const history = await api(`/api/v1/prices/listings/${milkItem.watchlistItemId}/history`);
  assert(history.body.points.length === beforePoints + 1, "price history was not recorded");
  assert(history.body.points.at(-1).price === 4.95, "latest history price was not the refresh");

  await trigger();
  listed = await api("/api/v1/watchlists/items");
  const milkAgain = itemNamed(listed.body.items, "Milk");
  assert(milkAgain.alertCount === 2, "the same price change created a duplicate event");
  assert(milkAgain.currentPrice === 4.95, "second run changed an unchanged price");

  let after = await api("/api/v1/health");
  assert(after.body.externalRequests === 0, "fixture monitor made an external request");
  assert(after.body.monitorUsedToday === 6, `expected 6 attempts, got ${after.body.monitorUsedToday}`);

  const fillers = Array.from({ length: 9 }, (_, index) => {
    return `INSERT INTO monitor_attempts (day, product_id, outcome, created_at) VALUES ('${day}', 'budget', 'preserved', '2026-11-12T00:00:${String(index).padStart(2, "0")}.000Z');`;
  }).join("\n");
  sql(`
    ${fillers}
    UPDATE watched_products SET current_price = 8.25, last_attempt_at = '2018-01-01T00:00:00.000Z'
      WHERE retailer_product_id = '8150288';
  `);
  await trigger();
  listed = await api("/api/v1/watchlists/items");
  assert(itemNamed(listed.body.items, "Milk").currentPrice === 8.25, "budget did not stop the refresh");
  after = await api("/api/v1/health");
  assert(after.body.monitorUsedToday === 15, "budget counter changed without a call");

  sql(`
    DELETE FROM monitor_attempts WHERE id IN (SELECT id FROM monitor_attempts ORDER BY id DESC LIMIT 1);
    UPDATE watched_products SET current_price = 9, last_attempt_at = '2018-01-01T00:00:00.000Z'
      WHERE retailer_product_id = '8150288';
    UPDATE watched_products SET last_attempt_at = '2026-11-12T10:00:00.000Z'
      WHERE retailer_product_id IN ('999', '1001');
  `);
  await trigger();
  listed = await api("/api/v1/watchlists/items");
  assert(itemNamed(listed.body.items, "Milk").currentPrice === 4.95, "oldest item was not refreshed first");
  assert(itemNamed(listed.body.items, "Missing").currentPrice === 3.5, "newer item was refreshed inside the last budget slot");
  assert(itemNamed(listed.body.items, "Energy").currentPrice === 12, "paused item was refreshed");
  after = await api("/api/v1/health");
  assert(after.body.externalRequests === 0, "priority run made an external request");
  console.log("lite monitor smoke ok");
  console.log(`externalRequests ${after.body.externalRequests}`);
  console.log(`monitorUsedToday ${after.body.monitorUsedToday}`);
} finally {
  stop(child);
}
