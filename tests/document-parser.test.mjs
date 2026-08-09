import assert from "node:assert/strict";
import test from "node:test";

const { parseDocument, parseFinancialText } = await import("../app/lib/documentParser.ts");

test("extracts current and previous balances without inventing values", () => {
  const [withPrior, withoutPrior] = parseFinancialText(
    "TFSA Portfolio $12,500 $11,000\nChequing account $2,400",
    "statement.pdf",
  );
  assert.equal(withPrior.current, 12_500);
  assert.equal(withPrior.previous, 11_000);
  assert.equal(withoutPrior.current, 2_400);
  assert.equal(withoutPrior.previous, null);
});

test("classifies liabilities and normalizes parenthesized balances", () => {
  const [row] = parseFinancialText("Residential mortgage ($325,000)", "mortgage.pdf");
  assert.equal(row.kind, "Liability");
  assert.equal(row.category, "Mortgages");
  assert.equal(row.current, 325_000);
});

test("enforces the ten megabyte upload limit", async () => {
  const oversized = { name: "large.csv", size: 10 * 1024 * 1024 + 1 };
  await assert.rejects(() => parseDocument(oversized, () => {}), /exceeds the 10 MB limit/);
});

test("rejects unsupported formats honestly", async () => {
  const unsupported = { name: "statement.docx", size: 100 };
  await assert.rejects(() => parseDocument(unsupported, () => {}), /not a supported statement format/);
});
