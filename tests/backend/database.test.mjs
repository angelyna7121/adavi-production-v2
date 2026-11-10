import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const requested = process.env.RUN_DATABASE_TESTS === "1";
const hostname = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL).hostname
  : "";
const safeDatabase =
  process.env.NODE_ENV !== "production" &&
  (["localhost", "127.0.0.1"].includes(hostname) ||
    ["development", "preview"].includes(process.env.APP_DATA_ENV));
if (requested && !safeDatabase)
  throw new Error(
    "Database integration tests require an explicitly isolated development/preview database.",
  );
const enabled = requested && safeDatabase;
const { db, closeDb } = await import("../../app/lib/backend/db.ts");
const { users, entitlements, aiAnalysisRequests, stripeWebhookEvents } =
  await import("../../app/lib/backend/schema.ts");
const { saveReport, loadReportVersion } = await import(
  "../../app/lib/backend/reportStore.ts"
);
const { resolveEntitlement } = await import(
  "../../app/lib/backend/resolveEntitlement.ts"
);
const { reservationStore } = await import(
  "../../app/lib/backend/reservationStore.ts"
);
const { AnalysisAllowance } = await import(
  "../../app/lib/financialInsights/server/allowance.ts"
);
const { processStripeEvent } = await import(
  "../../app/lib/backend/stripeWebhook.ts"
);
const { eq } = await import("drizzle-orm");
after(async () => {
  await closeDb();
});
const fixture = () => ({
  version: "1",
  currency: "CAD",
  currentPeriod: "2026-10-24",
  previousPeriod: "2026-09-30",
  confirmed: true,
  investors: [
    {
      localReference: randomUUID(),
      categories: [
        {
          category: "Investments",
          kind: "Asset",
          current: 1000,
          previous: 500,
          accountCount: 1,
          missingPreviousCount: 0,
          lowConfidenceCount: 0,
        },
      ],
      excludedRowCount: 0,
    },
  ],
});
const createUser = async () => {
  const [user] = await db()
    .insert(users)
    .values({
      clerkUserId: "test_" + randomUUID(),
      verifiedEmail: true,
      stripeCustomerId: "cus_" + randomUUID().replaceAll("-", ""),
    })
    .returning();
  return user;
};
test(
  "PostgreSQL/Drizzle persists anonymous report versions and isolates every user query",
  { skip: !enabled },
  async () => {
    const a = await createUser(),
      b = await createUser(),
      saved = await saveReport(a.id, fixture());
    assert.ok(await loadReportVersion(a.id, saved.reportVersionId));
    assert.equal(await loadReportVersion(b.id, saved.reportVersionId), null);
    assert.equal(await loadReportVersion(a.id, randomUUID()), null);
  },
);
test(
  "PostgreSQL transaction locks prevent cross-instance duplicate AI reservations",
  { skip: !enabled },
  async () => {
    const user = await createUser(),
      saved = await saveReport(user.id, fixture()),
      policy = {
        dailyPerUser: 5,
        dailyPerAccount: 5,
        perReportVersion: 3,
        monthlyCostUsd: 1,
        maximumRequestCostUsd: 0.1,
        maximumCategories: 20,
        perMinuteUser: 6,
        perMinuteAccount: 6,
      },
      ledger = new AnalysisAllowance(reservationStore("test-only"), policy);
    const input = {
      session: { userId: user.id, accountId: user.id, emailVerified: true },
      versionId: saved.reportVersionId,
      revision: "test",
      investorIds: Object.values(saved.investorMap),
    };
    const results = await Promise.allSettled([
      ledger.reserve({ ...input, requestId: randomUUID() }),
      ledger.reserve({ ...input, requestId: randomUUID() }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rows = await db()
      .select()
      .from(aiAnalysisRequests)
      .where(eq(aiAnalysisRequests.userId, user.id));
    assert.equal(rows.length, 1);
  },
);
test(
  "verified Stripe events activate allowlisted subscriptions once, expire/cancel, and permanently revoke refunds",
  { skip: !enabled },
  async () => {
    const user = await createUser();
    let subscription = {
      id: "sub_" + randomUUID(),
      customer: user.stripeCustomerId,
      status: "active",
      items: {
        data: [
          {
            price: { id: "price_approved" },
            current_period_end: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
      },
    };
    const stripe = {
      subscriptions: { retrieve: async () => subscription },
      invoicePayments: {
        list: async () => ({ data: [{ invoice: "in_test" }], has_more: false }),
      },
      invoices: {
        retrieve: async () => ({
          parent: { subscription_details: { subscription: subscription.id } },
        }),
      },
    };
    const event = {
      id: "evt_" + randomUUID(),
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: subscription },
    };
    await processStripeEvent(event, stripe, ["price_approved"]);
    await processStripeEvent(event, stripe, ["price_approved"]);
    assert.equal(
      (
        await db()
          .select()
          .from(stripeWebhookEvents)
          .where(eq(stripeWebhookEvents.stripeEventId, event.id))
      ).length,
      1,
    );
    assert.equal((await resolveEntitlement(user.id)).source, "premium");
    subscription = { ...subscription, status: "canceled" };
    await processStripeEvent({ ...event, id: "evt_" + randomUUID() }, stripe, [
      "price_approved",
    ]);
    assert.equal((await resolveEntitlement(user.id)).source, "free");
    subscription = {
      ...subscription,
      id: "sub_" + randomUUID(),
      status: "active",
    };
    await processStripeEvent({ ...event, id: "evt_" + randomUUID() }, stripe, [
      "price_approved",
    ]);
    assert.equal((await resolveEntitlement(user.id)).source, "premium");
    await processStripeEvent(
      {
        id: "evt_" + randomUUID(),
        type: "charge.refunded",
        livemode: false,
        data: { object: { payment_intent: "pi_test" } },
      },
      stripe,
      ["price_approved"],
    );
    assert.equal((await resolveEntitlement(user.id)).source, "free");
    await processStripeEvent({ ...event, id: "evt_" + randomUUID() }, stripe, [
      "price_approved",
    ]);
    assert.equal((await resolveEntitlement(user.id)).source, "free");
    const records = await db()
      .select()
      .from(entitlements)
      .where(eq(entitlements.userId, user.id));
    assert.ok(records[0].revokedAt);
  },
);
test(
  "persisted authorized summaries reach the provider only after durable authorization and reservation",
  { skip: !enabled },
  async () => {
    const { analyzeAuthorized } = await import(
      "../../app/lib/financialInsights/server/live.ts"
    );
    const { CONSENT_VERSION } = await import(
      "../../app/lib/financialInsights/notices.ts"
    );
    const { SECTION_TITLES } = await import(
      "../../app/lib/financialInsights/contracts.ts"
    );
    const user = await createUser(),
      saved = await saveReport(user.id, fixture());
    await db()
      .insert(entitlements)
      .values({
        userId: user.id,
        source: "complimentary",
        status: "active",
        expiresAt: new Date(Date.now() + 60000),
      });
    const policy = {
        dailyPerUser: 5,
        dailyPerAccount: 5,
        perReportVersion: 3,
        monthlyCostUsd: 1,
        maximumRequestCostUsd: 0.1,
        maximumCategories: 20,
        perMinuteUser: 6,
        perMinuteAccount: 6,
      },
      ledger = new AnalysisAllowance(reservationStore("test-only"), policy),
      session = { userId: user.id, accountId: user.id, emailVerified: true };
    let sent;
    const deps = {
      authenticate: async () => session,
      entitlement: async () => {
        const decision = await resolveEntitlement(user.id);
        return {
          canAnalyzeFinancialPosition: decision.canAnalyzeFinancialPosition,
          source: decision.source,
          expiresAt: decision.expiresAt.getTime(),
        };
      },
      loadReport: async (s, id) => {
        const result = await loadReportVersion(s.userId, id);
        if (!result) return null;
        return {
          accountId: s.userId,
          versionId: id,
          revision: result.version.summaryHash,
          confirmed: true,
          rows: [],
          investors: result.investors.map((i) => ({
            investorId: i.id,
            name: i.id,
          })),
          authorizedInvestorIds: result.investors.map((i) => i.id),
          normalized: result.normalized,
          investorReferences: Object.fromEntries(
            result.investors.map((i) => [i.id, i.localReference]),
          ),
          date: result.normalized.currentPeriod,
          currency: "CAD",
          currencies: ["CAD"],
        };
      },
      reserve: (input) => ledger.reserve(input),
      complete: (...args) => ledger.complete(...args),
      fail: (...args) => ledger.fail(...args),
      limits: policy,
      model: "test-only",
      provider: {
        name: "test-only",
        estimateMaximumCostUsd: () => 0.05,
        analyzeFinancialPosition: async (summary) => {
          sent = summary;
          return {
            insights: {
              sections: Object.keys(SECTION_TITLES).map((id) => ({
                id,
                narrative:
                  "The referenced metrics describe the recorded financial position.",
                metricIds: ["assets.current"],
                limitations: [],
              })),
              questions: Array.from({ length: 3 }, () => ({
                text: "Which supporting records should be reviewed?",
                metricIds: ["assets.current"],
              })),
            },
            usage: {
              inputTokens: 10,
              outputTokens: 20,
              estimatedCostUsd: 0.001,
              latencyMs: 1,
            },
          };
        },
      },
    };
    const result = await analyzeAuthorized(
      new Request("https://preview.example"),
      session,
      {
        reportVersionId: saved.reportVersionId,
        investorIds: Object.values(saved.investorMap),
        consent: true,
        consentVersion: CONSENT_VERSION,
      },
      deps,
    );
    assert.equal(result.source, "live");
    assert.equal(
      sent.metrics.find((metric) => metric.id === "assets.current").value,
      1000,
    );
    assert.doesNotMatch(
      JSON.stringify(sent),
      /localReference|filename|investorId/,
    );
    assert.equal(
      (
        await db()
          .select()
          .from(aiAnalysisRequests)
          .where(eq(aiAnalysisRequests.userId, user.id))
      )[0].status,
      "completed",
    );
  },
);
