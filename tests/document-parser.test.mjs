import assert from "node:assert/strict";
import test from "node:test";
const { parseDocument, parseFinancialText, parseTabularRows, parseWoodGundyPortfolioPages } = await import("../app/lib/documentParser.ts");
const { applyOwnershipToRow } = await import("../app/lib/reportData.ts");
const { woodGundyExpectedAccounts, woodGundyPortfolioPages } = await import("./fixtures/cibc-wood-gundy.fixture.ts");

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

test("extracts one Wood Gundy asset per account from Total Portfolio Value", () => {
  const rows=parseWoodGundyPortfolioPages(woodGundyPortfolioPages,"Portfolio Evaluation.pdf");
  assert.equal(rows.length,7);
  assert.deepEqual(rows.map((row)=>[row.accountNumber,row.accountName,row.current]),woodGundyExpectedAccounts);
  assert.equal(rows.reduce((sum,row)=>sum+row.current,0),4_213_113);
  for(const row of rows){
    assert.equal(row.kind,"Asset");assert.equal(row.category,"Investments");assert.equal(row.institution,"CIBC Private Wealth Wood Gundy");assert.equal(row.ownershipPercentage,100);assert.equal(row.rawCurrent,row.current);assert.equal(row.previous,null);assert.match(row.description,new RegExp(`${row.accountName} ${row.accountNumber}$`));
  }
});

test("keeps multi-page accounts and currency subaccounts at the consolidated account level",()=>{
  const rows=parseWoodGundyPortfolioPages(woodGundyPortfolioPages,"Portfolio Evaluation.pdf");
  assert.equal(rows.filter((row)=>row.accountName==="Spousal RRSP").length,2);
  assert.equal(rows.filter((row)=>row.accountName==="RRSP").length,2);
  const continuation=rows.find((row)=>row.accountNumber==="551193331C");assert.equal(continuation.current,451_063);assert.equal(continuation.sourcePage,6);
  const consolidated=rows.find((row)=>row.accountNumber==="45100480");assert.deepEqual(consolidated.sourceSubaccounts,["451004801C","451004801U"]);assert.equal(consolidated.current,1_451_153);
  assert.ok(!rows.some((row)=>["451004801C","451004801U"].includes(row.accountNumber)));
});

test("excludes holdings and applies ownership once to the account-level value",()=>{
  const rows=parseWoodGundyPortfolioPages(woodGundyPortfolioPages,"Portfolio Evaluation.pdf");
  assert.ok(!rows.some((row)=>/fund|shares|bond|interest|dividend|total equity|fixed income/i.test(row.description)));
  const included=applyOwnershipToRow(rows[0],50);assert.equal(included.rawCurrent,1_209_488);assert.equal(included.current,604_744);
  assert.equal(applyOwnershipToRow(included,25).current,302_372);
});

test("ignores non-Wood-Gundy documents in the account-level parser",()=>{assert.deepEqual(parseWoodGundyPortfolioPages([{pageNumber:1,text:"ASSETS\nCash 100"}],"other.pdf"),[]);});

test("keeps imperfect Wood Gundy candidates for review instead of rejecting the document",()=>{
  const rows=parseWoodGundyPortfolioPages([{pageNumber:1,confidence:42,text:`CIBC Private Wealth Wood Gundy
Portfolio Evaluation
Account Number 451004771C
Unclear registration label
Total Portfolio Value $1,209,488`}],"imperfect.pdf");
  assert.equal(rows.length,1);
  assert.equal(rows[0].accountNumber,"451004771C");
  assert.equal(rows[0].current,1_209_488);
  assert.equal(rows[0].accountName,"Unclassified investment account");
  assert.equal(rows[0].needsReview,true);
  assert.equal(rows[0].manuallyReviewRequired,true);
  assert.equal(rows[0].include,true);
});
