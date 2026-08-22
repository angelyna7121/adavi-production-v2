import assert from "node:assert/strict";
import test from "node:test";
const { parseFinancialText } = await import("../app/lib/documentParser.ts");
const { CSV_HEADERS, assignInvestor, calculateAssetMix, calculatePeriodTotals, confirmedDetailRows, createReportCsv, filterPrintableSchedulePages, groupReportRows, hasUnnamedIncludedRows, paginateReportSchedule, reassignInvestor } = await import("../app/lib/reportData.ts");

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

test("calculates liabilities as absolute obligations from the canonical leaf dataset",()=>{const negative={...rows.at(-1),id:"negative-liability",current:-224000,previous:-200000};assert.deepEqual(calculatePeriodTotals([...rows.slice(0,-1),negative],"current").liabilities,224000);assert.deepEqual(calculatePeriodTotals([...rows.slice(0,-1),negative],"previous").liabilities,200000);});

test("builds investor, section, category, holder, and account grouping", () => {
  const groups=groupReportRows(rows); assert.equal(groups[0].investor,"Ari Family"); assert.deepEqual(groups[0].sections.map((s)=>s.kind),["Asset","Liability"]);
  const mortgage=groups[0].sections[0].categories.find((c)=>c.category==="Mortgage Investments / Mortgage Receivables"); assert.equal(mortgage.holders[0].holder,"Sky Mortgage Corporation"); assert.equal(mortgage.holders[0].rows.length,3); assert.equal(mortgage.total,1000000);
});

test("holder groups preserve separate current and previous totals", () => {
  const grouped = groupReportRows([{ ...rows[0], id: "cibc-suffolk", investor: "Alex", source: "bank.csv", description: "CIBC Bank-Suffolk LP", current: 2_520_363, previous: 3_514_156, holder: "CIBC Bank", institution: "CIBC Bank", accountName: "CIBC Bank-Suffolk LP", category: "Cash & Bank Accounts" }]);
  assert.deepEqual({ current: grouped[0].sections[0].categories[0].holders[0].total, previous: grouped[0].sections[0].categories[0].holders[0].previousTotal }, { current: 2_520_363, previous: 3_514_156 });
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
  assert.deepEqual(mix.map((entry) => entry.total), [...mix.map((entry) => entry.total)].sort((a, b) => b - a));
});

test("assigns and reassigns investors and rejects unnamed included rows",()=>{const unassigned={...rows[0],investor:""};assert.equal(hasUnnamedIncludedRows([unassigned]),true);assert.throws(()=>assignInvestor([unassigned],"x"," "),/required/);assert.equal(reassignInvestor(rows[0],"two","Jordan").investor,"Jordan");});

test("paginates a dynamic schedule without losing or duplicating accounts",()=>{const many=Array.from({length:37},(_,index)=>({...rows[3],id:`many-${index}`,description:`Dynamic mortgage ${index+1}`,accountName:`Dynamic mortgage ${index+1}`,current:1000+index,previous:index%4?900+index:0}));const pages=paginateReportSchedule(groupReportRows(many),12);assert.ok(pages.length>1);assert.ok(pages.every((page)=>page.length<=12));const accounts=pages.flat().filter((row)=>row.level==="account");assert.equal(accounts.length,37);assert.equal(new Set(accounts.map((row)=>row.label)).size,37);assert.equal(pages.flat().filter((row)=>row.level==="total").length,1);for(const page of pages.slice(1)){assert.equal(page[0].level,"investor");assert.ok(page.some((row)=>row.level==="category"));}});

test("packs default print pages without empty, heading-only, subtotal-only, or footer-overflow pages",()=>{const many=Array.from({length:55},(_,index)=>({...rows[3],id:`dense-${index}`,description:`Dense account ${index+1}`,accountName:`Dense account ${index+1}`,current:1000+index,previous:900+index}));const pages=paginateReportSchedule(groupReportRows(many));assert.equal(pages.length,4);assert.ok(pages.every((page)=>page.some((row)=>row.level==="account")));assert.ok(pages.every((page)=>page.length<=22));for(const page of pages){const firstAccount=page.findIndex((row)=>row.level==="account");assert.ok(firstAccount>=0);assert.ok(page.slice(0,firstAccount).every((row)=>row.level!=="total"));}const totalPage=pages.find((page)=>page.some((row)=>row.level==="total"));assert.ok(totalPage.some((row)=>row.level==="account"));});

test("filters calculated pages that contain no meaningful account content",()=>{const heading=(level,label)=>({key:`${level}-${label}`,level,label});const account={key:"account",level:"account",label:"Account",current:10,previous:9};const subtotal={key:"subtotal",level:"total",label:"Total Category",current:10,previous:9};const pages=filterPrintableSchedulePages([[heading("investor","Investor"),heading("category","Empty")],[heading("category","Category"),account],[heading("category","Continued"),subtotal],[]]);assert.equal(pages.length,1);assert.equal(pages[0].filter((row)=>row.level==="account").length,1);assert.equal(pages[0].filter((row)=>row.level==="total").length,1);});

test("exports exact headers and leaf accounts only",()=>{const csv=createReportCsv([...rows,{...rows[0],id:"t",description:"Total Assets",accountName:"Total Assets",current:2935282.7}]);assert.equal(csv.codePointAt(0),0xfeff);assert.ok(csv.endsWith("\r\n"));const lines=csv.slice(1).trimEnd().split("\r\n");const parse=(line)=>[...line.matchAll(/(?:^|,)(?:"((?:""|[^"])*)"|([^,]*))/g)].map((m)=>(m[1]??m[2]).replaceAll('""','"'));assert.deepEqual(parse(lines[0]),[...CSV_HEADERS]);assert.equal(lines.length,8);assert.ok(!csv.includes("Total Assets"));assert.deepEqual(parse(lines[1]).slice(0,6),["Ari Family","Asset","Cash & Bank Accounts","CIBC Bank","Bank Account","Bank Account"]);});
