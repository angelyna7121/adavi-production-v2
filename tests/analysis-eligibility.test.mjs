import test from "node:test";
import assert from "node:assert/strict";
const {
  inspectAnalysisData,
  analysisEligibility,
  serviceEligibility,
  confirmAnalysisRow,
  formatAnalysisDate,
} = await import("../app/lib/financialInsights/eligibility.ts");
const { trustedSummary } = await import(
  "../app/lib/financialInsights/selection.ts"
);
const investors = [
  { investorId: "a", name: "Synthetic A" },
  { investorId: "b", name: "Synthetic B" },
];
const row = (id, investorId = "a", value = 100) => ({
  id,
  investorId,
  investor: "Synthetic",
  include: true,
  description: `Account ${id}`,
  category: "Investments",
  kind: "Asset",
  source: "private.pdf",
  holder: "Private bank",
  institution: "Private bank",
  accountName: "Private account",
  current: value,
  rawCurrent: value,
  previous: 50,
  rawPrevious: 50,
});
const input = (rows = [row("one")], ids = ["a"]) => ({
  rows,
  investors,
  selectedInvestorIds: ids,
  date: "2026-10-25",
  currency: "CAD",
});
const ready = {
  mode: "live",
  canAnalyzeFinancialPosition: true,
  reason: "Ready",
  eligibilityReason: "ready",
};
test("one selected investor scopes report totals, portfolio and provider summary to the same rows", () => {
  const data = input([
    row("one"),
    { ...row("debt", "a", 20), kind: "Liability" },
    row("other", "b", 9000),
  ]);
  const result = inspectAnalysisData(data);
  assert.equal(result.report.statement.currentShareAssets, 100);
  assert.equal(result.report.statement.currentShareLiabilities, 20);
  assert.equal(result.report.statement.currentShareNetWorth, 80);
  assert.deepEqual(
    result.report.rows.map((r) => r.id),
    ["one", "debt"],
  );
  assert.equal(result.report.assetMix[0].total, 100);
  const summary = trustedSummary(
    {
      ...data,
      accountId: "local",
      versionId: "version",
      revision: "revision",
      confirmed: true,
      authorizedInvestorIds: ["a", "b"],
      date: data.date,
      currencies: ["CAD"],
    },
    ["a"],
    "request",
  );
  assert.equal(
    summary.metrics.find((m) => m.id === "net-worth.current").value,
    80,
  );
  assert.equal(summary.scope.investorCount, 1);
  assert.doesNotMatch(
    JSON.stringify(summary),
    /Synthetic|private.pdf|Private bank|accountName|investorId/,
  );
});
test("explicit combined scope includes only checked investors and rows", () => {
  const rows = [
    row("one"),
    row("two", "b", 250),
    { ...row("unchecked", "b", 99999), include: false },
  ];
  const result = inspectAnalysisData(input(rows, ["a", "b"]));
  assert.equal(result.report.statement.currentShareAssets, 350);
  assert.equal(result.report.assetMix[0].percentage, 100);
  assert.deepEqual(result.report.investorIds, ["a", "b"]);
});
test("no selection and no included rows produce specific states without review flags", () => {
  assert.equal(
    inspectAnalysisData(input([], [])).eligibility.reason,
    "no-investor-selected",
  );
  const empty = inspectAnalysisData(input([{ ...row("one"), include: false }]));
  assert.equal(empty.eligibility.reason, "no-included-rows");
  assert.equal(
    empty.eligibility.message,
    "No included financial rows are available for this investor.",
  );
});
test("flagged stable row IDs and counts are actionable and only confirmed rows enter preview totals", () => {
  const result = inspectAnalysisData(
    input([
      row("valid"),
      { ...row("low"), needsReview: true },
      { ...row("manual"), manuallyReviewRequired: true },
    ]),
  );
  assert.equal(result.eligibility.reason, "unreviewed-rows");
  assert.deepEqual(result.eligibility.affectedRowIds, ["low", "manual"]);
  assert.equal(result.eligibility.affectedRowCount, 2);
  assert.equal(result.report.statement.currentShareAssets, 100);
  assert.equal(result.report.assetMix[0].total, 100);
});
test("low confidence requires explicit confirmation even if an OCR flag was absent", () => {
  const original = { ...row("low"), ocrConfidence: 62 };
  assert.equal(
    inspectAnalysisData(input([original])).eligibility.eligible,
    false,
  );
  const confirmed = confirmAnalysisRow(original);
  assert.equal(confirmed.reviewConfirmed, true);
  assert.equal(original.reviewConfirmed, undefined);
  assert.equal(
    inspectAnalysisData(input([confirmed])).eligibility.eligible,
    true,
  );
});
test("confirming or excluding review rows clears the gate without bypassing service checks", () => {
  const flagged = { ...row("low"), needsReview: true };
  const confirmed = confirmAnalysisRow(flagged);
  assert.equal(
    inspectAnalysisData(input([confirmed])).eligibility.eligible,
    true,
  );
  assert.equal(
    inspectAnalysisData(input([row("good"), { ...flagged, include: false }]))
      .eligibility.eligible,
    true,
  );
  const blocked = analysisEligibility(
    inspectAnalysisData(input([confirmed])).eligibility,
    {
      mode: "disabled",
      canAnalyzeFinancialPosition: false,
      reason: "Disabled",
    },
  );
  assert.equal(blocked.reason, "service-disabled");
  assert.equal(blocked.eligible, false);
});
test("correcting a row recalculates ownership exactly once and confirmation clears only its review flags", () => {
  const flagged = {
    ...row("one", "a", 999),
    rawCurrent: 100,
    ownershipPercentage: 50,
    rowOwnershipOverride: 30,
    needsReview: true,
    rawPrevious: 50,
    previous: 15,
  };
  const confirmed = confirmAnalysisRow(flagged);
  assert.equal(confirmed.current, 30);
  assert.equal(confirmed.previous, 15);
  assert.equal(
    inspectAnalysisData(input([confirmed])).eligibility.eligible,
    true,
  );
});
test("invalid amounts and ownership cannot be confirmed and expose safe diagnostics", () => {
  for (const mutation of [
    { current: NaN, rawCurrent: NaN },
    { current: -1, rawCurrent: -1 },
    { rawCurrent: "" },
    { ownershipPercentage: 101 },
  ]) {
    const r = { ...row("bad"), ...mutation };
    const result = inspectAnalysisData(input([r]));
    assert.equal(result.eligibility.eligible, false);
    assert.deepEqual(result.eligibility.affectedRowIds, ["bad"]);
    assert.throws(() => confirmAnalysisRow(r));
    assert.doesNotMatch(
      result.eligibility.message,
      /private.pdf|Private bank|NaN/,
    );
  }
});
test("unresolved duplicate rows remain blocked after confirmation until corrected or excluded", () => {
  const one = row("one"),
    duplicate = { ...one, id: "duplicate" };
  let result = inspectAnalysisData(input([one, duplicate]));
  assert.deepEqual(result.eligibility.affectedRowIds, ["one", "duplicate"]);
  assert.equal(result.report.rows.length, 0);
  result = inspectAnalysisData(
    input([confirmAnalysisRow(one), confirmAnalysisRow(duplicate)]),
  );
  assert.equal(result.eligibility.eligible, false);
  assert.equal(
    inspectAnalysisData(input([one, { ...duplicate, include: false }]))
      .eligibility.eligible,
    true,
  );
});
test("unchecked investors cannot add review blockers, invalid ownership or duplicate diagnostics", () => {
  const result = inspectAnalysisData(
    input([
      row("valid"),
      { ...row("bad", "b"), needsReview: true, ownershipPercentage: -1 },
    ]),
  );
  assert.equal(result.eligibility.eligible, true);
  assert.equal(result.eligibility.affectedRowCount, 0);
});
test("disabled/configuration/authorization/quota status takes precedence while retaining row diagnostics", () => {
  const data = inspectAnalysisData(
    input([{ ...row("low"), needsReview: true }]),
  ).eligibility;
  for (const [capability, reason] of [
    [
      {
        mode: "disabled",
        canAnalyzeFinancialPosition: false,
        reason: "Disabled",
      },
      "service-disabled",
    ],
    [
      {
        ...ready,
        canAnalyzeFinancialPosition: false,
        eligibilityReason: "not-authorized",
      },
      "not-authorized",
    ],
    [
      {
        ...ready,
        canAnalyzeFinancialPosition: false,
        eligibilityReason: "usage-limit-reached",
      },
      "usage-limit-reached",
    ],
    [
      {
        ...ready,
        canAnalyzeFinancialPosition: false,
        eligibilityReason: "configuration-error",
      },
      "configuration-error",
    ],
  ]) {
    const result = analysisEligibility(data, capability);
    assert.equal(result.reason, reason);
    assert.deepEqual(result.affectedRowIds, ["low"]);
    assert.doesNotMatch(result.message, /Data requires review/);
  }
  assert.equal(analysisEligibility(data, ready).reason, "unreviewed-rows");
});
test("quota reset dates are formatted only when provided; unknown unavailable states fail closed", () => {
  assert.match(
    serviceEligibility({
      ...ready,
      canAnalyzeFinancialPosition: false,
      eligibilityReason: "usage-limit-reached",
      resetAt: "2026-10-26T00:00:00Z",
    }).message,
    /October 26, 2026/,
  );
  assert.equal(
    serviceEligibility({
      mode: "live",
      canAnalyzeFinancialPosition: false,
      reason: "Internal sensitive detail",
    }).reason,
    "configuration-error",
  );
  assert.doesNotMatch(
    serviceEligibility({
      mode: "live",
      canAnalyzeFinancialPosition: false,
      reason: "Internal sensitive detail",
    }).message,
    /sensitive/,
  );
});
test("period, currency, category limits and unknown IDs fail safely with distinct diagnostics", () => {
  for (const patch of [
    { date: "2026-02-31" },
    { currency: "" },
    { maxCategories: 0 },
  ])
    assert.equal(
      inspectAnalysisData({ ...input(), ...patch }).eligibility.reason,
      "configuration-error",
    );
  assert.equal(
    inspectAnalysisData(input([row("one")], ["unknown"])).eligibility.reason,
    "not-authorized",
  );
});
test("portfolio merges normalized categories, omits zero values and liabilities and sums selected percentages", () => {
  const rows = [
    {
      ...row("cash"),
      category: " Cash   Accounts ",
      current: 70,
      rawCurrent: 70,
    },
    {
      ...row("cash-two"),
      category: "cash accounts",
      current: 30,
      rawCurrent: 30,
    },
    { ...row("zero"), category: "Other Assets", current: 0, rawCurrent: 0 },
    { ...row("debt"), kind: "Liability", current: 80, rawCurrent: 80 },
    { ...row("unconfirmed"), needsReview: true, current: 500, rawCurrent: 500 },
    row("other", "b", 9000),
  ];
  const result = inspectAnalysisData(input(rows));
  assert.equal(result.report.assetMix.length, 1);
  assert.equal(result.report.assetMix[0].total, 100);
  assert.equal(result.report.assetMix[0].percentage, 100);
  assert.equal(result.report.statement.currentShareNetWorth, 20);
});
test("dates are human readable with a safe fallback for invalid input", () => {
  assert.equal(formatAnalysisDate("2026-10-25"), "October 25, 2026");
  assert.equal(formatAnalysisDate("invalid"), "Statement date requires review");
  assert.equal(
    formatAnalysisDate("2026-02-31"),
    "Statement date requires review",
  );
});
test("unexpected calculation failures produce a safe configuration state without exposing exception text", () => {
  const corrupt = {
    ...row("one"),
    get category() {
      throw new Error("secret financial content");
    },
  };
  const result = inspectAnalysisData(input([corrupt]));
  assert.equal(result.eligibility.reason, "configuration-error");
  assert.equal(result.unexpectedFailure, true);
  assert.doesNotMatch(JSON.stringify(result), /secret financial content/);
});
test("public request errors select sign-in, quota, review and retry actions without exposing provider details", async () => {
  const { analysisRequestFailure } = await import(
    "../app/lib/financialInsights/eligibility.ts"
  );
  for (const [code, reason, retryable] of [
    ["AUTHENTICATION_REQUIRED", "not-authorized", false],
    ["NOT_INCLUDED_IN_PLAN", "not-authorized", false],
    ["RATE_LIMITED", "usage-limit-reached", false],
    ["REPORT_CHANGED", "unreconciled-values", false],
    ["SERVICE_DISABLED", "service-disabled", false],
    ["untrusted secret detail", "configuration-error", true],
  ]) {
    const result = analysisRequestFailure(code);
    assert.equal(result.eligibility.reason, reason);
    assert.equal(result.retryable, retryable);
    assert.doesNotMatch(result.eligibility.message, /untrusted secret/);
  }
});
test("configuration errors are not mislabeled disabled and explicit denial wins over an inconsistent allowed flag", () => {
  assert.equal(
    serviceEligibility({
      mode: "disabled",
      canAnalyzeFinancialPosition: false,
      reason: "safe",
      eligibilityReason: "configuration-error",
    }).reason,
    "configuration-error",
  );
  assert.equal(
    serviceEligibility({ ...ready, eligibilityReason: "not-authorized" })
      .eligible,
    false,
  );
});
test("server-disabled mode rejects client live/premium flags without invoking authorization or a provider", async () => {
  const { handleLiveAnalysis } = await import(
    "../app/lib/financialInsights/server/liveHttp.ts"
  );
  const response = await handleLiveAnalysis(
    new Request("https://example.test/api/financial-analysis", {
      method: "POST",
      headers: {
        origin: "https://example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode: "live", premium: true, consent: true }),
    }),
    null,
    serviceEligibility({
      mode: "disabled",
      canAnalyzeFinancialPosition: false,
      reason: "Disabled",
    }),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "SERVICE_DISABLED");
});
test("an empty selected investor blocks combined saving and normalized saved categories match selected confirmed scope", async () => {
  assert.equal(
    inspectAnalysisData(input([row("one")], ["a", "b"])).eligibility.reason,
    "no-included-rows",
  );
  const { snapshotForSaving } = await import(
    "../app/lib/financialInsights/saveSummary.ts"
  );
  const rows = [
    { ...row("one"), category: " investments ", current: 100, rawCurrent: 100 },
    { ...row("two"), category: "Investments", current: 250, rawCurrent: 250 },
    row("unchecked", "b", 999),
  ];
  const result = snapshotForSaving(rows, investors, ["a"], "2026-10-25", "CAD");
  assert.equal(result.report.investors.length, 1);
  assert.equal(result.report.investors[0].categories.length, 1);
  assert.equal(
    result.report.investors[0].categories[0].category,
    "Investments",
  );
  assert.equal(result.report.investors[0].categories[0].current, 350);
  assert.equal(result.report.investors[0].categories[0].accountCount, 2);
});
