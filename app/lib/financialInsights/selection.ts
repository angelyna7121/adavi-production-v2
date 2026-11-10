import { inspectAnalysisData } from "./eligibility";
import { summaryFromNormalized } from "./storedSummary";
import type { ParsedRow } from "../documentParser";
import { type ReportInvestor } from "../reportData";
import { financialSummary } from "./summary";
import { InsightsError, type ValidatedFinancialSummary } from "./contracts";
export type StoredFinancialReport = {
  accountId: string;
  versionId: string;
  revision: string;
  confirmed: boolean;
  rows: ParsedRow[];
  investors: ReportInvestor[];
  authorizedInvestorIds: string[];
  date: string;
  currency: string;
  currencies: string[];
  normalized?: import("../backend/normalizedTypes").NormalizedReport;
  investorReferences?: Record<string, string>;
};
/** Same selected-investor leaf model as print. Input MUST come from authorized,
 * persisted server records, never from browser financial totals. */
export function trustedSummary(
  stored: StoredFinancialReport,
  ids: string[],
  requestId: string,
  maxCategories = 20,
): ValidatedFinancialSummary {
  if (
    !stored.confirmed ||
    !ids.length ||
    ids.some(
      (id) =>
        !stored.authorizedInvestorIds.includes(id) ||
        !stored.investors.some((investor) => investor.investorId === id),
    )
  )
    throw new InsightsError("REPORT_UNAUTHORIZED", 403);
  if (stored.normalized)
    return summaryFromNormalized(
      stored.normalized,
      ids.map((id) => stored.investorReferences?.[id] ?? ""),
      requestId,
    );
  const inspected = inspectAnalysisData({
    rows: stored.rows,
    investors: stored.investors,
    selectedInvestorIds: ids,
    date: stored.date,
    currency: stored.currency,
    currencies: stored.currencies,
    maxCategories,
  });
  if (inspected.unexpectedFailure)
    throw new InsightsError("SERVICE_UNAVAILABLE", 503);
  if (!inspected.eligibility.eligible) {
    const code = inspected.issues.some(
      (issue) => issue.code === "reconciliation",
    )
      ? "RECONCILIATION_FAILED"
      : inspected.issues.some((issue) => issue.code === "period")
        ? "INVALID_REPORT_PERIOD"
        : inspected.issues.some((issue) => issue.code === "currency")
          ? "INVALID_FINANCIAL_SCOPE"
          : inspected.issues.some((issue) => issue.code === "category-limit")
            ? "CATEGORY_LIMIT"
            : "DATA_REQUIRES_REVIEW";
    throw new InsightsError(code, 422);
  }
  const report = inspected.report;
  const summary = financialSummary(report, {
    date: stored.date,
    currency: stored.currency,
    currencies: stored.currencies,
    dataVersion: requestId,
    source: "trusted-server",
  });
  const selectedRows = stored.rows.filter(
    (row) => row.investorId && ids.includes(row.investorId),
  );
  const lowConfidence = report.rows.filter(
    (row) => row.ocrConfidence !== undefined && row.ocrConfidence < 85,
  ).length;
  summary.metrics.push(
    {
      id: "data.excluded-rows",
      label: "Excluded rows",
      value: selectedRows.length - report.rows.length,
      unit: "count",
    },
    {
      id: "data.low-confidence",
      label: "Low confidence records",
      value: lowConfidence,
      unit: "count",
    },
    {
      id: "data.missing-current",
      label: "Accounts without current values",
      value: 0,
      unit: "count",
    },
  );
  if (lowConfidence)
    summary.limitations.push(
      "Some confirmed records have low source confidence; supporting records should be reviewed before financial decisions.",
    );
  return summary;
}
