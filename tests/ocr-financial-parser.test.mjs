import assert from "node:assert/strict";
import test from "node:test";
const { parseAccountingAmount, parseOcrFinancialWords } = await import("../app/lib/ocrFinancialParser.ts");
const { rotationCandidates, shouldUseOcr } = await import("../app/lib/documentParser.ts");
const { calculatePeriodTotals, calculateReconciliation, confirmedDetailRows } = await import("../app/lib/reportData.ts");

let y=20;const words=[];
function line(text, previous=null, current=null, confidence=94){let x=40;for(const token of text.split(" ")){words.push({text:token,confidence,x0:x,y0:y,x1:x+token.length*8,y1:y+16});x+=token.length*8+7;}if(previous!==null)words.push({text:previous,confidence,x0:470,y0:y,x1:550,y1:y+16});if(current!==null)words.push({text:current,confidence,x0:870,y0:y,x1:960,y1:y+16});y+=24;}
line("SUFFOLK INDUSTRIAL COMMODITIES INC.");line("NET WORTH");line("EQUITY 30-Jun-26",null,null);words.at(-1).x0=470;words.at(-1).x1=550;line("EQUITY 31-Jul-26");words.at(-1).x0=870;words.at(-1).x1=960;
line("REAL ESTATE");
line("1177 Yonge St., Toronto","300,000","300,000");const propertyY=y-24;words.push({text:"800,000",confidence:94,x0:630,y0:propertyY,x1:700,y1:propertyY+16},{text:"800,000",confidence:94,x0:740,y0:propertyY,x1:810,y1:propertyY+16});
line("INVESTMENTS");line("Kingsberg Plaza (6 Plazas)","935,445","935,445");line("Suffolk LP","3,034,311","3,034,311");
line("LOANS RECEIVABLE");line("Jorlee Holdings loans","3,781,300","3,781,300");line("Suffolk LP - receivable","2,200,001","3,200,000");
line("MORTGAGES");line("9390 Woodbine Ave","3,000,000","3,000,000");line("136 Markland Street","2,000,000","2,000,000");line("Mortgage portfolio accounts","2,371,085","2,641,069");line("TOTAL MORTGAGES","7,371,085","7,641,069");
line("CORPORATE TAX INSTALMENT");line("Corporate tax instalment","914,386","983,727");line("Corporate tax payable","(914,386)","(983,727)");
line("LOAN PAYABLE - Fleet Street Financial Corp.","(2,280,517)","(2,280,517)");line("LOAN PAYABLE - Ariana Ferrer","(10,000)","(10,000)");line("LOAN PAYABLE - Suffolk LP","(2,200,000)","(3,200,000)");line("SHAREHOLDER ADVANCE - Jay Borkowsky","(950,000)","(950,000)");
line("CIBC Bank","623,646","1,347,353");line("CIBC Bank-Suffolk LP","3,514,156","2,520,363");
line("TOTAL NET WORTH","16,319,426","16,319,323");line("37.50% 1177 Yonge Street");line("Page 1");

const parsed=parseOcrFinancialWords(words,"scanned.pdf");const leaves=confirmedDetailRows(parsed.rows);

test("accounts for 270 degree PDF rotation candidates",()=>assert.deepEqual(rotationCandidates(270),[270,0,90,180]));
test("activates OCR fallback when text extraction has no credible rows",()=>{assert.equal(shouldUseOcr([]),true);assert.equal(shouldUseOcr([{id:"leaf"}]),false);});
test("parses parentheses and rejects streets, percentages, dates, and dashes as balances",()=>{assert.equal(parseAccountingAmount("$ (2,280,517)"),-2280517);assert.equal(parseAccountingAmount("1177"),null);assert.equal(parseAccountingAmount("37.50%"),null);assert.equal(parseAccountingAmount("31-Jul-26"),null);assert.equal(parseAccountingAmount("-"),null);});
test("reconstructs current and previous columns and excludes category totals",()=>{assert.ok(!leaves.some((row)=>/total/i.test(row.description)));assert.equal(leaves.find((row)=>row.description.includes("Fleet Street")).current,2280517);assert.equal(leaves.find((row)=>row.description.includes("Fleet Street")).previous,2280517);});
test("preserves opening accounts and uses equity rather than property-analysis columns",()=>{assert.deepEqual(leaves.slice(0,3).map((row)=>row.description),["1177 Yonge St., Toronto","Kingsberg Plaza (6 Plazas)","Suffolk LP"]);assert.deepEqual([leaves[0].previous,leaves[0].current],[300000,300000]);assert.deepEqual([leaves[0].sourcePreviousDate,leaves[0].sourceCurrentDate],["2026-06-30","2026-07-31"]);assert.ok(!leaves.some((row)=>row.current===800000));});
test("keeps loans receivable out of Investments",()=>{for(const name of ["Jorlee Holdings loans","Suffolk LP - receivable"]){assert.equal(leaves.find((row)=>row.description===name).category,"Loans Receivable");}});
test("produces published totals while preserving the source's one-dollar leaf discrepancy",()=>{const current=calculatePeriodTotals(leaves,"current"),previous=calculatePeriodTotals(leaves,"previous");assert.equal(current.leafAssets,23743568);assert.deepEqual([current.assets,current.liabilities,current.netWorth],[23743567,7424244,16319323]);assert.deepEqual([previous.assets,previous.liabilities,previous.netWorth],[22674329,6354903,16319426]);assert.equal(current.netWorth-previous.netWorth,-103);assert.deepEqual(calculateReconciliation(leaves),{calculated:16319324,source:16319323,difference:1,matches:true});});
test("preserves individual mortgage leaf accounts",()=>{const mortgages=leaves.filter((r)=>r.category==="Mortgage Investments / Mortgage Receivables");assert.equal(mortgages.length,3);assert.equal(mortgages.reduce((s,r)=>s+r.current,0),7641069);});
test("flags low confidence rows rather than inventing values",()=>{const uncertain=words.map((word)=>({...word,confidence:word.text==="2,520,363"?42:word.confidence}));assert.equal(parseOcrFinancialWords(uncertain,"scan.pdf").rows.find((row)=>row.current===2520363).needsReview,true);});
