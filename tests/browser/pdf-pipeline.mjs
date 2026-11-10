// Real Chromium -> PDF.js canvas -> local Tesseract -> application parser.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const scratch=path.join(root,'work/pdf-browser');await fs.mkdir(scratch,{recursive:true});
await build({stdin:{contents:`import {parseDocument} from './app/lib/documentParser';import {calculatePeriodTotals,createReportCsv,buildInvestorStatement} from './app/lib/reportData';import * as pdfjs from 'pdfjs-dist';Object.assign(window,{pipeline:{parseDocument,calculatePeriodTotals,createReportCsv,buildInvestorStatement,pdfjs}});`,resolveDir:root},bundle:true,format:'esm',platform:'browser',outfile:path.join(scratch,'bundle.js')});
const server=http.createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<input type="file"><script type="module" src="/bundle.js"></script>');}const file=req.url==='/bundle.js'?path.join(scratch,'bundle.js'):path.join(root,'public',req.url);if(!file.startsWith(root+path.sep))throw Error('invalid path');res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage();const external=[];
 await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
 await page.goto(origin);await page.waitForFunction(()=>window.pipeline);
 for(const name of ['embedded','outlined','mixed-earnings-outlined','mixed-position-pages','missing-prior','unreconciled']){
  await page.locator('input').setInputFiles(path.join(root,'tests/fixtures/pdf',`${name}.pdf`));
  const result=await page.evaluate(async()=>{const p=window.pipeline;const file=document.querySelector('input').files[0];p.pdfjs.GlobalWorkerOptions.workerSrc='/pdf/pdf.worker.min.mjs';const doc=await p.pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;const embedded=[];for(let n=1;n<=doc.numPages;n++)embedded.push((await (await doc.getPage(n)).getTextContent()).items.length);await doc.destroy();const progress=[];const rows=(await p.parseDocument(file,message=>progress.push(message))).map(row=>({...row,investor:'Invented Investor',investorId:'synthetic'}));return {rows,embedded,ocr:progress.some(message=>message.startsWith('OCR page')),totals:p.calculatePeriodTotals(rows,'current'),csv:p.createReportCsv(rows),statement:p.buildInvestorStatement(rows)};});
  const copies=name==='mixed-position-pages'?2:1;assert.equal(result.rows.length,5*copies,name);assert.equal(new Set(result.rows.map(row=>row.id)).size,result.rows.length,'unique provenance ids');
  assert.equal(result.rows.filter(row=>row.kind==='Liability').length,copies);assert.equal(result.rows.some(row=>/equity|earnings|income|summary|total/i.test(row.description)),false);
  const operating=result.rows.filter(row=>row.description==='Invented Bank operating');assert.equal(operating.length,copies);assert.ok(operating.every(row=>row.current===12345.67&&row.previous===(name==='missing-prior'?null:11000.25)));
  assert.equal(result.rows.filter(row=>row.description==='Invented Bank zero'&&row.current===0&&row.previous===0).length,copies);assert.equal(result.rows.filter(row=>row.description==='1177 Fiction Street property'&&row.current===40000).length,copies);
  assert.ok(Math.abs(result.totals.netWorth-67345.67*copies)<.00001);assert.equal(result.totals.assets-result.totals.liabilities,result.totals.netWorth);assert.equal(result.statement.currentShareNetWorth,result.totals.netWorth);
  assert.ok(result.csv.includes('Invented Bank operating'));assert.ok(result.csv.includes('12345.67'),'CSV retains the same cents as report calculations');
  assert.ok(result.rows.every(row=>row.sourcePage&&row.sourceRow));
  if(name==='outlined'){assert.deepEqual(result.embedded,[0,0]);assert.ok(result.rows.every(row=>row.sourcePage===2));}
  if(name==='mixed-position-pages'){assert.ok(result.embedded[0]>0);assert.equal(result.embedded[1],0);assert.ok(result.ocr);}
  if(name==='unreconciled'||name==='missing-prior')assert.ok(result.rows.every(row=>row.manuallyReviewRequired));
  console.log(`PASS ${name}: ${result.rows.length} leaves; periods, totals, CSV/report and provenance verified`);
 }
 for(const name of ['partial','unreadable','unsupported']){
  await page.locator('input').setInputFiles(path.join(root,'tests/fixtures/pdf',`${name}.pdf`));
  const result=await page.evaluate(async()=>{try{return {rows:await window.pipeline.parseDocument(document.querySelector('input').files[0],()=>{})};}catch(error){return {code:error.code,pages:error.pages};}});
  if(name==='partial'){assert.equal(result.rows.length,5);assert.ok(result.rows.every(row=>row.manuallyReviewRequired));assert.deepEqual(result.rows[0].sourceReviewPages,[2]);}
  else {assert.equal(result.code,name);assert.deepEqual(result.pages,[1]);}
  console.log(`PASS ${name}: page-specific review/error classification`);
 }
 assert.equal(external.length,0);console.log('PASS privacy: zero external requests');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
