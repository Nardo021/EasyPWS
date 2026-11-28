import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { Env } from "./catalogue.js";
import app from "./index.js";

const require = createRequire(import.meta.url);
const { createTestHarness } = require("wrangler") as {
  createTestHarness: (options: {
    root?: string;
    workers: Array<{ config: Record<string, unknown> }>;
  }) => Harness;
};

interface WorkerHandle {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  getEnv(): Promise<{ DB: D1Database }>;
  applyD1Migrations(binding: string): Promise<void>;
}

interface Harness {
  listen(): Promise<{ url: URL }>;
  close(): Promise<void>;
  getLogs(): unknown[];
  getWorker(name?: string): WorkerHandle;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const liteRoot = resolve(here, "..");
const telegramRoot = resolve(here, "../../telegram");
const TOKEN = "123456:THIS_IS_A_FAKE_LOCAL_TEST_TOKEN_abcdef";
const SECRET = "this_is_a_local_test_secret_1234567890";
const OWNER = "123456789";
const MILK_URL = "https://www.coles.com.au/product/coles-full-cream-milk-8150288";

function ctx(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
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

function runWrangler(cwd: string, args: string[]): Promise<{ code: number; output: string }> {
  const bin = resolve(liteRoot, "node_modules/wrangler/bin/wrangler.js");
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    });
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

test("named AlertDelivery RPC crosses a real service binding", { timeout: 180000 }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), "easypws-rpc-"));
  const bridge = resolve(root, "bridge.ts");
  await writeFile(bridge, `
interface Env {
  TELEGRAM_ALERTS: { deliver(input: unknown): Promise<unknown> };
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/rpc/deliver") {
      return new Response("not found", { status: 404 });
    }
    return Response.json(await env.TELEGRAM_ALERTS.deliver(await request.json()));
  },
};
`);
  const server = createTestHarness({
    root,
    workers: [
      {
        config: {
          name: "easypws-price-rpc",
          main: bridge,
          // Wrangler 4.160.1's workerd binary stops at 2026-11-17. Production config stays 2026-11-24.
          compatibility_date: "2026-11-17",
          services: [{
            binding: "TELEGRAM_ALERTS",
            service: "easypws-telegram",
            entrypoint: "AlertDelivery",
          }],
        },
      },
      {
        config: {
          name: "easypws-telegram",
          main: resolve(telegramRoot, "src/worker.ts"),
          compatibility_date: "2026-11-17",
          d1_databases: [{
            binding: "DB",
            database_name: "easypws-telegram-rpc",
            database_id: crypto.randomUUID(),
            migrations_dir: resolve(telegramRoot, "migrations"),
          }],
          vars: {
            TELEGRAM_BOT_TOKEN: TOKEN,
            TELEGRAM_WEBHOOK_SECRET: SECRET,
            TELEGRAM_OWNER_USER_ID: OWNER,
            TELEGRAM_OWNER_CHAT_ID: OWNER,
          },
        },
      },
    ],
  });
  const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
  const outboundHosts: string[] = [];
  const original = globalThis.fetch;
  try {
    await server.listen();
    const telegram = server.getWorker("easypws-telegram");
    await telegram.applyD1Migrations("DB");
    for (const path of ["/deliver", "/alerts", "/webhook/send"]) {
      const denied = await telegram.fetch(`https://easypws-telegram.yanze.me${path}`, { method: "POST" });
      assert.equal(denied.status, 404, path);
    }
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      let host: string;
      try {
        host = new URL(requestUrl(input)).hostname;
      } catch {
        return original(input, init);
      }
      outboundHosts.push(host);
      if (host === "api.telegram.org") {
        const raw = await readOutboundBody(input, init);
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = { unparsed: raw.slice(0, 300) };
        }
        captured.push({ url: requestUrl(input), body });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (host.includes("rapidapi") || host.endsWith("coles.com.au") || host === "api.cloudflare.com") {
        throw new Error(`blocked outbound host ${host}`);
      }
      return original(input, init);
    };
    const transitionId = crypto.randomUUID();
    const payload = {
      transitionId,
      productName: "Coles Full Cream Milk",
      storeId: "4166",
      previousPrice: 5,
      currentPrice: 3,
      targetPrice: null,
      priceDrop: true,
      targetCrossed: false,
      observedAt: "2026-11-28T01:00:00.000Z",
      productUrl: MILK_URL,
    };
    const price = server.getWorker("easypws-price-rpc");
    const first = await price.fetch("https://price.local/rpc/deliver", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const firstBody = await first.text();
    assert.equal(first.status, 200, firstBody);
    assert.deepEqual(JSON.parse(firstBody), { state: "sent", claimed: true }, `hosts=${outboundHosts.join(",")}`);
    const second = await price.fetch("https://price.local/rpc/deliver", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 200);
    const replay = await second.json() as { state: string; claimed: boolean };
    assert.equal(replay.claimed, true);
    assert.equal(replay.state, "sent");
    assert.equal(captured.length, 1);
    const sent = captured[0];
    assert.ok(sent);
    assert.equal(new URL(sent.url).pathname, `/bot${TOKEN}/sendMessage`);
    assert.equal(sent.body["chat_id"], OWNER);
    assert.equal(Object.hasOwn(sent.body, "parse_mode"), false);
    const row = await (await telegram.getEnv()).DB.prepare(
      "SELECT status FROM telegram_alert_deliveries WHERE transition_id = ?",
    ).bind(transitionId).first<{ status: string }>();
    assert.equal(row?.status, "sent");
    const hidden = await price.fetch("https://price.local/deliver", { method: "POST" });
    assert.equal(hidden.status, 404);
  } catch (error) {
    const logs = server.getLogs();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}\nlogs=${JSON.stringify(logs).slice(0, 2000)}`, { cause: error });
  } finally {
    globalThis.fetch = original;
    await server.close();
    await rm(root, { recursive: true, force: true });
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
    // The production bundle resolves the package export, which points at dist.
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

test("production wrangler dry-run keeps the private entrypoint and one cron", { timeout: 180000 }, async () => {
  await ensureAdapterDist();
  const assets = resolve(repoRoot, "apps/web/out");
  await mkdir(assets, { recursive: true });
  try {
    await access(resolve(assets, "index.html"));
  } catch {
    await writeFile(resolve(assets, "index.html"), "<!doctype html><title>easypws-dry-run</title>\n");
  }
  const liteConfig = await readFile(resolve(liteRoot, "wrangler.jsonc"), "utf8");
  const telegramConfig = await readFile(resolve(telegramRoot, "wrangler.jsonc"), "utf8");
  const crons = [...liteConfig.matchAll(/"crons":\s*\[([^\]]*)\]/g)];
  assert.equal(crons.length, 1);
  assert.match(crons[0]?.[1] ?? "", /"0 22 \* \* \*"/);
  assert.equal(telegramConfig.includes("\"crons\""), false);
  assert.match(liteConfig, /"entrypoint": "AlertDelivery"/);
  const out = await mkdtemp(resolve(tmpdir(), "easypws-dry-"));
  try {
    const lite = await runWrangler(liteRoot, [
      "deploy", "--dry-run", "--env", "production", "--keep-vars", "--outdir", resolve(out, "lite"),
    ]);
    assert.equal(lite.code, 0, lite.output.slice(-1500));
    assert.match(lite.output, /easypws-telegram#AlertDelivery/);
    assert.match(lite.output, /--dry-run: exiting now/);
    assert.equal(lite.output.includes("Current Version ID"), false);
    const telegram = await runWrangler(telegramRoot, [
      "deploy", "--dry-run", "--env", "production", "--keep-vars", "--outdir", resolve(out, "telegram"),
    ]);
    assert.equal(telegram.code, 0, telegram.output.slice(-1500));
    assert.match(telegram.output, /env\.DB \(easypws-telegram\)/);
    assert.match(telegram.output, /--dry-run: exiting now/);
    assert.equal(telegram.output.includes("Current Version ID"), false);
    assert.equal(telegram.output.includes("AlertDelivery"), false);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
  for (const path of ["/api/v1/deliver", "/api/v1/alerts", "/api/v1/notifications/telegram/send"]) {
    const denied = await app.fetch(new Request(`http://127.0.0.1${path}`, { method: "POST" }), {} as Env, ctx());
    assert.equal(denied.status, 404, path);
  }
});
