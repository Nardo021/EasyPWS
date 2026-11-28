import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramWebhook, type MessageSender, type TelegramEnv } from "./index.js";

const OWNER_ID = "123456789";
const SECRET = "this_is_a_local_test_secret_1234567890";
const TOKEN = "123456:THIS_IS_A_FAKE_LOCAL_TEST_TOKEN_abcdef";

class FakeDb {
  readonly receipts = new Map<number, string>();
  failClaim = false;
  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({
        run: async () => {
          if (sql.startsWith("INSERT OR IGNORE")) {
            if (this.failClaim) {
              throw new Error("fake unavailable database");
            }
            const id = values[0] as number;
            if (this.receipts.has(id)) {
              return { meta: { changes: 0 } };
            }
            this.receipts.set(id, "claimed");
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE telegram_update_receipts")) {
            this.receipts.set(values[2] as number, values[0] as string);
            return { meta: { changes: 1 } };
          }
          throw new Error("unexpected SQL: " + sql.slice(0, 36));
        },
      }),
    };
  }
}

function env(db = new FakeDb()): TelegramEnv {
  return {
    DB: db as unknown as D1Database,
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_WEBHOOK_SECRET: SECRET,
    TELEGRAM_OWNER_USER_ID: OWNER_ID,
    TELEGRAM_OWNER_CHAT_ID: OWNER_ID,
  };
}

function update(text = "/start", options: {
  id?: number;
  fromId?: number;
  chatId?: number;
  chatType?: string;
} = {}) {
  return {
    update_id: options.id ?? 123,
    message: {
      message_id: 2,
      date: 1,
      from: { id: options.fromId ?? Number(OWNER_ID), is_bot: false, first_name: "User" },
      chat: { id: options.chatId ?? Number(OWNER_ID), type: options.chatType ?? "private" },
      text,
    },
  };
}

function request(body: unknown = update(), secret: string | null = SECRET): Request {
  return new Request("https://bot.example.test/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret }),
    },
    body: JSON.stringify(body),
  });
}

test("owner /start receives a private acknowledgement and receipt", async () => {
  const db = new FakeDb();
  const sends: string[] = [];
  const send: MessageSender = async (m) => {
    assert.equal(m.chatId, OWNER_ID);
    assert.equal(m.botToken, TOKEN);
    sends.push(m.text);
  };
  const response = await handleTelegramWebhook(request(), env(db), send);
  assert.equal(response.status, 200);
  assert.equal(sends.length, 1);
  assert.match(sends[0] ?? "", /不是 Coles 官方核验价/);
  assert.equal(db.receipts.get(123), "sent");
});

test("owner /help lists read-only queries and the price caveat", async () => {
  const messages: string[] = [];
  const response = await handleTelegramWebhook(
    request(update("/help")), env(), async (m) => { messages.push(m.text); },
  );
  assert.equal(response.status, 200);
  assert.match(messages[0] ?? "", /\/search/);
  assert.match(messages[0] ?? "", /\/deals/);
  assert.match(messages[0] ?? "", /不是 Coles 官方核验价/);
  assert.match(messages[0] ?? "", /不会刷新价格/);
});

test("missing webhook header is denied before any database access or message", async () => {
  const db = new FakeDb();
  let sent = false;
  const response = await handleTelegramWebhook(request(update(), null), env(db), async () => { sent = true; });
  assert.equal(response.status, 403);
  assert.equal(sent, false);
  assert.equal(db.receipts.size, 0);
});

test("forged webhook secret is denied", async () => {
  const db = new FakeDb();
  const response = await handleTelegramWebhook(request(update(), "fake"), env(db), async () => {
    assert.fail("must not send");
  });
  assert.equal(response.status, 403);
  assert.equal(db.receipts.size, 0);
});

test("only owner numeric ID is allowed, not a spoofed name", async () => {
  const db = new FakeDb();
  const response = await handleTelegramWebhook(
    request(update("/start", { fromId: 987654321 })),
    env(db),
    async () => { assert.fail("must not send"); },
  );
  assert.equal(response.status, 200);
  assert.equal(db.receipts.size, 0);
});

test("group chats are silently ignored even for owner", async () => {
  const db = new FakeDb();
  const response = await handleTelegramWebhook(
    request(update("/start", { chatId: -100123456, chatType: "supergroup" })),
    env(db),
    async () => { assert.fail("must not send"); },
  );
  assert.equal(response.status, 200);
  assert.equal(db.receipts.size, 0);
});

test("private chat ID must also match explicitly bound owner chat", async () => {
  const db = new FakeDb();
  const response = await handleTelegramWebhook(
    request(update("/start", { chatId: 111222333 })),
    env(db),
    async () => { assert.fail("must not send"); },
  );
  assert.equal(response.status, 200);
  assert.equal(db.receipts.size, 0);
});

test("atomic D1 claim suppresses duplicate update delivery", async () => {
  const db = new FakeDb();
  let sends = 0;
  const sender: MessageSender = async () => { sends += 1; };
  const one = await handleTelegramWebhook(request(update("/start", { id: 456 })), env(db), sender);
  const two = await handleTelegramWebhook(request(update("/start", { id: 456 })), env(db), sender);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.equal(sends, 1);
  assert.equal(db.receipts.size, 1);
});

test("D1 unavailable: fails closed and does not send", async () => {
  const db = new FakeDb();
  db.failClaim = true;
  const response = await handleTelegramWebhook(request(), env(db), async () => {
    assert.fail("no send if D1 is unavailable");
  });
  assert.equal(response.status, 503);
});

test("unknown or timed-out message send is recorded failed, never blindly resent", async () => {
  const db = new FakeDb();
  let attempts = 0;
  const sender: MessageSender = async () => {
    attempts += 1;
    throw new Error("simulated send timeout");
  };
  const first = await handleTelegramWebhook(request(), env(db), sender);
  const repeat = await handleTelegramWebhook(request(), env(db), sender);
  assert.equal(first.status, 200);
  assert.equal(repeat.status, 200);
  assert.equal(attempts, 1);
  assert.equal(db.receipts.get(123), "failed");
});

test("price command without the private binding does not invent a price", async () => {
  const msg: string[] = [];
  const response = await handleTelegramWebhook(request(update("/price 1251527")), env(),
    async ({ text }) => { msg.push(text); });
  assert.equal(response.status, 200);
  assert.match(msg[0] ?? "", /查询服务未连接/);
  assert.equal((msg[0] ?? "").includes("AUD"), false);
});

test("malformed query arguments never call the price binding", async () => {
  let calls = 0;
  const bound = env();
  bound.PRICE_QUERY = { query: async () => { calls += 1; return { status: "ok", text: "AUD 1.00" }; } };
  const messages: string[] = [];
  for (const [index, text] of ["/search a", "/price abc", "/history", "/search " + "词".repeat(81)].entries()) {
    const response = await handleTelegramWebhook(request(update(text, { id: 10 + index })), bound,
      async ({ text: sent }) => { messages.push(sent); });
    assert.equal(response.status, 200, text);
  }
  assert.equal(messages.length, 4);
  assert.equal(calls, 0);
  assert.equal(messages.some((message) => message.includes("AUD")), false);
});

test("a query result is sent once and invalid RPC output is not forwarded", async () => {
  const seen: unknown[] = [];
  const db = new FakeDb();
  const bound = env(db);
  bound.PRICE_QUERY = {
    query: async (input) => {
      seen.push(input);
      return { status: "ok", text: "SKU 1251527｜AUD 3.30\n不是 Coles 官方核验价。" };
    },
  };
  const messages: string[] = [];
  const sender: MessageSender = async ({ text }) => { messages.push(text); };
  const first = await handleTelegramWebhook(request(update("/price 1251527", { id: 77 })), bound, sender);
  const second = await handleTelegramWebhook(request(update("/price 1251527", { id: 77 })), bound, sender);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(messages.length, 1);
  const payload = seen[0] as { operation?: string; requestKey?: string; argument?: string };
  assert.equal(payload.operation, "price");
  assert.equal(payload.argument, "1251527");
  assert.match(payload.requestKey ?? "", /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(payload).includes(OWNER_ID), false);

  bound.PRICE_QUERY = { query: async () => ({ status: "leaked", text: "https://evil.example" }) };
  const rejected: string[] = [];
  const bad = await handleTelegramWebhook(request(update("/watchlist", { id: 78 })), bound,
    async ({ text }) => { rejected.push(text); });
  assert.equal(bad.status, 200);
  assert.match(rejected[0] ?? "", /无法使用/);
  assert.equal((rejected[0] ?? "").includes("evil.example"), false);

  bound.PRICE_QUERY = { query: async () => { throw new Error("rpc down"); } };
  const failed: string[] = [];
  const broken = await handleTelegramWebhook(request(update("/deals", { id: 79 })), bound,
    async ({ text }) => { failed.push(text); });
  assert.equal(broken.status, 200);
  assert.match(failed[0] ?? "", /没有重试/);
  assert.equal(db.receipts.get(79), "sent");
});

test("oversized and malformed JSON are rejected", async () => {
  const bad = new Request("https://bot.example.test/webhook", {
    method: "POST",
    headers: {
      "X-Telegram-Bot-Api-Secret-Token": SECRET,
      "content-type": "application/json",
    },
    body: "{broken",
  });
  const malformed = await handleTelegramWebhook(bad, env(), async () => { assert.fail("not reached"); });
  assert.equal(malformed.status, 400);
  const huge = await handleTelegramWebhook(request({ value: "a".repeat(9000) }), env(), async () => {
    assert.fail("not reached");
  });
  assert.equal(huge.status, 413);
});

test("no token, no owner binding or no DB: never accepts webhook", async () => {
  const noToken = { ...env(), TELEGRAM_BOT_TOKEN: "" };
  const noOwner = { ...env(), TELEGRAM_OWNER_USER_ID: "" };
  const noDB = { ...env(), DB: undefined as unknown as D1Database };
  for (const bad of [noToken, noOwner, noDB]) {
    const response = await handleTelegramWebhook(request(), bad, async () => {
      assert.fail("must not send");
    });
    assert.equal(response.status, 503);
  }
});

test("price delivery is not a public fetch route", async () => {
  for (const path of ["/deliver", "/alerts", "/webhook/send"]) {
    const response = await handleTelegramWebhook(
      new Request(`https://bot.example.test${path}`, { method: "POST" }),
      env(),
      async () => { assert.fail("must not send"); },
    );
    assert.equal(response.status, 404);
    const body = await response.json() as { ok?: unknown };
    assert.equal(body.ok, false);
    assert.equal(JSON.stringify(body).includes(OWNER_ID), false);
  }
});

test("only POST /webhook is supported, unknown paths expose no owner details", async () => {
  const get = new Request("https://bot.example.test/health");
  const response = await handleTelegramWebhook(get, env(), async () => {
    assert.fail("must not send");
  });
  assert.equal(response.status, 404);
});
