
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  pgPolicy,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  bigint,
  smallint,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";


export const APP_RW = "app_rw";
export const APP_RO = "app_ro";

const actorId = sql`nullif(current_setting('app.actor_id', true), '')::uuid`;
const isAdmin = sql`nullif(current_setting('app.actor_role', true), '') = 'ADMIN'`;
const guestCartId = sql`nullif(current_setting('app.guest_cart_id', true), '')`;


export const userRole = pgEnum("user_role", ["USER", "ADMIN"]);

export const paymentMethod = pgEnum("payment_method", ["CARD", "CASH_ON_DELIVERY", "ESEWA"]);

export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "PAID",
  "FAILED",
  "REFUNDED",
]);

export const orderStatus = pgEnum("order_status", [
  "PENDING_PAYMENT",
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);

export const couponType = pgEnum("coupon_type", ["PERCENT", "FIXED"]);

export const webhookStatus = pgEnum("webhook_status", [
  "PENDING",
  "DELIVERED",
  "FAILED",
]);


export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    emailBlindIndex: text("email_blind_index"),
    image: text("image"),
    role: userRole("role").notNull().default("USER"),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    phoneEncrypted: text("phone_encrypted"),
    tokenVersion: integer("token_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    uniqueIndex("users_email_blind_index_uq").on(t.emailBlindIndex),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: uuid("impersonated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_uq").on(t.token),
    index("sessions_user_id_idx").on(t.userId),
  ]
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("accounts_user_id_idx").on(t.userId),
    uniqueIndex("accounts_provider_account_uq").on(t.providerId, t.accountId),
  ]
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)]
);

export const jwks = pgTable("jwks", {
  id: uuid("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const passkeys = pgTable(
  "passkeys",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    credentialId: text("credential_id").notNull(),
    counter: integer("counter").notNull().default(0),
    deviceType: text("device_type").notNull().default("singleDevice"),
    backedUp: boolean("backed_up").notNull().default(false),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("passkeys_user_id_idx").on(t.userId),
    uniqueIndex("passkeys_credential_id_uq").on(t.credentialId),
  ]
);

export const twoFactors = pgTable(
  "two_factors",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [index("two_factors_user_id_idx").on(t.userId)]
);


export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    imageUrl: text("image_url"),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categories_slug_uq").on(t.slug)]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    originalPricePaisa: bigint("original_price_paisa", { mode: "bigint" }).notNull(),
    salePricePaisa: bigint("sale_price_paisa", { mode: "bigint" }).notNull(),
    discountPercent: smallint("discount_percent").notNull().default(0),
    discountLabel: text("discount_label"),
    unit: varchar("unit", { length: 32 }).notNull().default("pc"),
    stock: integer("stock").notNull().default(0),
    perOrderLimit: integer("per_order_limit").notNull().default(10),
    ratingAverage: integer("rating_average_milli").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_slug_uq").on(t.slug),
    index("products_category_id_idx").on(t.categoryId),
    index("products_is_active_idx").on(t.isActive),
    check("products_original_price_nonneg", sql`${t.originalPricePaisa} >= 0`),
    check("products_sale_price_nonneg", sql`${t.salePricePaisa} >= 0`),
    check("products_sale_le_original", sql`${t.salePricePaisa} <= ${t.originalPricePaisa}`),
    check("products_stock_nonneg", sql`${t.stock} >= 0`), // race-proof oversell guard
    check("products_per_order_limit_pos", sql`${t.perOrderLimit} >= 1`),
    check(
      "products_discount_range",
      sql`${t.discountPercent} >= 0 AND ${t.discountPercent} <= 100`
    ),
    check(
      "products_rating_range",
      sql`${t.ratingAverage} >= 0 AND ${t.ratingAverage} <= 5000`
    ),
  ]
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    position: smallint("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_images_product_id_idx").on(t.productId)]
);


export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientNameEncrypted: text("recipient_name_encrypted").notNull(),
    phoneEncrypted: text("phone_encrypted").notNull(),
    streetEncrypted: text("street_encrypted").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCodeEncrypted: text("postal_code_encrypted").notNull(),
    country: text("country").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("addresses_user_id_idx").on(t.userId),
    uniqueIndex("addresses_one_default_per_user")
      .on(t.userId)
      .where(sql`${t.isDefault} = true`),
    pgPolicy("addresses_owner", {
      as: "permissive",
      for: "all",
      to: APP_RW,
      using: sql`${t.userId} = ${actorId} OR ${isAdmin}`,
      withCheck: sql`${t.userId} = ${actorId} OR ${isAdmin}`,
    }),
  ]
).enableRLS();


export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    guestCartId: text("guest_cart_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("carts_user_id_uq").on(t.userId).where(sql`${t.userId} IS NOT NULL`),
    uniqueIndex("carts_guest_id_uq")
      .on(t.guestCartId)
      .where(sql`${t.guestCartId} IS NOT NULL`),
    check(
      "carts_owner_xor",
      sql`(${t.userId} IS NOT NULL) <> (${t.guestCartId} IS NOT NULL)`
    ),
    pgPolicy("carts_owner", {
      as: "permissive",
      for: "all",
      to: APP_RW,
      using: sql`${t.userId} = ${actorId} OR ${t.guestCartId} = ${guestCartId} OR ${isAdmin}`,
      withCheck: sql`${t.userId} = ${actorId} OR ${t.guestCartId} = ${guestCartId} OR ${isAdmin}`,
    }),
  ]
).enableRLS();

export const cartItems = pgTable(
  "cart_items",
  {
    id: uuid("id").primaryKey(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cart_items_cart_id_idx").on(t.cartId),
    uniqueIndex("cart_items_cart_product_uq").on(t.cartId, t.productId),
    check("cart_items_quantity_pos", sql`${t.quantity} >= 1`),
    pgPolicy("cart_items_via_cart", {
      as: "permissive",
      for: "all",
      to: APP_RW,
      using: sql`EXISTS (SELECT 1 FROM carts c WHERE c.id = ${t.cartId} AND (c.user_id = ${actorId} OR c.guest_cart_id = ${guestCartId} OR ${isAdmin}))`,
      withCheck: sql`EXISTS (SELECT 1 FROM carts c WHERE c.id = ${t.cartId} AND (c.user_id = ${actorId} OR c.guest_cart_id = ${guestCartId} OR ${isAdmin}))`,
    }),
  ]
).enableRLS();


export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    type: couponType("type").notNull(),
    value: bigint("value", { mode: "bigint" }).notNull(),
    minSpendPaisa: bigint("min_spend_paisa", { mode: "bigint" }).notNull().default(sql`0`),
    maxRedemptions: integer("max_redemptions"),
    perUserLimit: integer("per_user_limit").notNull().default(1),
    timesRedeemed: integer("times_redeemed").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    stackable: boolean("stackable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("coupons_code_uq").on(t.code),
    check("coupons_value_pos", sql`${t.value} > 0`),
    check(
      "coupons_percent_range",
      sql`${t.type} <> 'PERCENT' OR (${t.value} >= 1 AND ${t.value} <= 100)`
    ),
    check("coupons_min_spend_nonneg", sql`${t.minSpendPaisa} >= 0`),
    check("coupons_per_user_pos", sql`${t.perUserLimit} >= 1`),
    check(
      "coupons_max_redemptions_pos",
      sql`${t.maxRedemptions} IS NULL OR ${t.maxRedemptions} >= 1`
    ),
    check("coupons_times_redeemed_nonneg", sql`${t.timesRedeemed} >= 0`),
  ]
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").primaryKey(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderId: uuid("order_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("coupon_per_user_uq").on(t.couponId, t.userId),
    index("coupon_redemptions_user_idx").on(t.userId),
  ]
);


export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    orderNo: text("order_no").notNull(),
    shipRecipientEncrypted: text("ship_recipient_encrypted").notNull(),
    shipPhoneEncrypted: text("ship_phone_encrypted").notNull(),
    shipStreetEncrypted: text("ship_street_encrypted").notNull(),
    shipCity: text("ship_city").notNull(),
    shipState: text("ship_state").notNull(),
    shipPostalEncrypted: text("ship_postal_encrypted").notNull(),
    shipCountry: text("ship_country").notNull(),
    paymentMethod: paymentMethod("payment_method").notNull(),
    paymentStatus: paymentStatus("payment_status").notNull().default("PENDING"),
    status: orderStatus("status").notNull().default("PENDING_PAYMENT"),
    subtotalPaisa: bigint("subtotal_paisa", { mode: "bigint" }).notNull(),
    discountPaisa: bigint("discount_paisa", { mode: "bigint" }).notNull().default(sql`0`),
    deliveryFeePaisa: bigint("delivery_fee_paisa", { mode: "bigint" }).notNull().default(sql`0`),
    taxPaisa: bigint("tax_paisa", { mode: "bigint" }).notNull().default(sql`0`),
    totalPaisa: bigint("total_paisa", { mode: "bigint" }).notNull(),
    couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_order_no_uq").on(t.orderNo),
    index("orders_user_id_idx").on(t.userId),
    index("orders_status_idx").on(t.status),
    check("orders_subtotal_nonneg", sql`${t.subtotalPaisa} >= 0`),
    check("orders_discount_nonneg", sql`${t.discountPaisa} >= 0`),
    check("orders_delivery_nonneg", sql`${t.deliveryFeePaisa} >= 0`),
    check("orders_tax_nonneg", sql`${t.taxPaisa} >= 0`),
    check("orders_total_nonneg", sql`${t.totalPaisa} >= 0`),
    check("orders_discount_le_subtotal", sql`${t.discountPaisa} <= ${t.subtotalPaisa}`),
    pgPolicy("orders_owner", {
      as: "permissive",
      for: "all",
      to: APP_RW,
      using: sql`${t.userId} = ${actorId} OR ${isAdmin}`,
      withCheck: sql`${t.userId} = ${actorId} OR ${isAdmin}`,
    }),
  ]
).enableRLS();

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    productName: text("product_name").notNull(),
    imageUrl: text("image_url"),
    unitPricePaisa: bigint("unit_price_paisa", { mode: "bigint" }).notNull(),
    originalPricePaisa: bigint("original_price_paisa", { mode: "bigint" }).notNull(),
    discountPercent: smallint("discount_percent").notNull().default(0),
    quantity: integer("quantity").notNull(),
    isReviewed: boolean("is_reviewed").notNull().default(false),
  },
  (t) => [
    index("order_items_order_id_idx").on(t.orderId),
    check("order_items_quantity_pos", sql`${t.quantity} >= 1`),
    check("order_items_unit_price_nonneg", sql`${t.unitPricePaisa} >= 0`),
    pgPolicy("order_items_via_order", {
      as: "permissive",
      for: "all",
      to: APP_RW,
      using: sql`EXISTS (SELECT 1 FROM orders o WHERE o.id = ${t.orderId} AND (o.user_id = ${actorId} OR ${isAdmin}))`,
      withCheck: sql`EXISTS (SELECT 1 FROM orders o WHERE o.id = ${t.orderId} AND (o.user_id = ${actorId} OR ${isAdmin}))`,
    }),
  ]
).enableRLS();

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    status: orderStatus("status").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_status_history_order_id_idx").on(t.orderId)]
);


export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("stripe"),
    gatewayTxnId: text("gateway_txn_id"),
    amountPaisa: bigint("amount_paisa", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),
    status: paymentStatus("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_txn_unique")
      .on(t.gatewayTxnId)
      .where(sql`${t.gatewayTxnId} IS NOT NULL`),
    index("payments_order_id_idx").on(t.orderId),
    check("payments_amount_nonneg", sql`${t.amountPaisa} >= 0`),
    pgPolicy("payments_owner", {
      as: "permissive",
      for: "all",
      to: APP_RW,
      using: sql`${t.userId} = ${actorId} OR ${isAdmin}`,
      withCheck: sql`${t.userId} = ${actorId} OR ${isAdmin}`,
    }),
  ]
).enableRLS();


export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    rating: smallint("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reviews_order_item_uq").on(t.orderItemId),
    index("reviews_product_id_idx").on(t.productId),
    index("reviews_user_id_idx").on(t.userId),
    check("reviews_rating_range", sql`${t.rating} >= 1 AND ${t.rating} <= 5`),
    pgPolicy("reviews_read_all_write_owner", {
      as: "permissive",
      for: "all",
      to: APP_RW,
      using: sql`true`,
      withCheck: sql`${t.userId} = ${actorId} OR ${isAdmin}`,
    }),
  ]
).enableRLS();


export const wishlists = pgTable(
  "wishlists",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shareToken: text("share_token"),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wishlists_user_id_uq").on(t.userId),
    uniqueIndex("wishlists_share_token_uq")
      .on(t.shareToken)
      .where(sql`${t.shareToken} IS NOT NULL`),
  ]
);

export const wishlistItems = pgTable(
  "wishlist_items",
  {
    id: uuid("id").primaryKey(),
    wishlistId: uuid("wishlist_id")
      .notNull()
      .references(() => wishlists.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wishlist_items_uq").on(t.wishlistId, t.productId)]
);


export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(), // validated through safeFetch allowlist before every send
    secretEncrypted: text("secret_encrypted").notNull(), // HMAC signing key, encrypted at rest
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_user_id_idx").on(t.userId)]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    status: webhookStatus("status").notNull().default("PENDING"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_deliveries_endpoint_idx").on(t.endpointId)]
);


export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(), // e.g. AUTH_LOGIN, ORDER_STATUS_CHANGE, COUPON_REDEEM
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    correlationId: text("correlation_id"),
    ip: text("ip"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_actor_idx").on(t.actorUserId),
    index("audit_log_action_idx").on(t.action),
    index("audit_log_created_at_idx").on(t.createdAt),
  ]
);


export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    method: varchar("method", { length: 8 }).notNull(),
    path: text("path").notNull(),
    responseHash: text("response_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_keys_uq").on(t.userId, t.key, t.method, t.path)]
);


export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Address = typeof addresses.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Payment = typeof payments.$inferSelect;
