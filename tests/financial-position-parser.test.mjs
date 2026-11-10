import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFinancialPositionWords,statementType,statementSection} from '../app/lib/financialPositionParser.ts';
import {findDarkHeadingBands} from '../app/lib/ocrDarkBands.ts';
import {DocumentImportError} from '../app/lib/documentParser.ts';
function fixture({reverse=false,missing=null,confidence=95,control='32,345.67'}={}){
 const words=[];let y=20;const add=(text,x,row,score=confidence)=>words.push({text,confidence:score,x0:x,y0:row,x1:x+text.length*7,y1:row+14});
 const line=(label,current,previous)=>{add(label,20,y);if(current!==null)add(current,500-current.length*7,y);if(previous!==null)add(previous,750-previous.length*7,y);y+=40;};
 add('Statement of Financial Position',20,y);y+=40;
 add(reverse?'Sep 30, 2026':'Oct 31, 2026',500-12*7,y);add(reverse?'Oct 31, 2026':'Sep 30, 2026',750-12*7,y);y+=40;
 line('TOTAL ASSETS',null,null); // summary cards do not open a section
 line('ASSETS — CASH AND INVESTMENTS',null,null);
 line('Invented Bank operating',missing==='current'?null:'12,345.67',missing==='previous'?null:'11,000.25');
 line('1177 Fiction Street property','20,000','19,000');line('Invented Bank zero','0','0');
 line('Subtotal assets',control,'30,000.25');line('TOTAL ASSETS',control,'30,000.25');
 line('L I A B I L I T I E S : Loans and payables',null,null);line('Invented Lender loan','5,000','4,000');line('TOTAL LIABILITIES','5,000','4,000');
 line('EQUITY',null,null);line('Retained earnings','50,000','40,000');line('Net Income','20,000','10,000');line('TOTAL EQUITY','70,000','50,000');line('INSIGHTS',null,null);line('Assets increased','100,000','90,000');
 return words;
}
test('positioned financial statements preserve leaves, cents, zeros and provenance',()=>{
 const {rows,status}=parseFinancialPositionWords(fixture(),'invented.pdf');assert.equal(status,'parsed');assert.equal(rows.length,4);assert.deepEqual(rows.map(r=>[r.description,r.current,r.previous,r.kind]),[['Invented Bank operating',12345.67,11000.25,'Asset'],['1177 Fiction Street property',20000,19000,'Asset'],['Invented Bank zero',0,0,'Asset'],['Invented Lender loan',5000,4000,'Liability']]);assert.ok(rows.every(r=>r.sourceRow&&r.isLeafAccount));assert.equal(rows[0].sourceCurrentDate,'2026-10-31');assert.equal(rows[0].sourcePreviousDate,'2026-09-30');assert.equal(rows[0].sourceAssetTotalCurrent,32345.67);assert.equal(rows[0].category,'Cash & Bank Accounts');assert.equal(rows[1].category,'Real Estate');
});
test('calendar order determines current and previous even when columns reverse',()=>{
 const {rows}=parseFinancialPositionWords(fixture({reverse:true}),'invented.pdf');assert.equal(rows[0].current,11000.25);assert.equal(rows[0].previous,12345.67);assert.equal(rows[0].sourceCurrentDate,'2026-10-31');
});
test('missing prior stays null, missing current stays empty, and mismatches require review',()=>{
 const prior=parseFinancialPositionWords(fixture({missing:'previous'}),'invented.pdf');assert.equal(prior.rows[0].previous,null);assert.equal(prior.status,'uncertain');
 const current=parseFinancialPositionWords(fixture({missing:'current'}),'invented.pdf');assert.equal(current.rows[0].current,'');assert.ok(current.rows[0].needsReview);
 const mismatch=parseFinancialPositionWords(fixture({control:'32,999.67'}),'invented.pdf');assert.equal(mismatch.rows.length,4);assert.ok(mismatch.rows.every(r=>r.manuallyReviewRequired));
});
test('low confidence requires review and absent column evidence returns uncertain',()=>{
 assert.ok(parseFinancialPositionWords(fixture({confidence:50}),'invented.pdf').rows.every(r=>r.needsReview));
 const result=parseFinancialPositionWords(fixture().filter(w=>!/Sep|Oct/.test(w.text)),'invented.pdf');assert.equal(result.status,'uncertain');assert.deepEqual(result.rows,[]);
});
test('statement classification tolerates section spacing and rejects earnings',()=>{
 assert.equal(statementType('Statement of Earnings\nRevenue\nNet Income'),'earnings');assert.equal(parseFinancialPositionWords([{text:'Statement of Earnings',confidence:95,x0:0,y0:0,x1:400,y1:20}],'earnings.pdf').status,'unsupported');
 assert.equal(statementSection('A S S E T S: cash and investments'),'Asset');assert.equal(statementSection('LIABILITIES — loans and payables'),'Liability');assert.equal(statementSection('Retained earnings'),'excluded');
});
test('dark heading detector ignores small ink and returns broad bands',()=>{
 const width=200,height=100,pixels=new Uint8ClampedArray(width*height*4).fill(255);for(let y=20;y<50;y++)for(let x=20;x<180;x++)for(let channel=0;channel<3;channel++)pixels[(y*width+x)*4+channel]=30;
 assert.deepEqual(findDarkHeadingBands(pixels,width,height),[{y0:20,y1:50,x0:20,x1:180}]);assert.equal(new DocumentImportError('uncertain',[2]).message.includes('page 2'),true);
});
test('source controls still require review after editing and do not depend on ownership',async()=>{
 const {sourcePositionNeedsReview,applyOwnershipToRow}=await import('../app/lib/reportData.ts');const rows=parseFinancialPositionWords(fixture(),'invented.pdf').rows;assert.equal(sourcePositionNeedsReview(rows),false);assert.equal(sourcePositionNeedsReview(rows.map(r=>applyOwnershipToRow(r,50))),false);assert.equal(sourcePositionNeedsReview(rows.map((r,i)=>i===0?{...r,current:1,needsReview:false,manuallyReviewRequired:false}:r)),true);
});
test('equity-only continuation pages are excluded only with positive section evidence',async()=>{
 const {isEquityOnlyPage}=await import('../app/lib/financialPositionParser.ts');const word=(text,y)=>({text,confidence:95,x0:20,y0:y,x1:300,y1:y+14});assert.equal(isEquityOnlyPage([word('Statement of Financial Position',10),word('EQUITY',50),word('Retained earnings 50,000',90)]),true);assert.equal(isEquityOnlyPage([word('Unclassified account 50,000',10),word('EQUITY',50)]),false);assert.equal(isEquityOnlyPage([word('LIABILITIES',10),word('EQUITY',50)]),false);
});
test('missing prior values remain distinct from zero through print and CSV models',async()=>{
 const {buildInvestorStatement,paginateInvestorStatement,createReportCsv}=await import('../app/lib/reportData.ts');const {statementPresentation}=await import('../app/lib/statementPresentation.ts');const rows=parseFinancialPositionWords(fixture({missing:'previous'}),'invented.pdf').rows.map(row=>({...row,investor:'Invented Investor'}));const statement=statementPresentation(buildInvestorStatement(rows));const accounts=statement.sections.flatMap(section=>section.categories.flatMap(category=>category.accounts));assert.equal(accounts.find(account=>account.name==='Invented Bank operating').previousMissing,true);assert.equal(accounts.find(account=>account.name==='Invented Bank zero').previousMissing,false);assert.equal(statement.previousMissing,true);assert.equal(paginateInvestorStatement(statement).flat().find(row=>row.level==='netWorth').previousMissing,true);const line=createReportCsv(rows).split('\r\n').find(line=>line.includes('Invented Bank operating'));assert.ok(line.includes(',"","",'));
});
