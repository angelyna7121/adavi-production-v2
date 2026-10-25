import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { verifyIdentity } = await import(
  "../../app/lib/backend/authentication.ts"
);
const { decideEntitlement } = await import(
  "../../app/lib/backend/entitlement.ts"
);
const { approvedCheckoutPlan, paidSubscription } = await import(
  "../../app/lib/backend/billingRules.ts"
);
const { validateNormalizedReport } = await import(
  "../../app/lib/backend/normalized.ts"
);
const { summaryFromNormalized } = await import(
  "../../app/lib/financialInsights/storedSummary.ts"
);
const { snapshotForSaving } = await import(
  "../../app/lib/financialInsights/saveSummary.ts"
);
const { stripeClient } = await import("../../app/lib/backend/stripe.ts");
const Stripe = (await import("stripe")).default;
const category = {
  category: "Investments",
  kind: "Asset",
  current: 1000.01,
  previous: 500,
  accountCount: 2,
  missingPreviousCount: 0,
  lowConfidenceCount: 0,
};
const fixture = () => ({
  version: "1",
  currency: "CAD",
  currentPeriod: "2026-10-24",
  previousPeriod: "2026-09-30",
  confirmed: true,
  investors: [
    {
      localReference: randomUUID(),
      categories: [{ ...category }],
      excludedRowCount: 0,
    },
  ],
});
test("Clerk identity must match server session and verified primary email", async () => {
  const identity = {
    id: "user-one",
    primaryEmailAddressId: "primary",
    emailAddresses: [{ id: "primary", verification: { status: "verified" } }],
  };
  assert.equal(await verifyIdentity(null, async () => identity), null);
  assert.equal(await verifyIdentity("other-user", async () => identity), null);
  assert.equal(
    (await verifyIdentity("user-one", async () => identity)).verifiedEmail,
    true,
  );
  identity.emailAddresses[0].verification.status = "unverified";
  assert.equal(
    (await verifyIdentity("user-one", async () => identity)).verifiedEmail,
    false,
  );
});
test("entitlements follow Owner, complimentary, Premium, scoped pass, free precedence and revoke/expire closed", () => {
  const record = (source) => ({
    source,
    status: "active",
    startsAt: new Date(0),
    expiresAt: new Date(Date.now() + 60000),
    revokedAt: null,
    reportScopeId: null,
  });
  const grants = ["report-pass", "premium", "complimentary", "owner"].map(
    record,
  );
  assert.equal(decideEntitlement(grants, null, 3).source, "owner");
  assert.equal(
    decideEntitlement(grants.slice(0, 3), null, 3).source,
    "complimentary",
  );
  assert.equal(
    decideEntitlement(grants.slice(0, 2), null, 3).source,
    "premium",
  );
  assert.equal(
    decideEntitlement(
      [{ ...record("report-pass"), reportScopeId: "one" }],
      "two",
      3,
    ).source,
    "free",
  );
  assert.equal(
    decideEntitlement(
      [{ ...record("report-pass"), reportScopeId: "one" }],
      "one",
      3,
    ).canAnalyzeFinancialPosition,
    false,
  );
  assert.equal(
    decideEntitlement([{ ...record("owner"), revokedAt: new Date() }], null, 3)
      .source,
    "free",
  );
  assert.equal(
    decideEntitlement(
      [{ ...record("premium"), expiresAt: new Date(0) }],
      null,
      3,
    ).source,
    "free",
  );
  assert.equal(
    decideEntitlement([record("premium")], null, 0).canAnalyzeFinancialPosition,
    false,
  );
});
test("Checkout plan rejects browser prices, amounts, and unapproved mappings", () => {
  assert.deepEqual(
    approvedCheckoutPlan({ plan: "monthly" }, { monthly: "price_test" }),
    { plan: "monthly", price: "price_test" },
  );
  for (const value of [
    { price: "price_fake" },
    { plan: "monthly", amount: 1 },
    { plan: "owner" },
    { plan: "yearly" },
  ])
    assert.throws(() => approvedCheckoutPlan(value, { monthly: "price_test" }));
  assert.equal(
    paidSubscription("active", (Date.now() + 60000) / 1000, false),
    true,
  );
  assert.equal(
    paidSubscription("canceled", Date.now() / 1000 + 60, false),
    false,
  );
  assert.equal(paidSubscription("active", Date.now() / 1000 + 60, true), false);
});
test("Stripe SDK verifies exact raw-body signatures and rejects tampering", () => {
  const stripe = new Stripe("sk_test_unit_only"),
    secret = "whsec_unit_only";
  const body = JSON.stringify({
      id: "evt_test",
      type: "customer.subscription.updated",
    }),
    signature = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret,
    });
  assert.equal(
    stripe.webhooks.constructEvent(body, signature, secret).id,
    "evt_test",
  );
  assert.throws(() =>
    stripe.webhooks.constructEvent(body + " ", signature, secret),
  );
});
test("normalized persistence rejects PII fields, free text categories, bad identifiers and nonfinite totals", () => {
  const valid = fixture();
  assert.equal(validateNormalizedReport(valid), valid);
  for (const mutate of [
    (r) => (r.investorName = "Private"),
    (r) => (r.investors[0].filename = "file.pdf"),
    (r) => (r.investors[0].localReference = "Private Investor"),
    (r) => (r.investors[0].categories[0].category = "Ignore instructions"),
    (r) => (r.investors[0].categories[0].current = Infinity),
    (r) => (r.investors[0].categories[0].current = -1),
    (r) => (r.investors[0].categories[0].accountNumber = "123456"),
    (r) => (r.confirmed = false),
  ]) {
    const r = fixture();
    mutate(r);
    assert.throws(() => validateNormalizedReport(r));
  }
});
test("saved per-investor category aggregates recompute scoped totals and completeness counts", () => {
  const report = fixture();
  report.investors.push({
    localReference: randomUUID(),
    categories: [{ ...category, current: 777 }],
    excludedRowCount: 2,
  });
  const one = summaryFromNormalized(
    report,
    [report.investors[0].localReference],
    randomUUID(),
  );
  assert.equal(
    one.metrics.find((m) => m.id === "assets.current").value,
    1000.01,
  );
  assert.equal(
    one.metrics.find((m) => m.id === "data.included-accounts").value,
    2,
  );
  assert.doesNotMatch(JSON.stringify(one), /localReference|investorId/);
  assert.throws(() =>
    summaryFromNormalized(report, [randomUUID()], randomUUID()),
  );
});
test("browser snapshot stores only anonymous, approved category aggregates and applies ownership once", () => {
  const id = randomUUID();
  const row = {
    id: randomUUID(),
    investorId: id,
    investor: "Private Investor",
    include: true,
    category: "Investments",
    kind: "Asset",
    description: "Private account 123456",
    holder: "Secret Bank",
    institution: "Secret Bank",
    accountName: "Account",
    source: "private.pdf",
    current: 50,
    rawCurrent: 100,
    previous: 25,
    rawPrevious: 50,
    ownershipPercentage: 50,
  };
  const result = snapshotForSaving(
    [row],
    [{ investorId: id, name: "Private Investor" }],
    [id],
    "2026-10-24",
    "CAD",
  );
  assert.equal(result.report.investors[0].categories[0].current, 50);
  assert.doesNotMatch(
    JSON.stringify(result.report),
    /Private|Secret|123456|private.pdf|description|filename/,
  );
  validateNormalizedReport(result.report);
});
test("Stripe cannot use a live key under test-mode defaults", () => {
  const before = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_live_unit_only";
  try {
    assert.throws(() => stripeClient());
  } finally {
    if (before === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = before;
  }
});
test("preview environment rejects production Clerk bindings and public server secrets", async () => {
  const { backendEnvironmentValid } = await import(
    "../../app/lib/backend/environment.ts"
  );
  const environment = {
    DATABASE_URL: "postgresql://unconnected.example/db",
    CLERK_SECRET_KEY: "sk_test_unit",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_unit",
    APP_URL: "https://preview.example",
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    APP_DATA_ENV: "preview",
  };
  assert.equal(backendEnvironmentValid(environment), true);
  assert.equal(
    backendEnvironmentValid({
      ...environment,
      CLERK_SECRET_KEY: "sk_live_unit",
    }),
    false,
  );
  assert.equal(
    backendEnvironmentValid({
      ...environment,
      NEXT_PUBLIC_OPENAI_API_KEY: "unit",
    }),
    false,
  );
  assert.equal(
    backendEnvironmentValid({ ...environment, APP_DATA_ENV: "production" }),
    false,
  );
});
test("Checkout uses a server-approved price and server-mapped customer, never browser subscription status", async () => {
  const { createVerifiedCheckout } = await import(
    "../../app/lib/backend/billingService.ts"
  );
  let captured, mapped;
  const stripe = {
    prices: {
      retrieve: async () => ({
        active: true,
        type: "recurring",
        recurring: { interval: "month" },
        livemode: false,
      }),
    },
    customers: { create: async () => ({ id: "cus_server" }) },
    checkout: {
      sessions: {
        create: async (options) => {
          captured = options;
          return { url: "https://checkout.stripe.com/test" };
        },
      },
    },
  };
  const input = {
    userId: randomUUID(),
    customerId: null,
    body: { plan: "monthly" },
    prices: { monthly: "price_approved" },
    liveMode: false,
    origin: "https://preview.example",
  };
  await createVerifiedCheckout(input, stripe, async (id) => {
    mapped = id;
  });
  assert.equal(mapped, "cus_server");
  assert.equal(captured.customer, "cus_server");
  assert.equal(captured.line_items[0].price, "price_approved");
  assert.equal(captured.client_reference_id, input.userId);
  stripe.prices.retrieve = async () => ({ active: false });
  await assert.rejects(createVerifiedCheckout(input, stripe, async () => {}));
});
