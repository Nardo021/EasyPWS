import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { createId } from "@easypws/core";
import type { Database } from "./client.js";
import {
  apiTokens,
  notificationChannels,
  stores,
  users,
  watchlists,
} from "./schema.js";

export interface BootstrapResult {
  userId: string;
  watchlistId: string;
  bootstrapToken?: string | undefined;
  haToken?: string | undefined;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mintToken(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

/**
 * Ensures a bootstrap admin user, default watchlist, Coles store, and optional tokens.
 */
export async function bootstrapSystem(
  db: Database,
  options: {
    email?: string;
    displayName?: string;
    colesStoreId?: string;
    colesStoreName?: string;
    haWebhookUrl?: string;
    issueTokens?: boolean;
  } = {},
): Promise<BootstrapResult> {
  const email =
    options.email ?? process.env["BOOTSTRAP_EMAIL"] ?? "admin@easypws.local";
  const displayName = options.displayName ?? "EasyPWS Admin";
  const colesStoreExternal =
    options.colesStoreId ?? process.env["COLES_STORE_ID"] ?? "647";
  const colesStoreName =
    options.colesStoreName ??
    process.env["COLES_STORE_NAME"] ??
    "Default Coles Store";

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  let userId = existing[0]?.id;
  if (!userId) {
    userId = createId("user");
    await db.insert(users).values({
      id: userId,
      email,
      displayName,
    });
  }

  const existingLists = await db
    .select()
    .from(watchlists)
    .where(eq(watchlists.userId, userId))
    .limit(1);
  let watchlistId = existingLists[0]?.id;
  if (!watchlistId) {
    watchlistId = createId("wlist");
    await db.insert(watchlists).values({
      id: watchlistId,
      userId,
      name: "Default",
    });
  }

  const storeId = `store_coles_${colesStoreExternal}`;
  const existingStore = await db
    .select()
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!existingStore[0]) {
    await db.insert(stores).values({
      id: storeId,
      retailerId: "coles",
      externalStoreId: colesStoreExternal,
      name: colesStoreName,
      region: "AU",
      timezone: "Australia/Sydney",
    });
  }

  const haWebhookUrl = options.haWebhookUrl ?? process.env["HA_WEBHOOK_URL"];
  if (haWebhookUrl) {
    const channels = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, userId))
      .limit(10);
    const hasHa = channels.some(
      (c: { type: string }) => c.type === "ha_webhook",
    );
    if (!hasHa) {
      await db.insert(notificationChannels).values({
        id: createId("nchan"),
        userId,
        type: "ha_webhook",
        name: "Home Assistant",
        config: { url: haWebhookUrl },
        enabled: true,
      });
    }
  }

  let bootstrapToken: string | undefined;
  let haToken: string | undefined;
  const shouldIssue =
    options.issueTokens ?? process.env["BOOTSTRAP_ISSUE_TOKENS"] === "true";
  if (shouldIssue) {
    const existingTokens = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .limit(1);
    if (!existingTokens[0]) {
      bootstrapToken = mintToken("epws");
      haToken = mintToken("epws_ha");
      await db.insert(apiTokens).values([
        {
          id: createId("tok"),
          userId,
          name: "Bootstrap admin",
          scopes: ["read", "write", "admin"],
          tokenPrefix: bootstrapToken.slice(0, 12),
          tokenHash: hashToken(bootstrapToken),
        },
        {
          id: createId("tok"),
          userId,
          name: "Home Assistant",
          scopes: ["read", "write", "ha_integration"],
          tokenPrefix: haToken.slice(0, 12),
          tokenHash: hashToken(haToken),
        },
      ]);
    }
  }

  return { userId, watchlistId, bootstrapToken, haToken };
}
