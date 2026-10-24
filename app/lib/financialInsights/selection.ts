import { summaryFromNormalized } from "./storedSummary";
import type { ParsedRow } from "../documentParser";
import {
  applyOwnershipToRow,
  deriveSelectedInvestorReport,
  type ReportInvestor,
} from "../reportData";
import { statementPresentation, roundCurrency } from "../statementPresentation";
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
  const scope = stored.rows.filter(
    (row) => row.investorId && ids.includes(row.investorId) && row.include,
  );
  if (!scope.length) throw new InsightsError("DATA_REQUIRES_REVIEW", 422);
  for (const row of scope) {
    if (row.isSourceTotal || row.isLeafAccount === false) continue;
    if (row.needsReview || row.manuallyReviewRequired)
      throw new InsightsError("DATA_REQUIRES_REVIEW", 422);
    if (
      !["Asset", "Liability"].includes(row.kind) ||
      row.current === "" ||
      !Number.isFinite(row.current) ||
      row.current < 0 ||
      (row.previous !== null &&
        (!Number.isFinite(row.previous) || row.previous < 0))
    )
      throw new InsightsError("DATA_REQUIRES_REVIEW", 422);
    for (const raw of [row.rawCurrent, row.rawPrevious])
      if (
        raw !== undefined &&
        raw !== null &&
        (raw === "" || !Number.isFinite(raw) || raw < 0 || raw > 1e13)
      )
        throw new InsightsError("DATA_REQUIRES_REVIEW", 422);
  }
  let normalized: ParsedRow[];
  try {
    normalized = scope.map((row) =>
      row.rawCurrent === undefined
        ? row
        : applyOwnershipToRow(row, row.ownershipPercentage ?? 100),
    );
  } catch {
    throw new InsightsError("DATA_REQUIRES_REVIEW", 422);
  }
  const report = deriveSelectedInvestorReport(
    normalized,
    stored.investors,
    ids,
  );
  // An unresolved duplicate is not silently dropped for external processing.
  const candidates = scope.filter(
    (row) =>
      row.isSourceTotal !== true &&
      row.isLeafAccount !== false &&
      !/^\s*(?:grand\s+total|sub\s*total|subtotal|total)(?:\s|:|-|$)/i.test(
        row.description,
      ),
  );
  if (
    report.rows.length !== candidates.length ||
    report.investorIds.length !== ids.length
  )
    throw new InsightsError("DATA_REQUIRES_REVIEW", 422);
  const prohibited =
    /^(?:page\b|date\b|currency\b|statement\b|report\b|equity\b|retained earnings\b|net income\b|income\b|revenue\b|expenses?\b)|^\s*[\d\s.,%/-]+\s*$/i;
  if (report.rows.some((row) => prohibited.test(row.description.trim())))
    throw new InsightsError("DATA_REQUIRES_REVIEW", 422);
  const presentation = statementPresentation(report.statement);
  for (const row of report.rows) {
    const account = presentation.sections
      .flatMap((section) =>
        section.categories.flatMap((category) => category.accounts),
      )
      .find((account) => account.id === row.id);
    // Detect stale stored derived balances instead of replacing them silently.
    const original = stored.rows.find((candidate) => candidate.id === row.id)!;
    if (
      !account ||
      roundCurrency(Number(original.current)) !== account.currentShare ||
      (original.previous !== null &&
        roundCurrency(original.previous) !== account.previousShare)
    )
      throw new InsightsError("RECONCILIATION_FAILED", 422);
  }
  if (
    presentation.sections.reduce(
      (n, section) => n + section.categories.length,
      0,
    ) > maxCategories
  )
    throw new InsightsError("CATEGORY_LIMIT", 422);
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
