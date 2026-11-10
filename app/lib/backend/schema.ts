import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  numeric,
  uniqueIndex,
  index,
  boolean,
} from "drizzle-orm/pg-core";
const created = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const users = pgTable("users", {
  id: uuid().defaultRandom().primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  verifiedEmail: boolean("verified_email").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id").unique(),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const reports = pgTable(
  "reports",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("reports_owner_idx").on(table.userId)],
);
export const reportVersions = pgTable(
  "report_versions",
  {
    id: uuid().defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id),
    versionNumber: integer("version_number").notNull(),
    currency: text().notNull(),
    currentPeriod: text("current_period").notNull(),
    previousPeriod: text("previous_period"),
    normalizedSummaryJson: jsonb("normalized_summary_json").notNull(),
    summaryHash: text("summary_hash").notNull(),
    status: text().notNull().default("confirmed"),
    createdAt: created(),
  },
  (table) => [
    uniqueIndex("report_version_number_idx").on(
      table.reportId,
      table.versionNumber,
    ),
  ],
);
export const investors = pgTable(
  "investors",
  {
    id: uuid().defaultRandom().primaryKey(),
    reportVersionId: uuid("report_version_id")
      .notNull()
      .references(() => reportVersions.id),
    localReference: uuid("local_reference").notNull(),
    createdAt: created(),
  },
  (table) => [
    uniqueIndex("investor_version_reference_idx").on(
      table.reportVersionId,
      table.localReference,
    ),
  ],
);
export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid().defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    source: text().notNull(),
    status: text().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    reportScopeId: uuid("report_scope_id").references(() => reports.id),
  },
  (table) => [index("entitlement_owner_idx").on(table.userId)],
);
export const subscriptions = pgTable("subscriptions", {
  id: text().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  customerId: text("customer_id").notNull(),
  priceId: text("price_id").notNull(),
  status: text().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const aiAnalysisRequests = pgTable(
  "ai_analysis_requests",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    reportVersionId: uuid("report_version_id")
      .notNull()
      .references(() => reportVersions.id),
    revision: text().notNull(),
    scope: text().notNull(),
    selectedInvestorReferences: jsonb("selected_investor_references").notNull(),
    scopeKey: text("scope_key").notNull(),
    status: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    consentVersion: text("consent_version").notNull(),
    createdAt: created(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    inputTokenCount: integer("input_token_count"),
    outputTokenCount: integer("output_token_count"),
    reservedCostUsd: numeric("reserved_cost_usd", {
      precision: 16,
      scale: 8,
    }).notNull(),
    actualCostUsd: numeric("actual_cost_usd", { precision: 16, scale: 8 }),
    errorCategory: text("error_category"),
  },
  (table) => [
    index("analysis_owner_created_idx").on(table.userId, table.createdAt),
  ],
);
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: uuid().defaultRandom().primaryKey(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  status: text().notNull(),
});
export const auditEvents = pgTable("audit_events", {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  eventType: text("event_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  metadataJson: jsonb("metadata_json").notNull(),
  createdAt: created(),
});
