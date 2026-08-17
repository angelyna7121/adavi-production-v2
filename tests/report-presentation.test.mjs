import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const css=await readFile(new URL("../app/globals.css",import.meta.url),"utf8");
const app=await readFile(new URL("../app/report-app.tsx",import.meta.url),"utf8");
const subscription=await readFile(new URL("../app/lib/subscription.ts",import.meta.url),"utf8");

test("keeps three summary cards in one desktop and print row",()=>{assert.match(css,/\.summaryCards\s*\{[^}]*grid-template-columns:repeat\(3,1fr\)/);assert.match(css,/@media print[\s\S]*?\.summaryCards\s*\{[^}]*repeat\(3,minmax\(0,1fr\)\)/);});
test("right aligns monetary columns with tabular numerals",()=>{assert.match(css,/\.reportTable td:not\(:first-child\)[^{]*\{[^}]*text-align:right;[^}]*font-variant-numeric:tabular-nums lining-nums/);});
test("prints an unrotated A4 landscape report",()=>{assert.match(css,/@page\s*\{\s*size:A4 landscape;\s*margin:12mm;/);assert.doesNotMatch(css,/@media print[\s\S]*(?:transform:\s*rotate|writing-mode)/);});
test("free users see upgrade rather than an enabled branding removal control",()=>{assert.match(app,/hasVerifiedPaidEntitlement \?/);assert.match(app,/>Remove adavi\.ai branding<\/button> : <button/);assert.match(app,/>Upgrade for CSV & unbranded reports<\/button>/);assert.match(subscription,/import "server-only"/);assert.match(subscription,/return false/);});
test("renders one editable account-description field per review row",()=>{assert.match(app,/aria-label="Account description"/);assert.doesNotMatch(app,/aria-label="Account"/);assert.doesNotMatch(app,/<small>\{row\.accountName\}<\/small>/);});
test("category headings show both period labels instead of a current-only amount",()=>{assert.match(app,/showColumnLabels \? <>\s*<span className="periodHeading">Current<\/span><span className="periodHeading">Previous<\/span>/);assert.match(css,/\.disclosureToggle[^}]*grid-template-columns:[^}]*160px[^}]*160px/);});
test("removes the account-description heading row from the statement",()=>{assert.doesNotMatch(app,/accountDescriptionHeading/);assert.doesNotMatch(app,/className="reportTable accountTable"><thead>/);});
test("removes the obsolete net-worth-by-investor table",()=>{assert.doesNotMatch(app,/Net Worth by Investor/);});
