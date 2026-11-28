/**
 * EasyPWS Phase 1F-A: isolated owner-only Telegram webhook foundation.
 * No shared price DB binding, Omkar key, product search, or notification delivery.
 */
export interface TelegramEnv {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_OWNER_USER_ID: string;
  TELEGRAM_OWNER_CHAT_ID: string;
}

export interface SendMessageInput {
  chatId: string;
  text: string;
  botToken: string;
}
export type MessageSender = (message: SendMessageInput) => Promise<void>;

type JsonObject = Record<string, unknown>;
const MAX_UPDATE_BYTES = 8192;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(status: number): Response {
  return Response.json({ ok: status === 200 }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validTelegramId(value: string | undefined): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value)
    && Number.isSafeInteger(Number(value));
}

function configured(env: TelegramEnv): boolean {
  return !!env.DB
    && typeof env.TELEGRAM_BOT_TOKEN === "string"
    && /^[0-9]{4,}:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN)
    && typeof env.TELEGRAM_WEBHOOK_SECRET === "string"
    && /^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)
    && validTelegramId(env.TELEGRAM_OWNER_USER_ID)
    && validTelegramId(env.TELEGRAM_OWNER_CHAT_ID);
}

/** Constant-work byte comparison for the 32-256-character webhook secret. */
function sameSecret(actual: string, expected: string): boolean {
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const stated = request.headers.get("content-length");
  if (stated && (!/^\d+$/.test(stated) || Number(stated) > MAX_UPDATE_BYTES)) {
    return null;
  }
  if (!request.body) {
    return "";
  }
  const reader = request.body.getReader();
  let total = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_UPDATE_BYTES) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function authorizedMessage(update: JsonObject, env: TelegramEnv): { id: number; chatId: string; command: string } | null {
  const id = update["update_id"];
  const message = update["message"];
  if (!isSafeInteger(id) || id < 0 || !isObject(message)) {
    return null;
  }
  const from = message["from"];
  const chat = message["chat"];
  if (!isObject(from) || !isObject(chat) || chat["type"] !== "private") {
    return null;
  }
  if (!isSafeInteger(from["id"]) || !isSafeInteger(chat["id"])
    || String(from["id"]) !== env.TELEGRAM_OWNER_USER_ID
    || String(chat["id"]) !== env.TELEGRAM_OWNER_CHAT_ID) {
    return null;
  }
  const raw = message["text"];
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return null;
  }
  const command = raw.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  return { id, chatId: env.TELEGRAM_OWNER_CHAT_ID, command };
}

function commandReply(command: string): string {
  if (command === "/start") {
    return "EasyPWS 已连接到你的 Telegram 私聊。\n当前为安全接入阶段；价格提醒和查询功能尚未启用。\n发送 /help 查看状态。";
  }
  if (command === "/help") {
    return "EasyPWS Bot（私人）\n/start — 验证私聊连接\n/help — 当前状态\n/search、/price、/watchlist — 尚未启用\n\n未来显示的价格仅为第三方 API 报告价，非 Coles 官方核验价。";
  }
  return "当前仅支持 /start 与 /help。价格查询和降价提醒将在后续阶段启用。";
}

async function claimUpdate(env: TelegramEnv, id: number): Promise<boolean> {
  const at = new Date().toISOString();
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO telegram_update_receipts (update_id,status,created_at,updated_at) VALUES (?,'claimed',?,?)",
  ).bind(id, at, at).run();
  const changes = result.meta?.changes;
  if (changes !== 0 && changes !== 1) {
    throw new Error("D1 claim result is ambiguous");
  }
  return changes === 1;
}

async function finishUpdate(env: TelegramEnv, id: number, status: "sent" | "failed"): Promise<void> {
  await env.DB.prepare(
    "UPDATE telegram_update_receipts SET status=?,updated_at=? WHERE update_id=?",
  ).bind(status, new Date().toISOString(), id).run();
}

export async function sendTelegramMessage({ chatId, text, botToken }: SendMessageInput): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("Telegram rejected sendMessage");
    }
    const result: unknown = await response.json();
    if (!isObject(result) || result["ok"] !== true) {
      throw new Error("Telegram did not confirm sendMessage");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleTelegramWebhook(
  request: Request,
  env: TelegramEnv,
  send: MessageSender = sendTelegramMessage,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path !== "/webhook" || request.method !== "POST") {
    return json(404);
  }
  if (!configured(env)) {
    return json(503);
  }
  const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!header || header.length > 256 || !sameSecret(header, env.TELEGRAM_WEBHOOK_SECRET)) {
    return json(403);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return json(415);
  }
  let raw: string | null;
  try {
    raw = await readBoundedBody(request);
  } catch {
    return json(400);
  }
  if (raw === null) {
    return json(413);
  }
  let update: unknown;
  try {
    update = JSON.parse(raw);
  } catch {
    return json(400);
  }
  if (!isObject(update)) {
    return json(400);
  }
  const message = authorizedMessage(update, env);
  if (!message) {
    // No data and no hint about the private owner; ignore strangers and group updates.
    return json(200);
  }
  try {
    if (!(await claimUpdate(env, message.id))) {
      return json(200);
    }
  } catch {
    // Fail closed: Telegram can retry while no update has been claimed.
    return json(503);
  }
  let status: "sent" | "failed" = "failed";
  try {
    await send({
      chatId: message.chatId,
      botToken: env.TELEGRAM_BOT_TOKEN,
      text: commandReply(message.command),
    });
    status = "sent";
  } catch {
    // At-most-one send attempt per update. A failed/unknown delivery is recorded
    // rather than retried blindly, avoiding duplicate messages.
  }
  try {
    await finishUpdate(env, message.id, status);
  } catch {
    // A claim already exists: acknowledging prevents a blind duplicate send.
  }
  return json(200);
}

export default {
  async fetch(request: Request, env: TelegramEnv): Promise<Response> {
    return handleTelegramWebhook(request, env);
  },
};
