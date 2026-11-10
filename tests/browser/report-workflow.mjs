import {chromium} from 'playwright-core';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs/promises';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:3000';const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const external=[];const errors=[];const uploads=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const request=route.request();if(new URL(request.url()).origin!==new URL(base).origin){external.push(request.url());return route.abort();}if(request.method()==='POST')uploads.push(new URL(request.url()).pathname);return route.continue();});
 await page.goto(base);await page.getByRole('textbox',{name:'Investor name',exact:true}).fill('Invented Investor');await page.locator('input[type=date]').fill('2026-10-31');
 await page.locator('input[type=file]').setInputFiles(path.resolve('tests/fixtures/pdf/mixed-earnings-outlined.pdf'));
 await page.getByRole('link',{name:'Review original'}).waitFor({timeout:180000});await page.getByRole('button',{name:'Review & Reconcile →'}).click();
 await page.locator('tr[data-financial-row-id]').first().waitFor();assert.equal(await page.locator('tr[data-financial-row-id]').count(),5);
 const first=page.locator('tr[data-financial-row-id]').first();await first.getByPlaceholder('Holder / institution').fill('Invented Bank revised');
 const generate=page.getByRole('button',{name:'Confirm & Generate Statement'});const acknowledgement=page.getByRole('checkbox',{name:/I reviewed flagged rows/});if(await acknowledgement.count())await acknowledgement.check();await generate.click();
 await page.getByRole('heading',{name:'Your selected statement is complete'}).waitFor();await page.locator('.printReport[data-pagination-ready="true"]').waitFor({state:'attached',timeout:30000});
 const ai=page.getByRole('button',{name:/Analyze My Financial Position/i});assert.ok(await ai.count());assert.equal(await ai.isDisabled(),true);
 const selection=page.getByRole('group',{name:'Investors to print'}).getByRole('checkbox',{name:'Invented Investor',exact:true});await selection.uncheck();assert.equal(await page.getByRole('button',{name:'Print selected investors'}).isDisabled(),true);await selection.check();
 await page.locator('.printReport[data-pagination-ready="true"]').waitFor({state:'attached'});await page.evaluate(()=>{window.__printCount=0;window.print=()=>window.__printCount++;});await page.getByRole('button',{name:'Print selected investors'}).click();await page.waitForFunction(()=>window.__printCount===1);
 await fs.mkdir('work/browser-evidence',{recursive:true});await page.screenshot({path:'work/browser-evidence/synthetic-report.png',fullPage:true});await page.emulateMedia({media:'print'});await page.pdf({path:'work/browser-evidence/synthetic-print.pdf',format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
 await page.getByRole('button',{name:'Download data',exact:true}).click();await page.getByText('Unlock premium reports',{exact:false}).waitFor({timeout:5000}).catch(async()=>{assert.ok((await page.locator('body').innerText()).includes('Upgrade'));});
 assert.equal(uploads.length,0,'local report workflow never uploads document contents');assert.equal(external.length,0);assert.deepEqual(errors,[]);
 console.log('PASS upload → reconcile → edit → investor selection → report → print; AI disabled; CSV access denied without entitlement; zero external requests/uploads');
 await page.goto(base);await page.getByRole('button',{name:'Use sample statements'}).click();await page.getByRole('button',{name:'Confirm & Generate Statement'}).click();await page.getByRole('heading',{name:'Your selected statement is complete'}).waitFor();assert.equal(await page.locator('.wealthOverview').first().getByText('N/A',{exact:true}).count(),2);assert.ok(await page.locator('.printReport .periodCell').filter({hasText:'N/A'}).count());console.log('PASS missing prior values display N/A in report and print');
 // An unsupported upload remains reviewable instead of disappearing.
 await page.goto(base);await page.getByRole('textbox',{name:'Investor name',exact:true}).fill('Invented Failure Review');
 await page.locator('input[type=file]').setInputFiles({name:'unsupported.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\ninvalid synthetic document')});await page.getByRole('link',{name:'Review original'}).waitFor({timeout:15000});assert.ok(await page.getByText(/could not extract financial balances/i).count());console.log('PASS failed upload retained for local manual review');
}finally{await browser.close();}
