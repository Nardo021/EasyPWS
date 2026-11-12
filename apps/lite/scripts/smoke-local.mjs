import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const persist = resolve(appDir, ".wrangler/smoke");
const base = "http://127.0.0.1:8787";

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
    ["exec", "wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1", "--persist-to", persist],
    { cwd: appDir, shell: true, stdio: "ignore" },
  );
}

function stop(child) {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
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
  const body = await response.json();
  return { status: response.status, body };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const first = start();
try {
  const health = await waitReady();
  assert(health.mode === "fixture", "expected fixture mode");
  assert(health.storeId === "4166", "expected store 4166");
  assert(health.externalRequests === 0, "fixture boot made an external request");

  const me = await api("/api/v1/auth/me");
  assert(me.status === 200 && me.body.mode === "local", "session did not start");

  const bad = await api("/api/v1/products/import", {
    method: "POST",
    body: JSON.stringify({ url: "https://example.com/product/1" }),
  });
  assert(bad.status === 400, "bad url was accepted");

  const missing = await api("/api/v1/products/import", {
    method: "POST",
    body: JSON.stringify({ url: "https://www.coles.com.au/product/missing-999" }),
  });
  assert(missing.status === 404, "missing fixture was not a 404");

  const imported = await api("/api/v1/products/import", {
    method: "POST",
    body: JSON.stringify({
      url: "https://www.coles.com.au/product/v-energy-drink-original-4x250ml-8737163",
    }),
  });
  assert(imported.status === 200, "import failed");

  const listed = await api("/api/v1/watchlists/items");
  assert(listed.body.items?.length === 1, "watchlist did not save");
  const item = listed.body.items[0];
  assert(item.currentPrice === 6, "reported price was not kept");
  assert(item.storeId === "4166", "store was not 4166");
  assert(item.notificationEligible === false, "notification was enabled");
  assert(item.sourceLabel === "本地示例", "fixture was labeled as live");

  const refreshed = await api(`/api/v1/watchlists/items/${item.watchlistItemId}/refresh`, {
    method: "POST",
  });
  assert(refreshed.status === 200, "refresh failed");

  const removed = await api(`/api/v1/watchlists/items/${item.watchlistItemId}`, {
    method: "DELETE",
  });
  assert(removed.status === 200, "delete failed");
  const empty = await api("/api/v1/watchlists/items");
  assert(empty.body.items?.length === 0, "delete did not remove the item");

  const milk = await api("/api/v1/products/import", {
    method: "POST",
    body: JSON.stringify({
      url: "https://www.coles.com.au/product/coles-full-cream-milk-8150288",
    }),
  });
  assert(milk.status === 200, "milk import failed");
} finally {
  stop(first);
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 1000));
}

const second = start();
try {
  await waitReady();
  const listed = await api("/api/v1/watchlists/items");
  assert(listed.body.items?.length === 1, "watchlist did not survive restart");
  assert(listed.body.items[0].retailerProductId === undefined || listed.body.items[0].productName.includes("Milk"), "restarted item changed");
  assert(listed.body.items[0].currentPrice === 4.95, "restarted price changed");
  const health = await api("/api/v1/health");
  assert(health.body.externalRequests === 0, "smoke made an external request");
  console.log("lite local smoke ok");
  console.log(`externalRequests ${health.body.externalRequests}`);
  console.log(`persisted ${listed.body.items[0].productName} @ ${listed.body.items[0].storeId}`);
} finally {
  stop(second);
}
