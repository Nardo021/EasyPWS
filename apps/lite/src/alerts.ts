import type { AlertDeliveryResult, TelegramAlert } from "./alert-types.js";
import type { Env } from "./catalogue.js";

export const DISPATCH_LIMIT = 8;
export type { AlertDeliveryResult, TelegramAlert };

interface OutboxRow {
  transition_id: string;
  product_name: string;
  store_id: string;
  previous_price: number;
  price: number;
  target_price: number | null;
  price_drop: number;
  target_crossed: number;
  observed_at: string;
  product_url: string;
}

function changes(result: { meta?: { changes?: number } } | undefined): number {
  return result?.meta?.changes ?? 0;
}

export function buildAlert(row: OutboxRow): TelegramAlert | null {
  if (row.price_drop !== 1) {
    return null;
  }
  const alert: TelegramAlert = {
    transitionId: row.transition_id,
    productName: row.product_name,
    storeId: row.store_id,
    previousPrice: row.previous_price,
    currentPrice: row.price,
    targetPrice: typeof row.target_price === "number" ? row.target_price : null,
    priceDrop: true,
    targetCrossed: row.target_crossed === 1,
    observedAt: row.observed_at,
    productUrl: row.product_url,
  };
  return alert;
}

export async function telegramAlertsEnabled(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("SELECT enabled FROM owner_alert_preference WHERE id = 1")
    .first<{ enabled: number }>();
  return row?.enabled === 1;
}

export async function setTelegramAlerts(env: Env, enabled: boolean, at: string): Promise<void> {
  if (enabled) {
    await env.DB.prepare("UPDATE owner_alert_preference SET enabled = 1, updated_at = ? WHERE id = 1")
      .bind(at)
      .run();
    return;
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE owner_alert_preference SET enabled = 0, updated_at = ? WHERE id = 1").bind(at),
    env.DB.prepare(
      "UPDATE notification_outbox SET status = 'suppressed', updated_at = ? WHERE status = 'queued'",
    ).bind(at),
  ]);
}

export async function suppressQueuedForProduct(env: Env, productId: string, at: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE notification_outbox
     SET status = 'suppressed', updated_at = ?
     WHERE status = 'queued' AND transition_id IN (
       SELECT id FROM price_transitions WHERE product_id = ?
     )`,
  )
    .bind(at, productId)
    .run();
}

async function preferenceOn(env: Env): Promise<boolean> {
  return telegramAlertsEnabled(env);
}

async function suppressInactive(env: Env, at: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE notification_outbox
     SET status = 'suppressed', updated_at = ?
     WHERE status = 'queued' AND transition_id IN (
       SELECT t.id FROM price_transitions t
       LEFT JOIN watched_products p ON p.id = t.product_id
       WHERE p.id IS NULL OR p.monitoring_status != 'active'
     )`,
  )
    .bind(at)
    .run();
}

async function claimSending(env: Env, transitionId: string, at: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE notification_outbox SET status = 'sending', updated_at = ?
     WHERE transition_id = ? AND status = 'queued'`,
  )
    .bind(at, transitionId)
    .run();
  return changes(result) === 1;
}

async function setOutbox(env: Env, transitionId: string, status: string, at: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE notification_outbox SET status = ?, updated_at = ? WHERE transition_id = ? AND status = 'sending'",
  )
    .bind(status, at, transitionId)
    .run();
}

function deliveryStatus(result: AlertDeliveryResult): "sent" | "failed" | "unknown" | "queued" {
  switch (result.state) {
    case "sent":
      return "sent";
    case "failed":
      return "failed";
    case "unknown":
      return "unknown";
    case "unavailable":
      return result.claimed ? "unknown" : "queued";
    default: {
      const exhaustive: never = result.state;
      return exhaustive;
    }
  }
}

function parseDelivery(value: unknown): AlertDeliveryResult | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { state?: unknown; claimed?: unknown };
  const state = record.state;
  if (state !== "sent" && state !== "failed" && state !== "unknown" && state !== "unavailable") {
    return null;
  }
  if (typeof record.claimed !== "boolean") {
    return null;
  }
  return { state, claimed: record.claimed };
}

async function stillDeliverable(env: Env, transitionId: string): Promise<boolean> {
  if (!(await preferenceOn(env))) {
    return false;
  }
  const row = await env.DB.prepare(
    `SELECT p.monitoring_status AS status
     FROM price_transitions t
     JOIN watched_products p ON p.id = t.product_id
     WHERE t.id = ?`,
  )
    .bind(transitionId)
    .first<{ status: string }>();
  return row?.status === "active";
}

export async function dispatchOutbox(env: Env, now = new Date()): Promise<{ inspected: number }> {
  const at = now.toISOString();
  if (!(await preferenceOn(env))) {
    await env.DB.prepare(
      "UPDATE notification_outbox SET status = 'suppressed', updated_at = ? WHERE status = 'queued'",
    )
      .bind(at)
      .run();
    return { inspected: 0 };
  }
  await suppressInactive(env, at);
  const binding = env.TELEGRAM_ALERTS;
  if (!binding) {
    return { inspected: 0 };
  }
  const queued = await env.DB.prepare(
    `SELECT o.transition_id, t.product_name, t.store_id, t.previous_price, t.price, t.target_price,
            t.price_drop, t.target_crossed, t.observed_at, t.product_url
     FROM notification_outbox o
     JOIN price_transitions t ON t.id = o.transition_id
     JOIN watched_products p ON p.id = t.product_id
     WHERE o.status = 'queued' AND p.monitoring_status = 'active'
     ORDER BY o.created_at ASC
     LIMIT ?`,
  )
    .bind(DISPATCH_LIMIT)
    .all<OutboxRow>();

  let inspected = 0;
  for (const row of queued.results) {
    inspected += 1;
    const stamp = new Date().toISOString();
    if (!(await claimSending(env, row.transition_id, stamp))) {
      continue;
    }
    if (!(await stillDeliverable(env, row.transition_id))) {
      await setOutbox(env, row.transition_id, "suppressed", stamp);
      continue;
    }
    const alert = buildAlert(row);
    if (!alert) {
      await setOutbox(env, row.transition_id, "failed", stamp);
      continue;
    }
    try {
      const parsed = parseDelivery(await binding.deliver(alert));
      const next = parsed ? deliveryStatus(parsed) : "unknown";
      await setOutbox(env, row.transition_id, next, new Date().toISOString());
    } catch {
      await setOutbox(env, row.transition_id, "unknown", new Date().toISOString());
    }
  }
  return { inspected };
}
