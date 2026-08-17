import assert from "node:assert/strict";
import test from "node:test";
const { parseFinancialText } = await import("../app/lib/documentParser.ts");
const { CSV_HEADERS, assignInvestor, calculateAssetMix, confirmedDetailRows, createReportCsv, groupReportRows, hasUnnamedIncludedRows, reassignInvestor } = await import("../app/lib/reportData.ts");

const statement = `ASSETS
CIBC Bank
Bank Account 41,474.30 40,374.31
Am-Stat
Sunset Park 443,808.40 423,808.40
Jorlee Holdings Limited
Short Term Loan 1,450,000.00 1,450,000.00
Sky Mortgage Corporation
136 Markland, Markham ON 350,000.00 350,000.00
27 Harwood ON 250,000.00 250,000.00
Bruce St, Welland ON 400,000.00 400,000.00
Subtotal Mortgages 1,000,000.00 1,000,000.00
Total Assets 2,935,282.70 2,914,182.71
LIABILITIES
Zohar.ai Inc.
Loan 224,000.00 224,000.00
Total Liabilities 224,000.00 224,000.00
EQUITY
Retained Earnings 2,600,000.00
Net Income 111,282.70
Total Equity 2,711,282.70`;
const rows = assignInvestor(parseFinancialText(statement, "Statement of Financial Position.pdf"), "investor-1", "Ari Family");

test("matches the supplied position statement's exact leaf-only totals", () => {
  assert.deepEqual(rows.map((r) => [r.holder, r.accountName, r.current]), [
    ["CIBC Bank", "Bank Account", 41474.3], ["Am-Stat", "Sunset Park", 443808.4], ["Jorlee Holdings Limited", "Short Term Loan", 1450000],
    ["Sky Mortgage Corporation", "136 Markland, Markham ON", 350000], ["Sky Mortgage Corporation", "27 Harwood ON", 250000], ["Sky Mortgage Corporation", "Bruce St, Welland ON", 400000], ["Zohar.ai Inc.", "Loan", 224000],
  ]);
  const assets=rows.filter((r)=>r.kind==="Asset"), liabilities=rows.filter((r)=>r.kind==="Liability");
  assert.equal(assets.reduce((s,r)=>s+r.current,0),2935282.7); assert.equal(liabilities.reduce((s,r)=>s+r.current,0),224000); assert.equal(assets.reduce((s,r)=>s+r.current,0)-liabilities.reduce((s,r)=>s+r.current,0),2711282.7);
  assert.equal(assets.reduce((s,r)=>s+r.previous,0),2914182.71); assert.equal(liabilities.reduce((s,r)=>s+r.previous,0),224000); assert.equal(assets.reduce((s,r)=>s+r.previous,0)-liabilities.reduce((s,r)=>s+r.previous,0),2690182.71);
});

test("source totals are always excluded rather than used as fallback leaves", () => {
  const total={...rows[0],id:"total",description:"Grand Total",accountName:"Grand Total",current:2935282.7};
  assert.equal(confirmedDetailRows([total]).length,0);
});

test("builds investor, section, category, holder, and account grouping", () => {
  const groups=groupReportRows(rows); assert.equal(groups[0].investor,"Ari Family"); assert.deepEqual(groups[0].sections.map((s)=>s.kind),["Asset","Liability"]);
  const mortgage=groups[0].sections[0].categories.find((c)=>c.category==="Mortgage Investments / Mortgage Receivables"); assert.equal(mortgage.holders[0].holder,"Sky Mortgage Corporation"); assert.equal(mortgage.holders[0].rows.length,3); assert.equal(mortgage.total,1000000);
});

test("combines mortgage category variants into one Asset Mix entry", () => {
  const mortgageRows = [
    { ...rows[3], category: "Mortgage Investment", current: 350000 },
    { ...rows[4], category: "mortgage receivables", current: 250000 },
    { ...rows[5], category: "MORTGAGE INVESTMENTS / MORTGAGE RECEIVABLES", current: 400000 },
  ];
  const mix = calculateAssetMix([...rows.slice(0, 3), ...mortgageRows]);
  const mortgages = mix.filter((entry) => entry.category === "Mortgage Investments / Mortgage Receivables");
  assert.equal(mortgages.length, 1);
  assert.equal(mortgages[0].total, 1000000);
  assert.equal(Number(mortgages[0].percentage.toFixed(1)), 34.1);
});

test("assigns and reassigns investors and rejects unnamed included rows",()=>{const unassigned={...rows[0],investor:""};assert.equal(hasUnnamedIncludedRows([unassigned]),true);assert.throws(()=>assignInvestor([unassigned],"x"," "),/required/);assert.equal(reassignInvestor(rows[0],"two","Jordan").investor,"Jordan");});

test("exports exact headers and leaf accounts only",()=>{const csv=createReportCsv([...rows,{...rows[0],id:"t",description:"Total Assets",accountName:"Total Assets",current:2935282.7}]);assert.equal(csv.codePointAt(0),0xfeff);assert.ok(csv.endsWith("\r\n"));const lines=csv.slice(1).trimEnd().split("\r\n");const parse=(line)=>[...line.matchAll(/(?:^|,)(?:"((?:""|[^"])*)"|([^,]*))/g)].map((m)=>(m[1]??m[2]).replaceAll('""','"'));assert.deepEqual(parse(lines[0]),[...CSV_HEADERS]);assert.equal(lines.length,8);assert.ok(!csv.includes("Total Assets"));assert.deepEqual(parse(lines[1]).slice(0,6),["Ari Family","Asset","Cash & Bank Accounts","CIBC Bank","Bank Account","Bank Account"]);});
