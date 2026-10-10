import assert from 'node:assert/strict';
import test from 'node:test';
const {statementPresentation,paginateMeasuredStatement}=await import('../app/lib/statementPresentation.ts');
const {deriveSelectedInvestorReport,paginateInvestorStatement,setRowOwnershipOverride,applyOwnershipToRow}=await import('../app/lib/reportData.ts');
const row={id:'a',include:true,investorId:'first',investor:'Same Name',statementId:'one',description:'Account',category:'Cash',holder:'Bank',institution:'Bank',kind:'Asset',source:'statement.pdf',current:10.01,previous:9.01,rawCurrent:10.01,rawPrevious:9.01,ownershipPercentage:100};
const investors=[{investorId:'first',name:'Same Name'},{investorId:'second',name:'Same Name'}];
test('presentation uses selected IDs and rounded leaf cents consistently without mutating CSV rows',()=>{
 const owned=setRowOwnershipOverride(applyOwnershipToRow(row,50),34);
 const inputs=[owned,{...row,id:'b',investorId:'second',rawCurrent:99999,current:99999},{...owned,id:'duplicate'},{...owned,id:'total',isSourceTotal:true},{...owned,id:'unchecked',include:false}];
 const selected=deriveSelectedInvestorReport(inputs,investors,['first']);
 const statement=statementPresentation(selected.statement);
 assert.equal(selected.rows.length,1);
 assert.equal(statement.sections[0].categories[0].accounts[0].ownership,34);
 assert.equal(statement.currentShareAssets,3.4);
 assert.equal(statement.previousShareAssets,3.06);
 assert.equal(statement.currentShareNetWorth,3.4);
 assert.equal(statement.sections[0].categories.reduce((sum,c)=>sum+c.currentShare,0),statement.currentShareAssets);
 assert.equal(selected.rows[0].current,owned.current);
 assert.equal(statement.sections[0].categories[0].accounts[0].currentFull,10.01);
 assert.equal(statement.currentShareNetWorth,statement.currentShareAssets-statement.currentShareLiabilities);
});
test('rounding happens per account before adding category and statement totals',()=>{
 const rows=Array.from({length:3},(_,i)=>({...applyOwnershipToRow(row,50),id:`a${i}`,description:`Account ${i}`}));
 const source=deriveSelectedInvestorReport(rows,investors,['first']).statement;
 const statement=statementPresentation(source);
 assert.equal(statement.currentShareAssets,15.03);
 assert.equal(statement.previousShareAssets,13.53);
 assert.equal(source.currentShareAssets,15.015);
});
test('measured pagination keeps headings and totals with accounts and balances short final pages',()=>{
 const rows=Array.from({length:55},(_,i)=>({...row,id:`a${i}`,description:`Account ${i}`}));
 const flat=paginateInvestorStatement(deriveSelectedInvestorReport(rows,investors,['first']).statement,Number.MAX_SAFE_INTEGER).flat();
 const heights=flat.map(r=>r.level==='account'?30:24);
 const pages=paginateMeasuredStatement(flat,heights,550);
 assert.ok(pages.length>1);
 assert.deepEqual(pages.flat(),flat);
 for(const page of pages){
   assert.ok(page.some(r=>r.level==='account'));
   assert.ok(page.reduce((sum,r)=>sum+heights[flat.indexOf(r)],0)<=550);
   assert.ok(!['section','category'].includes(page.at(-1).level));
   assert.ok(!['subtotal','sectionTotal','netWorth'].includes(page[0].level));
 }
 assert.ok(pages.at(-1).filter(r=>r.level==='account').length>=10);
});
test('wrapped row heights change pagination without losing leaf accounts',()=>{
 const rows=Array.from({length:16},(_,i)=>({...row,id:`a${i}`,description:`Account ${i}`}));
 const flat=paginateInvestorStatement(deriveSelectedInvestorReport(rows,investors,['first']).statement,Number.MAX_SAFE_INTEGER).flat();
 const compact=paginateMeasuredStatement(flat,flat.map(()=>20),500);
 const wrapped=paginateMeasuredStatement(flat,flat.map(r=>r.level==='account'?45:20),500);
 assert.equal(compact.length,1);assert.equal(wrapped.length,2);
 assert.deepEqual(wrapped.flat(),flat);
 assert.throws(()=>paginateMeasuredStatement(flat,flat.map(()=>600),500),/exceeds/);
});
test('statement formatting rounds to whole amounts and uses the selected currency',async()=>{
 const {formatStatementAmount}=await import('../app/lib/statementPresentation.ts');
 assert.equal(formatStatementAmount(3.4,'CAD'),'$3');
 assert.equal(formatStatementAmount(3.06,'EUR'),'€3');
 assert.equal(formatStatementAmount(-3.06,'CAD'),'($3)');
 assert.equal(formatStatementAmount(1000,'CAD'),'$1,000');
 assert.equal(formatStatementAmount(3.5,'CAD'),'$4');
 assert.equal(formatStatementAmount(-3.5,'CAD'),'($4)');
 assert.equal(formatStatementAmount(3.4999,'CAD'),'$3');
 assert.equal(formatStatementAmount(1234.6,''),'1,235');
});
test('rounds half-cent shares reliably and groups accounts by holder without changing source order',async()=>{
 const {roundCurrency}=await import('../app/lib/statementPresentation.ts');
 assert.equal(roundCurrency(10.075),10.08);
 assert.equal(roundCurrency(-10.075),-10.08);
 const inputs=[{...row,id:'z',holder:'Z Bank',description:'Last',rawCurrent:20.15,current:10.075,ownershipPercentage:50},{...row,id:'a',holder:'A Bank',description:'First'}];
 const source=deriveSelectedInvestorReport(inputs,investors,['first']).statement;
 const shown=statementPresentation(source);
 assert.deepEqual(shown.sections[0].categories[0].accounts.map(a=>a.holder),['A Bank','Z Bank']);
 assert.equal(shown.sections[0].categories[0].accounts[1].currentShare,10.08);
 assert.equal(source.sections[0].categories[0].accounts[0].holder,'Z Bank');
});
test('many short categories stay with their first account, while long categories span pages',()=>{
 const inputs=Array.from({length:32},(_,i)=>({...row,id:`row${i}`,description:`Account ${i}`,category:i<20?'Long category':`Category ${i}`,kind:i%5===0?'Liability':'Asset'}));
 const selected=deriveSelectedInvestorReport(inputs,investors,['first']);
 const shown=statementPresentation(selected.statement);
 for(const section of shown.sections){
   assert.equal(Math.round(section.currentShare*100),section.categories.reduce((sum,c)=>sum+Math.round(c.currentShare*100),0));
 }
 const flat=paginateInvestorStatement(shown,Number.MAX_SAFE_INTEGER).flat();
 const pages=paginateMeasuredStatement(flat,flat.map(r=>r.level==='account'?35:24),500);
 assert.ok(pages.length>2);
 assert.deepEqual(pages.flat(),flat);
 for(const page of pages){
   assert.ok(page.some(r=>r.level==='account'));
   page.forEach((r,index)=>{if(r.level==='category')assert.equal(page[index+1]?.level,'account');});
 }
});
