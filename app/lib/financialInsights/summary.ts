import type { SelectedInvestorReport } from "../reportData";
import { reportPeriodLabels } from "../reportPeriods";
import { statementPresentation } from "../statementPresentation";
import { InsightsError, validateSummary, type Metric, type ValidatedFinancialSummary } from "./contracts";

const safeCategoryNames: Record<string, string> = {
  "real estate": "Real Estate", investments: "Investments", "cash & bank accounts": "Cash & Bank Accounts",
  "loans receivable": "Loans Receivable", "mortgage investments / mortgage receivables": "Mortgage Investments / Mortgage Receivables",
  "corporate tax instalment receivable": "Corporate Tax Instalment Receivable", "other receivables": "Other Receivables",
  vehicles: "Vehicles", "insurance cash value": "Insurance Cash Value", "inherited assets": "Inherited Assets", "other assets": "Other Assets",
  "corporate tax payable": "Corporate Tax Payable", "loans payable": "Loans Payable", "shareholder advances": "Shareholder Advances",
  "mortgages payable": "Mortgages Payable", "taxes owing": "Taxes Owing", "accounts payable": "Accounts Payable", "credit cards": "Credit Cards", "other liabilities": "Other Liabilities",
};

/** Caller must supply a server-authorized report, never browser totals. Reuses the
 * existing selected-investor and printed-statement model without changing its
 * special category treatment. Descriptions, identities and documents are omitted. */
export function financialSummary(report: SelectedInvestorReport, options: { date: string; currency: string; currencies: string[]; dataVersion: string; source: ValidatedFinancialSummary["source"] }): ValidatedFinancialSummary {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date) || Number.isNaN(Date.parse(options.date)) || new Date(`${options.date}T00:00:00Z`).toISOString().slice(0, 10) !== options.date) throw new InsightsError("INVALID_REPORT_PERIOD");
  if (!report.hasSelection || !report.rows.length || !/^[A-Z]{3}$/.test(options.currency) || options.currencies.length === 0 || options.currencies.some(currency => currency !== options.currency)) throw new InsightsError("INVALID_FINANCIAL_SCOPE");
  if (report.rows.some(row => row.current === "" || !Number.isFinite(row.current) || (row.previous !== null && !Number.isFinite(row.previous)))) throw new InsightsError("INVALID_FINANCIAL_DATA");
  const statement = statementPresentation(report.statement);
  const labels = reportPeriodLabels(options.date);
  const completePrevious = report.rows.every(row => row.previous !== null);
  const metrics: Metric[] = [];
  const add = (id: string, label: string, value: number | null, unit: Metric["unit"] = "currency") => metrics.push({ id, label, value, unit });
  add("assets.current", "Total assets", statement.currentShareAssets);
  add("liabilities.current", "Total liabilities", statement.currentShareLiabilities);
  add("net-worth.current", "Net worth", statement.currentShareNetWorth);
  add("assets.previous", "Previous assets", completePrevious ? statement.previousShareAssets : null);
  add("liabilities.previous", "Previous liabilities", completePrevious ? statement.previousShareLiabilities : null);
  add("net-worth.previous", "Previous net worth", completePrevious ? statement.previousShareNetWorth : null);
  add("assets.change", "Change in assets", completePrevious ? statement.currentShareAssets - statement.previousShareAssets : null);
  add("liabilities.change", "Change in liabilities", completePrevious ? statement.currentShareLiabilities - statement.previousShareLiabilities : null);
  add("net-worth.change", "Change in net worth", completePrevious ? statement.currentShareNetWorth - statement.previousShareNetWorth : null);
  add("debt-to-assets", "Liabilities / assets", statement.currentShareAssets > 0 ? statement.currentShareLiabilities / statement.currentShareAssets * 100 : null, "percent");
  add("net-worth-to-assets", "Net worth / assets", statement.currentShareAssets > 0 ? statement.currentShareNetWorth / statement.currentShareAssets * 100 : null, "percent");
  for (const section of statement.sections) {
    const kind = section.kind === "Asset" ? "asset" : "liability";
    section.categories.forEach((category, index) => {
      const label = safeCategoryNames[category.category.toLowerCase()] ?? `Other ${kind} category`;
      const categoryComplete = category.accounts.every(account => report.rows.find(row => row.id === account.id)?.previous !== null);
      add(`${kind}.category${index}.current`, label, category.currentShare);
      add(`${kind}.category${index}.previous`, `${label} (previous)`, categoryComplete ? category.previousShare : null);
      add(`${kind}.category${index}.change`, `${label} change`, categoryComplete ? category.currentShare - category.previousShare : null);
    });
  }
  add("data.included-accounts", "Included leaf accounts", report.rows.length, "count");
  add("data.missing-previous", "Accounts without previous values", report.rows.filter(row => row.previous === null).length, "count");
  add("data.review-flags", "Accounts flagged for review", report.rows.filter(row => row.needsReview).length, "count");
  const limitations = ["Income, expenses, cash flow, interest rates, valuation dates, tax circumstances, investment performance and debt maturity dates are not available.", "Absence of a recorded category does not establish that the exposure is zero.", "Balances are ownership-adjusted. Gross account balances are not substituted for investor shares."];
  if (!completePrevious) limitations.push("Previous-period coverage is incomplete; aggregate previous values and changes are unavailable for interpretation.");
  if (report.rows.some(row => row.needsReview)) limitations.push("Review flags remain in the source data; commentary cannot confirm the accuracy of those records.");
  return validateSummary({ version: "1", source: options.source, scope: { kind: report.investorIds.length === 1 ? "individual" : "consolidated", investorCount: report.investorIds.length }, reportingPeriod: { current: labels.current, previous: labels.previous }, currency: options.currency, dataVersion: options.dataVersion, metrics, limitations });
}
