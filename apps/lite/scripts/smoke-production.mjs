import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const persist = resolve(appDir, ".wrangler/production-smoke");
const devVars = resolve(appDir, ".dev.vars");
const base = "http://127.0.0.1:8789";
const email = "owner@example.com";

rmSync(persist, { recursive: true, force: true });
mkdirSync(persist, { recursive: true });
writeFileSync(devVars, "EASYPWS_RUNTIME=production\nEASYPWS_OMKAR_MODE=fixture\n", "utf8");

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
    ["exec", "wrangler", "dev", "--test-scheduled", "--port", "8789", "--ip", "127.0.0.1", "--persist-to", persist],
    { cwd: appDir, shell: true, stdio: "ignore" },
  );
}

function stop(child) {
  if (child.pid && process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  } else if (child.pid) {
    child.kill("SIGTERM");
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitReady() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/v1/health`, {
        headers: { "Cf-Access-Authenticated-User-Email": email },
      });
      if (response.status === 200) {
        return response.json();
      }
    } catch {
      // Worker is still booting.
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 500));
  }
  throw new Error("production guard worker did not become ready");
}

async function read(path, headers) {
  const response = await fetch(`${base}${path}`, { headers });
  const text = await response.text();
  return { status: response.status, text };
}

const child = start();
try {
  const health = await waitReady();
  assert(health.runtime === "production", "runtime was not production");
  assert(health.mode === "unavailable", "fixture mode was used in production");
  assert(health.externalRequests === 0, "production guard made an external request");

  const home = await read("/");
  assert(home.status === 401, "homepage was public without Access");
  const api = await read("/api/v1/products/search?q=milk");
  assert(api.status === 401, "API was public without Access");
  assert(!api.text.includes("4.95") && !api.text.includes("Full Cream"), "public API returned a fixture price");

  const me = await read("/api/v1/auth/me", { "Cf-Access-Authenticated-User-Email": email });
  const session = JSON.parse(me.text);
  assert(me.status === 200 && session.mode === "private", "private session was not reported");
  assert(session.email === email && session.email !== "local", "production identity stayed local");

  const search = await read("/api/v1/products/search?q=milk", {
    "Cf-Access-Authenticated-User-Email": email,
  });
  assert(search.status === 503, "missing key did not fail closed");
  assert(!search.text.includes("4.95") && !search.text.includes("Full Cream"), "missing key returned fixture prices");

  const imported = await fetch(`${base}/api/v1/products/import`, {
    method: "POST",
    headers: { "content-type": "application/json", "Cf-Access-Authenticated-User-Email": email },
    body: JSON.stringify({ url: "https://www.coles.com.au/product/coles-full-cream-milk-8150288" }),
  });
  const importText = await imported.text();
  assert(imported.status === 503, "import used fixture data");
  assert(!importText.includes("4.95"), "import response contained a fixture price");

  console.log("lite production guard ok");
  console.log(`mode ${health.mode}`);
  console.log(`externalRequests ${health.externalRequests}`);
} finally {
  stop(child);
  writeFileSync(devVars, "EASYPWS_OMKAR_MODE=fixture\n", "utf8");
}
