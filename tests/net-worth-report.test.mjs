import assert from "node:assert/strict";
import test from "node:test";

const { buildReportModel, periodLabels } = await import("../app/lib/netWorthReport.ts");

const row = (patch = {}) => ({ id: crypto.randomUUID(), investorId: "a", investor: "Alex Chen", include: true, category: "Investments", institution: "Bank", description: "Portfolio", current: 1000, previous: 800, kind: "Asset", source: "statement.pdf", ownership: 100, ...patch });

test("uses only checked investor IDs for every calculation and uppercase title", () => {
  const model = buildReportModel([row(), row({ investorId: "b", investor: "Blair Reed", current: 9000 })], new Set(["a"]), "2026-08-31");
  assert.equal(model.investorTitle, "ALEX CHEN");
  assert.equal(model.rows.length, 1);
  assert.equal(model.currentAssets, 1000);
  assert.equal(model.currentNetWorth, model.currentAssets - model.currentLiabilities);
  assert.ok(!model.investorTitle.includes("Sample Family"));
});

test("handles multiple selected investors with a generic combined title", () => {
  const model = buildReportModel([row(), row({ investorId: "b", investor: "Blair Reed" })], new Set(["a", "b"]), "2026-08-31");
  assert.equal(model.investorTitle, "ALEX CHEN & BLAIR REED");
});

test("category and report totals reconcile for both periods", () => {
  const model = buildReportModel([row(), row({ kind: "Liability", category: "Mortgage", description: "Home mortgage", current: -250, previous: -300 })], new Set(["a"]), "2026-08-31");
  assert.equal(model.currentAssets, 1000);
  assert.equal(model.currentLiabilities, 250);
  assert.equal(model.currentNetWorth, 750);
  assert.equal(model.previousNetWorth, 500);
});

test("row ownership replaces statement ownership and retains full values", () => {
  const [owned] = buildReportModel([row({ ownership: 34 })], new Set(["a"]), "2026-08-31", 60).rows;
  assert.equal(owned.effectiveOwnership, 34);
  assert.equal(owned.shareCurrent, 340);
  assert.equal(owned.current, 1000);
});

test("statement ownership applies only when a row has no override", () => {
  const [owned] = buildReportModel([row({ ownership: undefined })], new Set(["a"]), "2026-08-31", 60).rows;
  assert.equal(owned.shareCurrent, 600);
});

test("source totals and duplicate OCR rows stay excluded", () => {
  const item = row();
  const model = buildReportModel([item, { ...item, id: "duplicate" }, row({ id: "total", description: "Total assets", current: 5000 })], new Set(["a"]), "2026-08-31");
  assert.equal(model.rows.length, 1);
  assert.equal(model.currentAssets, 1000);
});

test("periods derive from the selected statement month, including year boundaries", () => {
  assert.deepEqual(periodLabels("2026-01-31"), { currentLabel: "Jan 2026", previousLabel: "Dec 2025" });
});

test("print contract uses A4 pages and excludes the obsolete schedule", async () => {
  const css = await (await import("node:fs/promises")).readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const page = await (await import("node:fs/promises")).readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(css, /@page\s*\{\s*size:A4 portrait;\s*margin:10mm 12mm 12mm;/);
  assert.match(css, /break-after:page/);
  assert.match(page, /Net Worth Overview/);
  assert.match(page, /Net Worth Summary/);
  assert.match(page, /Net Worth Detailed/);
  assert.match(page, /effectiveOwnership < 100 && <small>100%<\/small>/);
  assert.doesNotMatch(page, /Consolidated Schedule/);
});
