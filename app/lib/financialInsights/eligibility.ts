import type { ParsedRow } from "../documentParser";
import {
  applyOwnershipToRow,
  deriveSelectedInvestorReport,
  isSummaryRow,
  normalizeCategory,
  type ReportInvestor,
  type SelectedInvestorReport,
} from "../reportData";
import { roundCurrency, statementPresentation } from "../statementPresentation";
import type { AnalysisCapability } from "./settings";

export type AnalysisReason =
  | "ready"
  | "no-investor-selected"
  | "no-included-rows"
  | "unreviewed-rows"
  | "unreconciled-values"
  | "service-disabled"
  | "not-authorized"
  | "usage-limit-reached"
  | "configuration-error";
export type AnalysisEligibility = {
  eligible: boolean;
  reason: AnalysisReason;
  affectedRowIds: string[];
  affectedRowCount: number;
  message: string;
};
export type AnalysisIssue = {
  code:
    | "review-required"
    | "invalid-values"
    | "invalid-ownership"
    | "duplicate"
    | "reconciliation"
    | "unsupported-row"
    | "period"
    | "currency"
    | "category-limit";
  rowIds: string[];
  message: string;
};
export type AnalysisData = {
  rows: ParsedRow[];
  investors: ReportInvestor[];
  selectedInvestorIds: string[];
  date: string;
  currency: string;
  currencies?: string[];
  maxCategories?: number;
};
export function eligibility(
  reason: AnalysisReason,
  message: string,
  affectedRowIds: string[] = [],
): AnalysisEligibility {
  const ids = [...new Set(affectedRowIds)];
  return {
    eligible: reason === "ready",
    reason,
    affectedRowIds: ids,
    affectedRowCount: ids.length,
    message,
  };
}
const isLeaf = (row: ParsedRow) =>
  row.isSourceTotal !== true &&
  row.isLeafAccount !== false &&
  !isSummaryRow(row);
const validAmount = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1e13;
const unsupported =
  /^(?:page\b|date\b|currency\b|statement\b|report\b|equity\b|retained earnings\b|net income\b|income\b|revenue\b|expenses?\b)|^\s*[\d\s.,%/-]+\s*$/i;
export function rowAnalysisIssues(row: ParsedRow): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [],
    add = (code: AnalysisIssue["code"], message: string) =>
      issues.push({ code, rowIds: [row.id], message });
  if (
    row.needsReview ||
    row.manuallyReviewRequired ||
    (row.ocrConfidence !== undefined &&
      row.ocrConfidence < 85 &&
      !row.reviewConfirmed)
  )
    add(
      "review-required",
      "Confirm the flagged values against your statement or exclude the row.",
    );
  if (
    !["Asset", "Liability"].includes(row.kind) ||
    !row.description.trim() ||
    unsupported.test(row.description.trim())
  )
    add(
      "unsupported-row",
      "Review non-account or incomplete rows and exclude headings, income, equity and decorative values.",
    );
  if (
    !validAmount(row.current) ||
    (row.previous !== null && !validAmount(row.previous)) ||
    (row.rawCurrent !== undefined && !validAmount(row.rawCurrent)) ||
    (row.rawPrevious !== undefined &&
      row.rawPrevious !== null &&
      !validAmount(row.rawPrevious))
  )
    add(
      "invalid-values",
      "Correct missing, negative or invalid financial amounts before confirming the row.",
    );
  const ownership = row.rowOwnershipOverride ?? row.ownershipPercentage ?? 100;
  if (
    [ownership, row.ownershipPercentage ?? 100].some(
      (percentage) =>
        !Number.isFinite(percentage) || percentage < 0 || percentage > 100,
    )
  ) {
    add(
      "invalid-ownership",
      "Enter an ownership percentage between zero and one hundred, then save the row.",
    );
  } else if (!issues.some((issue) => issue.code === "invalid-values")) {
    const normalized =
      row.rawCurrent === undefined
        ? row
        : applyOwnershipToRow(row, row.ownershipPercentage ?? 100);
    if (
      (ownership === 0 && row.current !== 0) ||
      roundCurrency(Number(row.current)) !==
        roundCurrency(Number(normalized.current)) ||
      (row.previous !== null &&
        normalized.previous !== null &&
        roundCurrency(row.previous) !== roundCurrency(normalized.previous))
    )
      add(
        "reconciliation",
        "Recalculate the ownership-adjusted values by editing and saving this row.",
      );
  }
  return issues;
}
export function confirmAnalysisRow(row: ParsedRow): ParsedRow {
  const normalized =
    row.rawCurrent === undefined
      ? { ...row }
      : applyOwnershipToRow(row, row.ownershipPercentage ?? 100);
  const confirmed = {
    ...normalized,
    needsReview: false,
    manuallyReviewRequired: false,
    reviewConfirmed: true,
  };
  if (rowAnalysisIssues(confirmed).length)
    throw new Error(
      "Correct invalid amounts, account details or ownership before confirming this row.",
    );
  return confirmed;
}
/** Shared browser/server diagnostics. IDs stay local in the UI; server errors never return source rows. */
function inspectData(input: AnalysisData) {
  const selected = new Set(input.selectedInvestorIds),
    known = new Set(
      input.investors
        .filter((investor) => investor.name.trim())
        .map((investor) => investor.investorId),
    );
  const candidates = input.rows.filter(
    (row) =>
      row.include &&
      row.investorId &&
      selected.has(row.investorId) &&
      isLeaf(row),
  );
  const issues: AnalysisIssue[] = candidates.flatMap(rowAnalysisIssues);
  const groups = new Map<string, ParsedRow[]>();
  for (const row of candidates) {
    const key = [
      row.statementId ?? row.investorId,
      row.sourcePage ?? "",
      row.description.trim().toLocaleLowerCase("en-CA"),
      row.rawCurrent ?? row.current,
      row.rawPrevious !== undefined ? row.rawPrevious : row.previous,
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const rows of groups.values())
    if (rows.length > 1)
      issues.push({
        code: "duplicate",
        rowIds: rows.map((row) => row.id),
        message:
          "Resolve duplicate account rows by correcting or excluding them; confirmation alone does not remove a duplicate.",
      });
  const badIds = new Set(issues.flatMap((issue) => issue.rowIds));
  // Canonicalise display labels without changing source rows or inventing categories.
  const labels = new Map<string, string>();
  const confirmed = candidates
    .filter((row) => !badIds.has(row.id))
    .map((row) => {
      const label = normalizeCategory(row.category).replace(/\s+/g, " ").trim(),
        key = label.toLocaleLowerCase("en-CA");
      if (!labels.has(key)) labels.set(key, label);
      return { ...row, category: labels.get(key)! };
    });
  const base = deriveSelectedInvestorReport(
    confirmed,
    input.investors,
    input.selectedInvestorIds,
  );
  const statement = statementPresentation(base.statement);
  const assetMix = statement.sections[0].categories
    .filter((category) => category.currentShare > 0)
    .map((category) => ({
      category: category.category,
      total: category.currentShare,
      percentage:
        statement.currentShareAssets > 0
          ? (category.currentShare / statement.currentShareAssets) * 100
          : 0,
    }))
    .sort((a, b) => b.total - a.total);
  const report: SelectedInvestorReport = { ...base, statement, assetMix };
  if (!isAnalysisDateValid(input.date))
    issues.push({
      code: "period",
      rowIds: [],
      message: "Enter a valid statement date in Report setup.",
    });
  if (
    !/^[A-Z]{3}$/.test(input.currency) ||
    input.currencies?.some((currency) => currency !== input.currency)
  )
    issues.push({
      code: "currency",
      rowIds: [],
      message:
        "Enter a valid report currency and reconcile mixed currencies before analysis.",
    });
  if (
    statement.sections.reduce(
      (count, section) => count + section.categories.length,
      0,
    ) > (input.maxCategories ?? 20)
  )
    issues.push({
      code: "category-limit",
      rowIds: [],
      message: "Review the number of included categories before analysis.",
    });
  let result: AnalysisEligibility;
  if (!selected.size)
    result = eligibility(
      "no-investor-selected",
      "Select at least one investor to analyze.",
    );
  else if ([...selected].some((id) => !known.has(id)))
    result = eligibility(
      "not-authorized",
      "Sign in or upgrade to use financial analysis.",
    );
  else if (
    [...selected].some((id) => !candidates.some((row) => row.investorId === id))
  )
    result = eligibility(
      "no-included-rows",
      selected.size === 1
        ? "No included financial rows are available for this investor."
        : "No included financial rows are available for one or more selected investors.",
    );
  else if (
    issues.some((issue) =>
      ["period", "currency", "category-limit"].includes(issue.code),
    )
  )
    result = eligibility(
      "configuration-error",
      issues.find((issue) =>
        ["period", "currency", "category-limit"].includes(issue.code),
      )!.message,
      [...badIds],
    );
  else if (issues.length)
    result = eligibility(
      issues.some((issue) => issue.code === "review-required")
        ? "unreviewed-rows"
        : "unreconciled-values",
      `${badIds.size} included row${badIds.size === 1 ? "" : "s"} contain${badIds.size === 1 ? "s" : ""} low-confidence or unreconciled values. Confirm or exclude these rows before requesting financial analysis.`,
      [...badIds],
    );
  else
    result = eligibility(
      "ready",
      "The selected financial position is ready for analysis.",
    );
  return { eligibility: result, issues, report };
}
export function inspectAnalysisData(
  input: AnalysisData,
): ReturnType<typeof inspectData> & { unexpectedFailure?: boolean } {
  try {
    return inspectData(input);
  } catch {
    return {
      eligibility: eligibility(
        "configuration-error",
        "Financial analysis is temporarily unavailable. Please try again later.",
      ),
      issues: [],
      report: deriveSelectedInvestorReport([], [], []),
      unexpectedFailure: true,
    };
  }
}
export function serviceEligibility(
  capability: AnalysisCapability,
): AnalysisEligibility {
  if (capability.eligibilityReason === "configuration-error")
    return eligibility(
      "configuration-error",
      "Financial analysis is temporarily unavailable. Please try again later.",
    );
  if (
    capability.mode === "disabled" ||
    capability.mode === "mock" ||
    capability.eligibilityReason === "service-disabled"
  )
    return eligibility(
      "service-disabled",
      "Financial analysis is not available in this environment.",
    );
  if (capability.eligibilityReason === "not-authorized")
    return eligibility(
      "not-authorized",
      "Sign in or upgrade to use financial analysis.",
    );
  if (capability.eligibilityReason === "usage-limit-reached")
    return eligibility(
      "usage-limit-reached",
      capability.resetAt
        ? `Your analysis usage limit has been reached. Access resets ${formatAnalysisReset(capability.resetAt)}.`
        : "Your analysis usage limit has been reached. Reset time is not available.",
    );
  if (
    capability.canAnalyzeFinancialPosition &&
    (!capability.eligibilityReason || capability.eligibilityReason === "ready")
  )
    return eligibility("ready", "Financial analysis is available.");
  return eligibility(
    "configuration-error",
    "Financial analysis is temporarily unavailable. Please try again later.",
  );
}
export function analysisEligibility(
  data: AnalysisEligibility,
  capability: AnalysisCapability,
): AnalysisEligibility {
  const service = serviceEligibility(capability);
  return service.eligible
    ? data
    : {
        ...service,
        affectedRowIds: data.affectedRowIds,
        affectedRowCount: data.affectedRowCount,
      };
}
function formatAnalysisReset(date: string) {
  const value = new Date(date);
  return Number.isFinite(value.getTime())
    ? value.toLocaleString("en-CA", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
        timeZone: "UTC",
      })
    : "at an unavailable time";
}
export function isAnalysisDateValid(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(value.getTime()) &&
    value.toISOString().slice(0, 10) === date
  );
}
export function formatAnalysisDate(date: string) {
  return isAnalysisDateValid(date)
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : "Statement date requires review";
}

/** Only safe, known public error categories influence customer-facing actions. */
export function analysisRequestFailure(code: unknown): {
  eligibility: AnalysisEligibility;
  retryable: boolean;
} {
  if (code === "SERVICE_DISABLED")
    return {
      eligibility: eligibility(
        "service-disabled",
        "Financial analysis is not available in this environment.",
      ),
      retryable: false,
    };
  if (
    [
      "AUTHENTICATION_REQUIRED",
      "NOT_INCLUDED_IN_PLAN",
      "REPORT_UNAUTHORIZED",
    ].includes(String(code))
  )
    return {
      eligibility: eligibility(
        "not-authorized",
        "Sign in or upgrade to use financial analysis.",
      ),
      retryable: false,
    };
  if (["RATE_LIMITED", "USAGE_LIMIT_REACHED"].includes(String(code)))
    return {
      eligibility: eligibility(
        "usage-limit-reached",
        "Your analysis usage limit has been reached. Please check your account for availability.",
      ),
      retryable: false,
    };
  if (
    [
      "DATA_REQUIRES_REVIEW",
      "RECONCILIATION_FAILED",
      "REPORT_CHANGED",
    ].includes(String(code))
  )
    return {
      eligibility: eligibility(
        "unreconciled-values",
        "Review the selected financial rows and save a corrected summary before trying again.",
      ),
      retryable: false,
    };
  return {
    eligibility: eligibility(
      "configuration-error",
      "We could not generate the analysis. Your report and financial totals remain available.",
    ),
    retryable: true,
  };
}
