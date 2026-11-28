/**
 * Owner-only Telegram webhook. Price queries go through the private PRICE_QUERY binding.
 * This Worker has no price D1 binding and no Omkar key.
 */
export interface PriceQueryBinding {
  query(input: unknown): Promise<unknown>;
}

export interface TelegramEnv {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_OWNER_USER_ID: string;
  TELEGRAM_OWNER_CHAT_ID: string;
  /** Private price RPC. Absent binding fails closed; it is never a public fetch route. */
  PRICE_QUERY?: PriceQueryBinding;
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

export function configured(env: TelegramEnv): boolean {
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
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
}

const QUERY_STATUSES = new Set([
  "ok",
  "unavailable",
  "invalid",
  "stale",
  "provider_error",
  "quota",
  "not_found",
  "rejected",
]);

function authorizedMessage(update: JsonObject, env: TelegramEnv): { id: number; chatId: string; text: string } | null {
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
  return { id, chatId: env.TELEGRAM_OWNER_CHAT_ID, text: raw.trim() };
}

interface OwnerCommand {
  name: string;
  argument: string;
}

function parseOwnerCommand(text: string): OwnerCommand | null {
  const match = /^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]+))?$/i.exec(text.trim());
  if (!match?.[1]) {
    return null;
  }
  return { name: match[1].toLowerCase(), argument: (match[2] ?? "").trim() };
}

function localCommandReply(command: OwnerCommand): string | null {
  if (command.name === "start") {
    return "EasyPWS 已连接到你的 Telegram 私聊。\n可查询 /search、/price、/watchlist、/history、/deals。\n价格是第三方 API 报告价，不是 Coles 官方核验价。\n查询不会修改收藏、目标价或提醒开关。\n发送 /help 查看用法。";
  }
  if (command.name === "help") {
    return "EasyPWS 私人查询\n/search 关键词 — 最多 5 个结果，门店 4166\n/price SKU — 查询一个数字商品编号\n/watchlist — 已保存的收藏\n/history SKU — 已收藏商品的价格记录\n/deals — 收藏中已记录的折扣\n价格单位为 AUD。第三方 API 报告价，不是 Coles 官方核验价。\n查询不会刷新价格、加入收藏或改变提醒。";
  }
  return null;
}

async function requestKey(updateId: number, operation: string): Promise<string> {
  const bytes = new TextEncoder().encode(`easypws-query:${operation}:${updateId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function acceptQueryText(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const status = record["status"];
  const text = record["text"];
  if (typeof status !== "string" || !QUERY_STATUSES.has(status) || typeof text !== "string") {
    return null;
  }
  if (text.length === 0 || text.length > 3500) {
    return null;
  }
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code !== 10 && (code < 32 || code === 127)) {
      return null;
    }
  }
  return text;
}

async function queryReply(env: TelegramEnv, updateId: number, command: OwnerCommand): Promise<string> {
  if (command.name === "search" && (command.argument.length < 2 || command.argument.length > 80)) {
    return "搜索词需要 2 到 80 个字符。没有请求价格源。";
  }
  if ((command.name === "price" || command.name === "history") && !/^[1-9]\d{0,11}$/.test(command.argument)) {
    return "请提供数字 SKU。没有请求价格源。";
  }
  if (command.argument.length > 80) {
    return "参数过长。没有请求价格源，也没有修改收藏。";
  }
  if (!env.PRICE_QUERY) {
    return "查询服务未连接。没有请求价格，也没有修改收藏。";
  }
  const payload: Record<string, unknown> = { operation: command.name };
  if (command.argument.length > 0) {
    payload["argument"] = command.argument;
  }
  if (command.name === "search" || command.name === "price") {
    payload["requestKey"] = await requestKey(updateId, command.name);
  }
  let output: unknown;
  try {
    output = await env.PRICE_QUERY.query(payload);
  } catch {
    return "查询没有完成，没有重试。没有修改收藏。";
  }
  return acceptQueryText(output) ?? "查询结果无法使用。没有把未验证的内容当作价格。";
}

async function commandReply(env: TelegramEnv, updateId: number, text: string): Promise<string> {
  const command = parseOwnerCommand(text);
  if (!command) {
    return "无法识别这个命令。发送 /help 查看可用查询。";
  }
  const local = localCommandReply(command);
  if (local) {
    return local;
  }
  switch (command.name) {
    case "search":
    case "price":
    case "watchlist":
    case "history":
    case "deals":
      return queryReply(env, updateId, command);
    default:
      return "不支持这个命令。发送 /help 查看可用查询。不会修改收藏或提醒。";
  }
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
      text: await commandReply(env, message.id, message.text),
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
