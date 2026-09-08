import assert from "node:assert/strict";
import test from "node:test";
const { parseDocument, parseFinancialText, parseTabularRows } = await import("../app/lib/documentParser.ts");

test("extracts numeric leaves only beneath assets and liabilities and rejects junk", () => {
  const rows = parseFinancialText(`Statement of Financial Position
Client ID: 12345
Date: June 30, 2026
Exchange Rate 1.25
ASSETS
CIBC Bank
Operating Account 41,474.30 40,374.31
Subtotal CIBC Bank 41,474.30 40,374.31
Total Assets 41,474.30 40,374.31
LIABILITIES
Zohar.ai Inc.
Loan 224,000.00 224,000.00
Total Liabilities & Equity 224,000.00 224,000.00
EQUITY
Retained Earnings 100,000.00
Net Income 10,000.00`, "position.pdf");
  assert.deepEqual(rows.map(({ kind, holder, accountName, current }) => ({ kind, holder, accountName, current })), [
    { kind: "Asset", holder: "CIBC Bank", accountName: "Operating Account", current: 41474.3 },
    { kind: "Liability", holder: "Zohar.ai Inc.", accountName: "Loan", current: 224000 },
  ]);
});

test("classifies mortgage and loan accounts from their statement hierarchy", () => {
  const rows = parseFinancialText(`ASSETS
Sky Mortgage Corporation
136 Markland Mortgage 350,000.00
Short Term Loan 1,450,000.00
LIABILITIES
Bank
Mortgage 200,000.00
Loan 25,000.00`, "position.pdf");
  assert.deepEqual(rows.map((r) => r.category), ["Mortgage Investments / Mortgage Receivables", "Loans Receivable", "Mortgages Payable", "Loans Payable"]);
});

test("inherits institutions above account-type headings", () => {
  const rows = parseFinancialText(`ASSETS
CIBC Bank
Bank Accounts
Operating account 41,474.30
Am-Stat
Real Estate
Sunset Park 443,808.40
Jorlee Holdings Limited
Loans Receivable
Short Term Loan 1,450,000.00
Sky Mortgage Corporation
Mortgage Investments
136 Markland, Markham ON 350,000.00
27 Harwood ON 250,000.00
Bruce St, Welland ON 400,000.00
LIABILITIES
Zohar.ai Inc.
Loans Payable
Loan 224,000.00`, "position.pdf");
  assert.deepEqual(rows.map((row) => [row.holder, row.accountName, row.description]), [
    ["CIBC Bank", "Bank Accounts", "Operating account"],
    ["Am-Stat", "Real Estate", "Sunset Park"],
    ["Jorlee Holdings Limited", "Loans Receivable", "Short Term Loan"],
    ["Sky Mortgage Corporation", "Mortgage Investments", "136 Markland, Markham ON"],
    ["Sky Mortgage Corporation", "Mortgage Investments", "27 Harwood ON"],
    ["Sky Mortgage Corporation", "Mortgage Investments", "Bruce St, Welland ON"],
    ["Zohar.ai Inc.", "Loans Payable", "Loan"],
  ]);
});

test("splits cash and investments columns without their combined total", () => {
  const rows = parseTabularRows([
    ["Section", "Holder", "Account Name", "Description", "Cash", "Investments", "Total Cash & Investments"],
    ["Asset", "CIBC Bank", "CAD Margin", "CAD Margin", "645.72", "421,995.01", "422,640.73"],
    ["Asset", "CIBC Bank", "Total CAD", "Total CAD", "645.72", "421,995.01", "422,640.73"],
  ], "investment.csv");
  assert.deepEqual(rows.map((r) => [r.category, r.current]), [["Cash & Bank Accounts", 645.72], ["Investments", 421995.01]]);
  assert.equal(rows.reduce((sum, row) => sum + row.current, 0), 422640.73);
});

test("enforces limits and rejects unsupported formats", async () => {
  await assert.rejects(() => parseDocument({ name: "large.csv", size: 10 * 1024 * 1024 + 1 }, () => {}), /exceeds the 10 MB limit/);
  await assert.rejects(() => parseDocument({ name: "statement.docx", size: 100 }, () => {}), /not a supported statement format/);
});
