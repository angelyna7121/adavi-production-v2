import { inspectAnalysisData } from "./eligibility";
import type { ParsedRow } from "../documentParser";
import { type ReportInvestor } from "../reportData";
import { roundCurrency } from "../statementPresentation";
import { reportPeriodDates } from "../reportPeriods";
import {
  categories,
  type NormalizedReport,
  type NormalizedCategory,
} from "../backend/normalizedTypes";
import { trustedSummary } from "./selection";
export function snapshotForSaving(
  rows: ParsedRow[],
  investors: ReportInvestor[],
  ids: string[],
  date: string,
  currency: string,
) {
  trustedSummary(
    {
      accountId: "local",
      versionId: "local",
      revision: "local",
      confirmed: true,
      rows,
      investors,
      authorizedInvestorIds: ids,
      date,
      currency,
      currencies: [currency],
    },
    ids,
    "local",
  );
  const references: Record<string, string> = {};
  const normalized = ids.map((id) => {
    const localReference = crypto.randomUUID();
    references[id] = localReference;
    const report = inspectAnalysisData({
        rows,
        investors,
        selectedInvestorIds: [id],
        date,
        currency,
      }).report,
      statement = report.statement;
    const grouped = new Map<string, NormalizedCategory>();
    for (const section of statement.sections)
      for (const category of section.categories) {
        const name =
          (categories[section.kind] as readonly string[]).find(
            (name) =>
              name.toLocaleLowerCase("en-CA") ===
              category.category.toLocaleLowerCase("en-CA"),
          ) ??
          (section.kind === "Asset" ? "Other Assets" : "Other Liabilities");
        const members = report.rows.filter((row) =>
          category.accounts.some((account) => account.id === row.id),
        );
        const missing = members.filter((row) => row.previous === null).length;
        const entry = grouped.get(name) ?? {
          category: name,
          kind: section.kind,
          current: 0,
          previous: 0,
          accountCount: 0,
          missingPreviousCount: 0,
          lowConfidenceCount: 0,
        };
        entry.current = roundCurrency(entry.current + category.currentShare);
        entry.previous =
          missing || entry.previous === null
            ? null
            : roundCurrency(entry.previous + category.previousShare);
        entry.accountCount += members.length;
        entry.missingPreviousCount += missing;
        entry.lowConfidenceCount += members.filter(
          (row) => row.ocrConfidence !== undefined && row.ocrConfidence < 85,
        ).length;
        grouped.set(name, entry);
      }
    return {
      localReference,
      categories: [...grouped.values()],
      excludedRowCount:
        rows.filter((row) => row.investorId === id).length - report.rows.length,
    };
  });
  const periods = reportPeriodDates(date);
  const report: NormalizedReport = {
    version: "1",
    confirmed: true,
    currency,
    currentPeriod: date,
    previousPeriod: periods.previous.toISOString().slice(0, 10),
    investors: normalized,
  };
  return { report, references };
}
