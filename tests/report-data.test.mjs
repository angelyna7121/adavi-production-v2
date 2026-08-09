import assert from "node:assert/strict";
import test from "node:test";

const { CSV_HEADERS, assignInvestor, confirmedDetailRows, createReportCsv, hasUnnamedIncludedRows, reassignInvestor } = await import("../app/lib/reportData.ts");

function row(id, investor, source, description, current, extra = {}) {
  return { id, include: true, investor, category: "Investments", institution: "Bank", description, current, previous: null, kind: "Asset", source, ...extra };
}

test("deduplicates a proven parsed total from current and previous calculations", () => {
  const rows = [
    row("1", "Alex", "portfolio.csv", "Holding A", 1_000, { previous: 800 }),
    row("2", "Alex", "portfolio.csv", "Holding B", 2_000, { previous: 1_700 }),
    row("3", "Alex", "portfolio.csv", "Total Market Value", 3_000, { previous: 2_500 }),
  ];
  const details = confirmedDetailRows(rows);
  assert.deepEqual(details.map((item) => item.id), ["1", "2"]);
  assert.equal(details.reduce((sum, item) => sum + Number(item.current), 0), 3_000);
  assert.equal(details.reduce((sum, item) => sum + Number(item.previous), 0), 2_500);
});

test("retains a total when it is the only valid balance", () => {
  assert.deepEqual(confirmedDetailRows([row("total", "Alex", "one.pdf", "Portfolio Total", 3_000)]).map((item) => item.id), ["total"]);
});

test("never deduplicates totals across investors or source files", () => {
  const rows = [row("a", "Alex", "alex.csv", "Holding", 3_000), row("b", "Jordan", "jordan.csv", "Grand Total", 3_000)];
  assert.deepEqual(confirmedDetailRows(rows).map((item) => item.id), ["a", "b"]);
});

test("supports multiple files per investor and consolidated investor totals", () => {
  const rows = [row("1", "Alex", "bank.csv", "Cash", 1_000), row("2", "Alex", "broker.csv", "Fund", 2_000), row("3", "Jordan", "home.csv", "Home", 5_000), row("4", "Jordan", "loan.csv", "Loan", 500, { kind: "Liability" })];
  const details = confirmedDetailRows(rows);
  const totals = Object.fromEntries(["Alex", "Jordan"].map((name) => [name, details.filter((item) => item.investor === name).reduce((sum, item) => sum + (item.kind === "Asset" ? 1 : -1) * Number(item.current), 0)]));
  assert.deepEqual(totals, { Alex: 3_000, Jordan: 4_500 });
  assert.equal(Object.values(totals).reduce((sum, value) => sum + value, 0), 7_500);
});

test("assigns, edits, and reassigns named investors while rejecting unnamed ones", () => {
  const unassigned = row("1", "", "bank.csv", "Cash", 1_000);
  assert.equal(hasUnnamedIncludedRows([unassigned]), true);
  assert.throws(() => assignInvestor([unassigned], "a", "  "), /investor name is required/i);
  const [assigned] = assignInvestor([unassigned], "a", " Alex ");
  assert.deepEqual({ id: assigned.investorId, name: assigned.investor }, { id: "a", name: "Alex" });
  const reassigned = reassignInvestor(assigned, "b", "Jordan");
  assert.deepEqual({ id: reassigned.investorId, name: reassigned.investor }, { id: "b", name: "Jordan" });
});

test("creates exact UTF-8 CSV headers and confirmed detail rows", () => {
  const rows = [row("1", "Alex", "portfolio.csv", 'Fund, "Growth"', 1_000), row("2", "Alex", "portfolio.csv", "Fund B", 2_000), row("3", "Alex", "portfolio.csv", "Total Assets", 3_000), row("4", "Alex", "title", "Report title", 99, { include: false })];
  const csv = createReportCsv(rows);
  assert.equal(csv.codePointAt(0), 0xfeff);
  assert.ok(csv.endsWith("\r\n"));
  assert.equal(csv.replaceAll("\r\n", "").includes("\n"), false);
  const records = csv.slice(1).trimEnd().split("\r\n").map((line) => [...line.matchAll(/(?:^|,)(?:\"((?:\"\"|[^\"])*)\"|([^,]*))/g)].map((match) => (match[1] ?? match[2]).replaceAll('""', '"')));
  assert.deepEqual(records[0], [...CSV_HEADERS]);
  assert.deepEqual(records.slice(1), [
    ["Alex", "Investments", "Bank", 'Fund, "Growth"', "1000", "N/A", "Asset", "portfolio.csv"],
    ["Alex", "Investments", "Bank", "Fund B", "2000", "N/A", "Asset", "portfolio.csv"],
  ]);
});
