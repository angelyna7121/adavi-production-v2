import { applyOwnershipToRow, deriveSelectedInvestorReport } from "../reportData";
import type { ParsedRow } from "../documentParser";
import { financialSummary } from "./summary";
import { validateInsights, type DemoScope, type FinancialInsights, type ValidatedFinancialSummary } from "./contracts";

export const DEMO_VERSION = "synthetic-fixture-v1";
/** Deliberately independent of uploaded files, UI samples, investor names, dates,
 * and customer balances. Only these server-owned fixtures can reach demo mode. */
export function demoSummary(scope: DemoScope): ValidatedFinancialSummary {
  const seed = (id: string, investorId: string, category: string, current: number, previous: number | null, kind: "Asset" | "Liability", ownership = 100): ParsedRow => applyOwnershipToRow({ id, investorId, investor: "Synthetic investor", statementId: id, include: true, category, institution: "", holder: "", accountName: "Synthetic account", description: "Synthetic account", source: "Synthetic fixture", current, previous, kind }, ownership);
  const rows = [
    seed("cash", "demo-a", "Cash & Bank Accounts", 60000, 55000, "Asset"),
    seed("investments", "demo-a", "Investments", 480000, 440000, "Asset", 50),
    seed("debt", "demo-a", "Loans Payable", 80000, 85000, "Liability"),
    seed("property", "demo-b", "Real Estate", 700000, 680000, "Asset"),
    seed("mortgage", "demo-b", "Mortgages Payable", 300000, null, "Liability"),
  ];
  const investors = [{ investorId: "demo-a", name: "Synthetic investor A" }, { investorId: "demo-b", name: "Synthetic investor B" }];
  const selected = scope === "individual" ? ["demo-a"] : ["demo-a", "demo-b"];
  const report = deriveSelectedInvestorReport(rows, investors, selected);
  return financialSummary(report, { date: "2026-09-30", currency: "CAD", currencies: ["CAD"], dataVersion: DEMO_VERSION, source: "synthetic-demo" });
}

/** Handwritten synthetic commentary, never marketed as a model response. All
 * amounts in the UI come from the existing financial engine via metric cards. */
export function demoInsights(summary: ValidatedFinancialSummary): FinancialInsights {
  const previousMissing = summary.metrics.find(metric => metric.id === "net-worth.previous")?.value === null;
  return validateInsights({ sections: [
    { id: "executive", narrative: "This synthetic position presents recorded assets alongside recorded obligations. The difference is the ownership-adjusted net worth shown in the verified figures.", metricIds: ["assets.current", "liabilities.current", "net-worth.current"], limitations: [] },
    { id: "assets", narrative: "The recorded asset categories describe the composition of this example. Category balances help identify concentration, but do not establish investment liquidity or future performance.", metricIds: summary.metrics.filter(metric => /^asset\.category\d+\.current$/.test(metric.id)).map(metric => metric.id).slice(0, 8), limitations: ["Category labels alone do not establish valuation quality or diversification within an account."] },
    { id: "liabilities", narrative: "The liabilities-to-assets metric describes recorded leverage. Its implications depend on interest rates, repayment terms and cash flow; the ratio is not a universal safety threshold.", metricIds: ["liabilities.current", "debt-to-assets"], limitations: [] },
    { id: "changes", narrative: previousMissing ? "Some previous balances are unavailable in this consolidated example. Aggregate changes cannot be interpreted reliably from incomplete comparisons." : "The verified comparison shows changes in the recorded balances between reporting periods. The data does not explain whether changes arose from cash flows, valuation changes or investment performance.", metricIds: ["assets.change", "liabilities.change", "net-worth.change", "data.missing-previous"], limitations: [] },
    { id: "strengths", narrative: "Recorded assets exceed recorded liabilities in this synthetic example. This is a balance-sheet observation, not a judgment about financial security, creditworthiness or cash-flow capacity.", metricIds: ["net-worth.current", "net-worth-to-assets"], limitations: [] },
    { id: "attention", narrative: "Review the recorded asset composition and obligations together. Concentration and incomplete records may warrant discussion with a financial professional before drawing broader conclusions.", metricIds: ["debt-to-assets", "data.missing-previous", "data.review-flags"], limitations: [] },
    { id: "questions", narrative: "Use the review questions below to explore valuation support, liquidity, repayment commitments and the completeness of prior-period records.", metricIds: ["assets.current", "liabilities.current", "data.missing-previous"], limitations: [] },
    { id: "limitations", narrative: "This demonstration uses synthetic balances only. It does not include customer financial records, income, expenses, cash flows, tax circumstances or debt terms.", metricIds: ["data.included-accounts", "data.missing-previous"], limitations: ["This is not an audit, valuation, credit assessment or certified financial opinion."] },
  ], questions: [
    { text: "Which valuations and ownership allocations should be confirmed with supporting records?", metricIds: ["assets.current"] },
    { text: "What repayment commitments and cash-flow needs should be reviewed with a financial professional?", metricIds: ["liabilities.current", "debt-to-assets"] },
    { text: "Which prior-period records are needed to make a complete comparison?", metricIds: ["data.missing-previous", "net-worth.previous"] },
  ] }, summary);
}
