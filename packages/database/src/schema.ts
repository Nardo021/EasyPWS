import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const ts = (name: string) => integer(name, { mode: "timestamp_ms" });

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  oidcSubject: text("oidc_subject").unique(),
  createdAt: ts("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: ts("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const retailers = sqliteTable("retailers", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  baseUrl: text("base_url").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const stores = sqliteTable(
  "stores",
  {
    id: text("id").primaryKey(),
    retailerId: text("retailer_id")
      .notNull()
      .references(() => retailers.id),
    externalStoreId: text("external_store_id").notNull(),
    name: text("name").notNull(),
    region: text("region"),
    timezone: text("timezone"),
  },
  (t) => [
    uniqueIndex("stores_retailer_external").on(t.retailerId, t.externalStoreId),
  ],
);

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  barcode: text("barcode"),
  brand: text("brand"),
  name: text("name").notNull(),
  size: text("size"),
  category: text("category"),
  imageUrl: text("image_url"),
  createdAt: ts("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: ts("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const productIdentifiers = sqliteTable(
  "product_identifiers",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    value: text("value").notNull(),
  },
  (t) => [uniqueIndex("product_identifiers_type_value").on(t.type, t.value)],
);

export const retailerListings = sqliteTable(
  "retailer_listings",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    retailer: text("retailer")
      .notNull()
      .references(() => retailers.id),
    retailerProductId: text("retailer_product_id").notNull(),
    productUrl: text("product_url").notNull(),
    storeId: text("store_id").references(() => stores.id),
    currentPrice: real("current_price"),
    regularPrice: real("regular_price"),
    unitPrice: real("unit_price"),
    unit: text("unit"),
    inStock: integer("in_stock", { mode: "boolean" }).notNull().default(true),
    promotionType: text("promotion_type").notNull().default("none"),
    lastCheckedAt: ts("last_checked_at"),
    checkTier: text("check_tier").notNull().default("normal"),
    nextCheckAt: ts("next_check_at"),
    createdAt: ts("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: ts("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("listings_retailer_product_store").on(
      t.retailer,
      t.retailerProductId,
      t.storeId,
    ),
    index("idx_listings_next_check").on(t.nextCheckAt),
  ],
);

export const priceObservations = sqliteTable(
  "price_observations",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => retailerListings.id, { onDelete: "cascade" }),
    price: real("price").notNull(),
    regularPrice: real("regular_price"),
    unitPrice: real("unit_price"),
    promotionType: text("promotion_type").notNull().default("none"),
    inStock: integer("in_stock", { mode: "boolean" }).notNull().default(true),
    observedAt: ts("observed_at")
      .notNull()
      .$defaultFn(() => new Date()),
    source: text("source").notNull(),
    rawHash: text("raw_hash"),
  },
  (t) => [index("idx_price_obs_listing_time").on(t.listingId, t.observedAt)],
);

export const watchlists = sqliteTable("watchlists", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: ts("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: ts("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const watchlistItems = sqliteTable(
  "watchlist_items",
  {
    id: text("id").primaryKey(),
    watchlistId: text("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    listingId: text("listing_id")
      .notNull()
      .references(() => retailerListings.id),
    status: text("status").notNull().default("active"),
    targetPrice: real("target_price"),
    createdAt: ts("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: ts("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("watchlist_items_unique").on(t.watchlistId, t.listingId)],
);

export const watchRules = sqliteTable("watch_rules", {
  id: text("id").primaryKey(),
  watchlistItemId: text("watchlist_item_id")
    .notNull()
    .references(() => watchlistItems.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  operator: text("operator").notNull(),
  value: real("value"),
  cooldownHours: integer("cooldown_hours").notNull().default(24),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastTriggeredAt: ts("last_triggered_at"),
  createdAt: ts("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: ts("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const notificationChannels = sqliteTable("notification_channels", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  config: text("config", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: ts("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const notificationEvents = sqliteTable(
  "notification_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id").references(() => notificationChannels.id),
    watchRuleId: text("watch_rule_id").references(() => watchRules.id),
    listingId: text("listing_id")
      .notNull()
      .references(() => retailerListings.id),
    kind: text("kind").notNull(),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: ts("created_at")
      .notNull()
      .$defaultFn(() => new Date()),
    deliveredAt: ts("delivered_at"),
    error: text("error"),
  },
  (t) => [uniqueIndex("idx_notification_dedupe").on(t.dedupeKey)],
);

export const collectionJobs = sqliteTable("collection_jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  listingId: text("listing_id").references(() => retailerListings.id, {
    onDelete: "cascade",
  }),
  status: text("status").notNull().default("queued"),
  priority: integer("priority").notNull().default(100),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  runAfter: ts("run_after")
    .notNull()
    .$defaultFn(() => new Date()),
  lockedAt: ts("locked_at"),
  lastError: text("last_error"),
  createdAt: ts("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: ts("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const adapterHealth = sqliteTable("adapter_health", {
  retailer: text("retailer")
    .primaryKey()
    .references(() => retailers.id),
  status: text("status").notNull(),
  latencyMs: integer("latency_ms"),
  message: text("message"),
  checkedAt: ts("checked_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scopes: text("scopes", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  tokenPrefix: text("token_prefix").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: ts("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  lastUsedAt: ts("last_used_at"),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
});
