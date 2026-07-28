import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  oidcSubject: text("oidc_subject").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const retailers = pgTable("retailers", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  baseUrl: text("base_url").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

export const stores = pgTable(
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
  (t) => [uniqueIndex("stores_retailer_external").on(t.retailerId, t.externalStoreId)],
);

export const products = pgTable("products", {
  id: text("id").primaryKey(),
  barcode: text("barcode"),
  brand: text("brand"),
  name: text("name").notNull(),
  size: text("size"),
  category: text("category"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productIdentifiers = pgTable(
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

export const retailerListings = pgTable(
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
    currentPrice: numeric("current_price", { precision: 12, scale: 2 }),
    regularPrice: numeric("regular_price", { precision: 12, scale: 2 }),
    unitPrice: numeric("unit_price", { precision: 12, scale: 4 }),
    unit: text("unit"),
    inStock: boolean("in_stock").notNull().default(true),
    promotionType: text("promotion_type").notNull().default("none"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    checkTier: text("check_tier").notNull().default("normal"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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

export const priceObservations = pgTable(
  "price_observations",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => retailerListings.id, { onDelete: "cascade" }),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    regularPrice: numeric("regular_price", { precision: 12, scale: 2 }),
    unitPrice: numeric("unit_price", { precision: 12, scale: 4 }),
    promotionType: text("promotion_type").notNull().default("none"),
    inStock: boolean("in_stock").notNull().default(true),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    rawHash: text("raw_hash"),
  },
  (t) => [index("idx_price_obs_listing_time").on(t.listingId, t.observedAt)],
);

export const watchlists = pgTable("watchlists", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const watchlistItems = pgTable(
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
    targetPrice: numeric("target_price", { precision: 12, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("watchlist_items_unique").on(t.watchlistId, t.listingId)],
);

export const watchRules = pgTable("watch_rules", {
  id: text("id").primaryKey(),
  watchlistItemId: text("watchlist_item_id")
    .notNull()
    .references(() => watchlistItems.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  operator: text("operator").notNull(),
  value: numeric("value", { precision: 12, scale: 4 }),
  cooldownHours: integer("cooldown_hours").notNull().default(24),
  enabled: boolean("enabled").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationChannels = pgTable("notification_channels", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationEvents = pgTable(
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
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [uniqueIndex("idx_notification_dedupe").on(t.dedupeKey)],
);

export const collectionJobs = pgTable("collection_jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  listingId: text("listing_id").references(() => retailerListings.id, {
    onDelete: "cascade",
  }),
  status: text("status").notNull().default("queued"),
  priority: integer("priority").notNull().default(100),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adapterHealth = pgTable("adapter_health", {
  retailer: text("retailer")
    .primaryKey()
    .references(() => retailers.id),
  status: text("status").notNull(),
  latencyMs: integer("latency_ms"),
  message: text("message"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  tokenPrefix: text("token_prefix").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
