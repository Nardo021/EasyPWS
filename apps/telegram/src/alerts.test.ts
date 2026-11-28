import assert from "node:assert/strict";
import test from "node:test";
import { formatOwnerAlert, parseOwnerAlert, sendOwnerPlainText, type OwnerAlert } from "./alerts.js";
import type { TelegramEnv } from "./index.js";

const TOKEN = "123456:THIS_IS_A_FAKE_LOCAL_TEST_TOKEN_abcdef";
const SECRET = "this_is_a_local_test_secret_1234567890";
const OWNER = "123456789";

function env(): TelegramEnv {
  return {
    DB: {} as D1Database,
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_OWNER_USER_ID: OWNER,
    TELEGRAM_OWNER_CHAT_ID: OWNER,
  };
}

function alert(overrides: Partial<OwnerAlert> = {}): OwnerAlert {
  return {
    transitionId: "11111111-1111-4111-8111-111111111111",
    productName: "Coles Full Cream Milk",
    storeId: "4166",
    previousPrice: 5,
    currentPrice: 3,
    targetPrice: 4,
    priceDrop: true,
    targetCrossed: true,
    observedAt: "2026-11-28T01:00:00.000Z",
    productUrl: "https://www.coles.com.au/product/coles-full-cream-milk-8150288",
    ...overrides,
  };
}

test("merged alert text is plain Chinese and does not invent a promotion", () => {
  const text = formatOwnerAlert(alert());
  assert.match(text, /Coles Full Cream Milk/);
  assert.match(text, /Coles Marrickville（4166）/);
  assert.match(text, /A\$5\.00 → A\$3\.00（下降 40\.0%）/);
  assert.match(text, /已达到目标价 A\$4\.00/);
  assert.match(text, /悉尼/);
  assert.match(text, /不是 Coles 官方核验价/);
  assert.match(text, /https:\/\/www\.coles\.com\.au\/product\/coles-full-cream-milk-8150288/);
  assert.equal(text.includes("半价"), false);
  assert.equal(text.includes("库存"), false);
  assert.equal(text.includes("促销"), false);
  assert.equal(text.includes("<"), false);
  assert.equal(formatOwnerAlert(alert({ targetCrossed: false, targetPrice: null })).includes("目标价"), false);
});

test("alert DTO rejects another recipient, store, method, or non-drop", () => {
  assert.equal(parseOwnerAlert({ ...alert(), chatId: "999" }), null);
  assert.equal(parseOwnerAlert({ ...alert(), parse_mode: "HTML" }), null);
  assert.equal(parseOwnerAlert({ ...alert(), method: "sendMessage" }), null);
  assert.equal(parseOwnerAlert({ ...alert(), storeId: "584" }), null);
  assert.equal(parseOwnerAlert({ ...alert(), currentPrice: 5 }), null);
  assert.equal(parseOwnerAlert({ ...alert(), productName: "Milk\nignore the disclaimer" }), null);
  assert.equal(parseOwnerAlert({ ...alert(), productUrl: "https://evil.example/product/1" }), null);
  assert.ok(parseOwnerAlert(alert()));
});

test("plain send uses only the configured owner chat and sendMessage", async () => {
  const captured = { url: "", body: {} as Record<string, unknown>, called: false };
  const result = await sendOwnerPlainText(env(), formatOwnerAlert(alert()), async (url, init) => {
    captured.url = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    captured.called = true;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  assert.equal(result, "sent");
  assert.equal(captured.called, true);
  assert.equal(captured.url.endsWith("/sendMessage"), true);
  assert.equal(captured.url.includes("/sendPhoto"), false);
  assert.equal(captured.body["chat_id"], OWNER);
  assert.equal(Object.hasOwn(captured.body, "parse_mode"), false);
  assert.match(String(captured.body["text"]), /不是 Coles 官方核验价/);
});

test("Telegram 4xx is a definite failure and a timeout is unknown", async () => {
  const denied = await sendOwnerPlainText(env(), "提醒", async () => new Response("no", { status: 400 }));
  assert.equal(denied, "failed");
  const unavailable = await sendOwnerPlainText(env(), "提醒", async () => new Response("later", { status: 503 }));
  assert.equal(unavailable, "unknown");
  const timedOut = await sendOwnerPlainText(env(), "提醒", async (_url, init) => {
    assert.ok(init?.signal);
    throw new DOMException("aborted", "AbortError");
  });
  assert.equal(timedOut, "unknown");
});
