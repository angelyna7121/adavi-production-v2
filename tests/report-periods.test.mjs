import assert from "node:assert/strict";
import test from "node:test";
const {reportPeriodLabels}=await import("../app/lib/reportPeriods.ts");

test("uses the entered statement date and the immediately preceding calendar month",()=>{
  const july=reportPeriodLabels("2026-07-31");
  assert.deepEqual(july,{current:"Jul 31, 2026",previous:"Jun 30, 2026",currentMonth:"July 2026",previousMonth:"June 2026"});
});

test("maps January to December of the prior year without subtracting thirty days",()=>{
  const january=reportPeriodLabels("2027-01-31");
  assert.deepEqual(january,{current:"Jan 31, 2027",previous:"Dec 31, 2026",currentMonth:"January 2027",previousMonth:"December 2026"});
});
