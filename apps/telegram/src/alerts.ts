import { configured, type TelegramEnv } from "./index.js";

const STORE_ID = "4166";
const STORE_LABEL = "Coles Marrickville";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED = new Set([
  "transitionId",
  "productName",
  "storeId",
  "previousPrice",
  "currentPrice",
  "targetPrice",
  "priceDrop",
  "targetCrossed",
  "observedAt",
  "productUrl",
]);

export interface OwnerAlert {
  transitionId: string;
  productName: string;
  storeId: string;
  previousPrice: number;
  currentPrice: number;
  targetPrice: number | null;
  priceDrop: true;
  targetCrossed: boolean;
  observedAt: string;
  productUrl: string;
}

export interface DeliveryResult {
  state: "sent" | "failed" | "unknown" | "unavailable";
  claimed: boolean;
}

export type PlainSend = (text: string) => Promise<"sent" | "failed" | "unknown">;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlOrMarkup(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127 || code === 60 || code === 62) {
      return true;
    }
  }
  return false;
}

function finitePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100000;
}

function productUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 300) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:"
    && url.hostname === "www.coles.com.au"
    && url.port === ""
    && url.username === ""
    && url.password === ""
    && url.pathname.startsWith("/product/")
    && !url.pathname.includes("..");
}

export function parseOwnerAlert(input: unknown): OwnerAlert | null {
  if (!isObject(input)) {
    return null;
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED.has(key)) {
      return null;
    }
  }
  const transitionId = input["transitionId"];
  const productName = input["productName"];
  const storeId = input["storeId"];
  const previousPrice = input["previousPrice"];
  const currentPrice = input["currentPrice"];
  const targetPrice = input["targetPrice"];
  const observedAt = input["observedAt"];
  if (typeof transitionId !== "string" || !UUID.test(transitionId)) {
    return null;
  }
  if (typeof productName !== "string" || productName.length < 1 || productName.length > 120) {
    return null;
  }
  if (hasControlOrMarkup(productName)) {
    return null;
  }
  if (storeId !== STORE_ID) {
    return null;
  }
  if (!finitePrice(previousPrice) || !finitePrice(currentPrice) || currentPrice >= previousPrice) {
    return null;
  }
  if (targetPrice !== null && !finitePrice(targetPrice)) {
    return null;
  }
  if (input["priceDrop"] !== true || typeof input["targetCrossed"] !== "boolean") {
    return null;
  }
  if (input["targetCrossed"]) {
    if (typeof targetPrice !== "number" || !(previousPrice > targetPrice && currentPrice <= targetPrice)) {
      return null;
    }
  }
  if (typeof observedAt !== "string" || observedAt.length > 40) {
    return null;
  }
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) {
    return null;
  }
  const year = new Date(observed).getUTCFullYear();
  if (year < 2020 || year > 2100) {
    return null;
  }
  if (!productUrl(input["productUrl"])) {
    return null;
  }
  return {
    transitionId,
    productName,
    storeId,
    previousPrice,
    currentPrice,
    targetPrice,
    priceDrop: true,
    targetCrossed: input["targetCrossed"],
    observedAt,
    productUrl: input["productUrl"],
  };
}

export function formatOwnerAlert(alert: OwnerAlert): string {
  const previous = alert.previousPrice.toFixed(2);
  const current = alert.currentPrice.toFixed(2);
  const reduction = ((alert.previousPrice - alert.currentPrice) / alert.previousPrice) * 100;
  const when = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(alert.observedAt));
  const lines = [
    "EasyPWS 价格提醒",
    alert.productName,
    `门店：${STORE_LABEL}（${STORE_ID}）`,
    `报告价：A$${previous} → A$${current}（下降 ${reduction.toFixed(1)}%）`,
  ];
  if (alert.targetCrossed && alert.targetPrice !== null) {
    lines.push(`已达到目标价 A$${alert.targetPrice.toFixed(2)}`);
  }
  lines.push(`观察时间（悉尼）：${when}`);
  lines.push("这是第三方 API 报告价，不是 Coles 官方核验价。");
  lines.push(alert.productUrl);
  return lines.join("\n");
}

export async function sendOwnerPlainText(
  env: TelegramEnv,
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<"sent" | "failed" | "unknown"> {
  if (!configured(env) || text.length < 1 || text.length > 3500 || /<\s*\/?[a-z]/i.test(text)) {
    return "failed";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_OWNER_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (response.status >= 400 && response.status < 500) {
      return "failed";
    }
    if (!response.ok) {
      return "unknown";
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return "unknown";
    }
    if (!isObject(payload) || payload["ok"] !== true) {
      return "failed";
    }
    return "sent";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timeout);
  }
}

function changes(result: { meta?: { changes?: number } } | undefined): number | null {
  const value = result?.meta?.changes;
  return value === 0 || value === 1 ? value : null;
}

const CLAIM_LEASE_MS = 60_000;

function leaseUntil(now: Date): string {
  return new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();
}

async function reconcileExpiredClaims(env: TelegramEnv, now: Date): Promise<void> {
  const at = now.toISOString();
  await env.DB.prepare(
    `UPDATE telegram_alert_deliveries
     SET status = 'unknown', claim_token = NULL, updated_at = ?
     WHERE status = 'claimed' AND (lease_until IS NULL OR lease_until < ?)`,
  )
    .bind(at, at)
    .run();
}

async function persistedState(env: TelegramEnv, transitionId: string): Promise<DeliveryResult> {
  const existing = await env.DB.prepare(
    "SELECT status FROM telegram_alert_deliveries WHERE transition_id = ?",
  )
    .bind(transitionId)
    .first<{ status: string }>();
  if (existing?.status === "sent") {
    return { state: "sent", claimed: true };
  }
  if (existing?.status === "failed") {
    return { state: "failed", claimed: true };
  }
  return { state: "unknown", claimed: true };
}

export async function deliverOwnerAlert(
  env: TelegramEnv,
  input: unknown,
  send: PlainSend = (text) => sendOwnerPlainText(env, text),
  now = new Date(),
): Promise<DeliveryResult> {
  const alert = parseOwnerAlert(input);
  if (!alert) {
    return { state: "failed", claimed: false };
  }
  if (!configured(env) || !env.DB) {
    return { state: "unavailable", claimed: false };
  }
  let claimToken: string | null = null;
  try {
    await reconcileExpiredClaims(env, now);
    const at = now.toISOString();
    claimToken = crypto.randomUUID();
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO telegram_alert_deliveries (
        transition_id, status, claim_token, lease_until, created_at, updated_at
      ) VALUES (?, 'claimed', ?, ?, ?, ?)`,
    )
      .bind(alert.transitionId, claimToken, leaseUntil(now), at, at)
      .run();
    const wrote = changes(inserted);
    if (wrote === null) {
      return { state: "unavailable", claimed: false };
    }
    if (wrote === 0) {
      claimToken = null;
      return persistedState(env, alert.transitionId);
    }
    const outcome = await send(formatOwnerAlert(alert));
    const stored = outcome === "sent" || outcome === "failed" || outcome === "unknown" ? outcome : "unknown";
    try {
      const finished = await env.DB.prepare(
        `UPDATE telegram_alert_deliveries
         SET status = ?, claim_token = NULL, updated_at = ?
         WHERE transition_id = ? AND status = 'claimed' AND claim_token = ?`,
      )
        .bind(stored, new Date().toISOString(), alert.transitionId, claimToken)
        .run();
      if (changes(finished) !== 1) {
        return persistedState(env, alert.transitionId);
      }
    } catch {
      return { state: "unknown", claimed: true };
    }
    return persistedState(env, alert.transitionId);
  } catch {
    if (!claimToken) {
      return { state: "unavailable", claimed: false };
    }
    try {
      await env.DB.prepare(
        `UPDATE telegram_alert_deliveries SET status = 'unknown', claim_token = NULL, updated_at = ?
         WHERE transition_id = ? AND status = 'claimed' AND claim_token = ?`,
      )
        .bind(new Date().toISOString(), alert.transitionId, claimToken)
        .run();
    } catch {
      // The claim remains until its lease expires. A duplicate does not send or change it.
    }
    return { state: "unknown", claimed: true };
  }
}
